// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import {
	App,
	Database,
	Logger,
	RuntimeError,
} from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
// 同 admin 既有测试：CJS 实现配 ESM 声明，nodenext 互操作视图多包一层 default，转型取真实插件对象
import * as memoryModule from "@koishijs/plugin-database-memory";
import * as callme from "./index.ts";

const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

const app = new App();

app.plugin(memory);
app.plugin(mock);
app.plugin(callme);

const client = app.mock.client("123");

beforeAll(async () => {
	await app.start();
	// 预建用户，确保后续会话走 set 更新路径而非自动 createUser
	await app.mock.initUser("123", 1);
});

afterAll(async () => {
	await app.stop();
});

describe("callme 指令", () => {
	it("未设置称呼时提示未命名", async () => {
		const replies = await client.receive("callme");
		expect(replies[0]).toBe("你还没有给自己起一个称呼呢~");
	});

	it("设置称呼后回执新称呼并落库", async () => {
		const replies = await client.receive("callme 小明");
		expect(replies[0]).toBe("好的，小明，请多指教！");
		const user = await app.database.getUser("mock", "123");
		expect(user?.name).toBe("小明");
	});

	it("重复查询显示当前称呼", async () => {
		const replies = await client.receive("nn");
		expect(replies[0]).toBe("好的呢，小明！");
	});

	it("称呼未变化时提示 unchanged", async () => {
		const replies = await client.receive("callme 小明");
		expect(replies[0]).toBe("称呼未发生变化。");
	});

	it("纯文本以外的内容剥离后为空时提示 empty", async () => {
		const replies = await client.receive(
			'callme <image url="x"/>',
		);
		expect(replies[0]).toBe("称呼不能为空。");
	});

	it("common/callme 事件监听者返回字符串可拦截修改", async () => {
		const dispose = app.on(
			"common/callme",
			(name) => `禁止设置称呼：${name}`,
		);
		const replies = await client.receive("callme 小红");
		dispose();
		expect(replies[0]).toBe("禁止设置称呼：小红");
		// 拦截路径不应写入数据库
		const user = await app.database.getUser("mock", "123");
		expect(user?.name).toBe("小明");
	});

	it("快捷方式「叫我」在称呼机器人后可免指令名调用", async () => {
		// shortcut 带 prefix: true，要求消息以 @机器人 的称呼开头
		const replies = await client.receive(
			'<at id="514"/>叫我小红',
		);
		expect(replies[0]).toBe("好的，小红，请多指教！");
	});

	it("监听者返回空字符串时不拦截", async () => {
		const dispose = app.on("common/callme", () => "");
		const replies = await client.receive("callme 小刚");
		dispose();
		expect(replies[0]).toBe("好的，小刚，请多指教！");
	});

	it("落库遇到 duplicate-entry 错误时给出重名提示", async () => {
		const proto = Database.prototype as unknown as Record<
			string,
			(...args: unknown[]) => Promise<unknown>
		>;
		const original = proto["set"];
		// RuntimeError.check 以 message 精确匹配 code 字符串
		proto["set"] = async () => {
			throw new RuntimeError(
				"duplicate-entry",
				"duplicate-entry",
			);
		};
		const replies = await client
			.receive("callme 小亮")
			.finally(() => {
				proto["set"] = original!;
			});
		expect(replies[0]).toBe("禁止与其他用户重名。");
	});

	it("落库遇到其他错误时提示修改失败", async () => {
		// 落库异常的 common 域告警是被测行为的预期伴生输出，静默之
		(Logger.levels as Record<string, number>)["common"] = 0;
		const proto = Database.prototype as unknown as Record<
			string,
			(...args: unknown[]) => Promise<unknown>
		>;
		const original = proto["set"];
		proto["set"] = async () => {
			throw new Error("boom");
		};
		try {
			const replies = await client.receive("callme 小强");
			expect(replies[0]).toBe("修改称呼失败。");
		} finally {
			proto["set"] = original!;
			delete (Logger.levels as Record<string, number>)[
				"common"
			];
		}
	});
});
