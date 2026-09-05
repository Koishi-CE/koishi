// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * rate-limit 插件测试：以 mock 双客户端验证调用次数上限（maxUsage）、
 * 最小调用间隔（minInterval）与权限豁免（bypassAuthority）三条路径，
 * 覆盖 help 扩展输出、运行时拦截与 usage / timer 管理指令。
 * 时间相关用例借 bun:test 的 jest 兼容 mock timers 把时钟固定在同一基准上再推进。
 */
import {
	afterAll,
	beforeAll,
	describe,
	it,
	jest,
} from "bun:test";
import { App, type Argv, Time } from "@koishi-ce/koishi";
import memory from "@koishi-ce/plugin-database-memory";
import * as help from "@koishi-ce/plugin-help";
import mock from "@koishi-ce/plugin-mock";
import * as rate from "./index.ts";

// 依赖纪律：时间模拟统一走 bun:test mock timers，勿为此回加 @sinonjs/fake-timers
const installClock = (now: number) => {
	jest.useFakeTimers();
	jest.setSystemTime(now);
};

const app = new App();
let now = Date.now();

app.plugin(help);
app.plugin(mock);
app.plugin(memory);
app.plugin(rate);

const client1 = app.mock.client("123");
const client2 = app.mock.client("456");

beforeAll(async () => {
	await app.start();
	await app.mock.initUser("123", 4, {
		usage: { foo: 1, _date: Time.getDateNumber() },
		timers: {
			bar: now + Time.minute,
			_date: now + Time.day,
		},
	});
});

afterAll(() => app.stop());

describe("@koishi-ce/plugin-rate-limit", () => {
	describe("maxUsage", () => {
		const cmd = app
			.command("foo", "指令1", { maxUsage: 3 })
			// notUsage 由 rate-limit 的 schema.extend 运行时注入，类型层未做全局
			// 增强（避免令 help 插件预留的 @ts-expect-error 失效），这里经断言传入
			.option("opt1", "选项1", {
				notUsage: true,
			} as Argv.OptionConfig)
			.option("opt2", "选项2")
			.action(() => "test");

		it("Extended Help", async () => {
			await client1.shouldReply(
				"help foo -H",
				[
					"指令：foo",
					"指令1",
					"已调用次数：1/3。",
					"可用的选项有：",
					"    -h, --help  显示此信息 (不计入调用)",
					"    --opt1  选项1 (不计入调用)",
					"    --opt2  选项2",
				].join("\n"),
			);
		});

		it("Runtime Check", async () => {
			cmd.config.showWarning = true;
			await client1.shouldReply("foo", "test");
			await client1.shouldReply("foo", "test");
			await client1.shouldReply(
				"foo",
				"调用次数已达上限。",
			);
			await client2.shouldReply("foo", "test");
			await client1.shouldReply("foo --opt1", "test");
			cmd.config.showWarning = false;
			await client1.shouldNotReply("foo");
		});

		it("Modify Usages", async () => {
			await client1.shouldReply(
				"usage",
				"今日各功能的调用次数为：\nfoo：3",
			);
			await client1.shouldReply(
				"usage -c foo",
				"设置成功。",
			);
			await client1.shouldReply(
				"usage",
				"今日没有调用过消耗次数的功能。",
			);
			await client1.shouldReply(
				"usage -s bar",
				"缺少参数，输入帮助以查看用法。",
			);
			await client1.shouldReply(
				"usage -s bar nan",
				"参数 value 输入无效，请提供一个正整数。",
			);
			await client1.shouldReply(
				"usage -s bar 2",
				"设置成功。",
			);
			await client1.shouldReply(
				"usage bar",
				"今日 bar 功能的调用次数为：2",
			);
			await client1.shouldReply(
				"usage baz",
				"今日 baz 功能的调用次数为：0",
			);
			await client1.shouldReply("usage -c", "设置成功。");
			await client1.shouldReply(
				"usage",
				"今日没有调用过消耗次数的功能。",
			);
		});
	});

	describe("minInterval", () => {
		const cmd = app
			.command("bar", "指令2", {
				minInterval: 3 * Time.minute,
				hideOptions: true,
			})
			// 同上：notUsage 经断言传入（运行时由 schema.extend 注册）
			.option("opt1", "选项1", {
				notUsage: true,
			} as Argv.OptionConfig)
			.option("opt2", "选项2")
			.action(() => "test");

		it("Extended Help", async () => {
			installClock(now);
			try {
				await client1.shouldReply(
					"help bar",
					"指令：bar\n指令2\n距离下次调用还需：60/180 秒。",
				);
				await client2.shouldReply(
					"help bar",
					"指令：bar\n指令2\n距离下次调用还需：0/180 秒。",
				);
			} finally {
				jest.useRealTimers();
			}
		});

		it("Runtime Check", async () => {
			installClock(now);
			try {
				cmd.config.showWarning = true;
				await client1.shouldReply(
					"bar",
					"调用过于频繁，请稍后再试。",
				);
				await client2.shouldReply("bar", "test");
				jest.advanceTimersByTime(Time.minute + 1);
				now = Date.now();
				await client1.shouldReply("bar", "test");
				await client1.shouldReply("bar --opt1", "test");
				cmd.config.showWarning = false;
				await client2.shouldNotReply("bar");
			} finally {
				jest.useRealTimers();
			}
		});

		it("Modify Timers", async () => {
			installClock(now);
			try {
				await client1.shouldReply(
					"timer",
					"各定时器的生效时间为：\nbar：剩余 3 分钟",
				);
				await client1.shouldReply(
					"timer -c bar",
					"设置成功。",
				);
				await client1.shouldReply(
					"timer",
					"当前没有生效的定时器。",
				);
				await client1.shouldReply(
					"timer -s foo",
					"缺少参数，输入帮助以查看用法。",
				);
				await client1.shouldReply(
					"timer -s foo nan",
					"参数 value 输入无效，请输入合法的时间。",
				);
				await client1.shouldReply(
					"timer -s foo 2min",
					"设置成功。",
				);
				await client1.shouldReply(
					"timer foo",
					"定时器 foo 的生效时间为：剩余 2 分钟",
				);
				await client1.shouldReply(
					"timer fox",
					"定时器 fox 当前并未生效。",
				);
				await client1.shouldReply("timer -c", "设置成功。");
				await client1.shouldReply(
					"timer",
					"当前没有生效的定时器。",
				);
			} finally {
				jest.useRealTimers();
			}
		});
	});

	describe("bypassAuthority", () => {
		it("bypass maxUsage", async () => {
			app
				.command("qux", "指令3", {
					maxUsage: 1,
					bypassAuthority: 3,
				})
				.action(() => "test");

			await client2.shouldReply("qux", "test");
			await client2.shouldReply(
				"qux",
				"调用次数已达上限。",
			);
			await client1.shouldReply("qux", "test");
			await client1.shouldReply("qux", "test");
			await client1.shouldReply("qux", "test");
		});
	});
});
