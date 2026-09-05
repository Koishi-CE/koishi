// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { Console, type Entry } from "@koishi-ce/console";
import { App, type Plugin } from "@koishi-ce/koishi";
import memory from "@koishi-ce/plugin-database-memory";
import mock from "@koishi-ce/plugin-mock";
import * as status from "./index.ts";
import {
	EnvInfoProvider,
	ProfileProvider,
	type ProfileProvider as ProfileProviderType,
} from "./index.ts";

/** 控制台服务桩：仅实现入口登记所需的最小面。 */
class FakeConsole extends Console {
	protected resolveEntry(
		_files: Entry.Files,
		_key: string,
	): string[] {
		return [];
	}
}

const app = new App();

app.plugin(memory);
// Console 基类的 static inject 是 cordis 3 旧形态（{ optional: [...] }），
// 与 Plugin.Constructor 期待的 Dict<Meta> 索引签名不兼容，仅做类型层转型
app.plugin(
	FakeConsole as unknown as Plugin.Constructor<App>,
);
// tickInterval 取小值，驱动 ready 定时器尽快完成首次 CPU 采样与刷新
app.plugin(status, { tickInterval: 50 });
app.plugin(mock);

const client = app.mock.client("123", "321");

const profile = () =>
	app.get("console.services.status") as ProfileProviderType;
const envinfo = () =>
	app.get("console.services.envinfo") as EnvInfoProvider;

beforeAll(async () => {
	await app.start();
	await app.mock.initUser("123", 1);
	await app.mock.initChannel("321");
});

afterAll(async () => {
	await app.stop();
});

describe("status 插件", () => {
	it("加载后同时挂载 envinfo 与 status 两个数据服务", () => {
		expect(
			app.get("console.services.envinfo"),
		).toBeDefined();
		expect(
			app.get("console.services.status"),
		).toBeDefined();
		expect(
			Object.keys(app.console.entries).length,
		).toBeGreaterThan(0);
	});

	it("envinfo 采集系统 / 运行时 / Koishi 三组信息并缓存", async () => {
		const data = await envinfo().get();
		expect(Object.keys(data)).toEqual([
			"system",
			"binaries",
			"koishi",
		]);
		// 索引签名属性走方括号访问，undefined 安全由断言本身兜底
		expect(data["system"]?.["OS"]).toBeTruthy();
		expect(data["binaries"]?.["Node"]).toBe(
			process.versions.node,
		);
		expect(data["koishi"]?.["Core"]).toBeTruthy();
		expect(data["koishi"]?.["Console"]).toBeTruthy();

		// 首次采集后缓存：内部 task 不再更换
		const before =
			envinfo()["task" as keyof EnvInfoProvider];
		await envinfo().get();
		expect(envinfo()["task" as keyof EnvInfoProvider]).toBe(
			before,
		);
	});

	it("envinfo 上报 KOISHI_AGENT 宿主代理信息", async () => {
		Bun.env["KOISHI_AGENT"] = "test-agent/1.2.3";
		try {
			const data = await envinfo()["_get"]();
			expect(data["koishi"]?.["test-agent"]).toBe("1.2.3");
		} finally {
			delete Bun.env["KOISHI_AGENT"];
		}
	});

	it("profile 采集内存 / CPU 负载与机器人收发速率", async () => {
		// 等待首个 tick 完成 CPU 差值采样
		await new Promise((resolve) =>
			setTimeout(resolve, 120),
		);
		const data = await profile().get();
		expect(data.memory).toHaveLength(2);
		expect(data.cpu).toHaveLength(2);
		// 内存与 CPU 负载率均为有限数
		for (const rate of [...data.memory, ...data.cpu]) {
			expect(Number.isFinite(rate)).toBe(true);
		}
		// mock 机器人不隐藏，应出现在列表中
		expect(Object.keys(data.bots).length).toBeGreaterThan(
			0,
		);
	});

	it("get 每次重算且结构稳定（cached 恒为 undefined 的死分支）", async () => {
		const svc = profile();
		const first = await svc.get();
		const second = await svc.get();
		// 源码从不写入 cached 字段，非强制调用同样重算
		expect(svc.cached).toBeUndefined();
		expect(Object.keys(second)).toEqual(Object.keys(first));
		expect(Object.keys(second.bots)).toEqual(
			Object.keys(first.bots),
		);
		const forced = await svc.get(true);
		expect(Object.keys(forced)).toEqual(Object.keys(first));
	});

	it("消息收发计入滑动窗口计数器", async () => {
		const bot = [...app.bots][0];
		expect(bot).toBeDefined();
		const before = bot?._messageSent.get() ?? 0;
		const receivedBefore = bot?._messageReceived.get() ?? 0;
		// 收到一条用户消息（触发 message 事件），机器人无回复
		await client.receive("ping-should-not-reply");
		expect(bot?._messageReceived.get()).toBe(
			receivedBefore + 1,
		);
		expect(bot?._messageSent.get()).toBe(before);

		const data = await profile().get(true);
		const entry = data.bots[bot?.sid ?? ""];
		expect(entry?.messageReceived).toBe(receivedBefore + 1);
	});

	it("滑动窗口计数器经秒级 tick 后继续累加", async () => {
		const bot = [...app.bots][0];
		expect(bot).toBeDefined();
		bot?._messageSent.add(1);
		expect(bot?._messageSent.get()).toBe(1);
		// 等待一次以上的窗口滑动（计数移入历史槽位），新计数继续记入队头
		await new Promise((resolve) =>
			setTimeout(resolve, 1100),
		);
		bot?._messageSent.add(2);
		expect(bot?._messageSent.get()).toBe(3);
	});

	it("login-added / login-removed / login-updated 事件驱动刷新", async () => {
		const bot = [...app.bots][0];
		expect(bot).toBeDefined();
		// login-added：重新初始化计数器并防抖刷新（bot 已由上方断言保证存在）。
		// satori 把 login-* 载荷声明为 Session，本仓运行时实际按 { bot } 对象分发
		// （profile.ts 按此解构），为不改运行时行为仅做类型层断言
		app.emit("login-added", { bot: bot! } as never);
		expect(bot?._messageSent).toBeDefined();
		// login-removed：停掉计数器（stop 被调用不抛错）并刷新
		app.emit("login-removed", { bot: bot! } as never);
		// login-updated：仅刷新
		app.emit("login-updated", bot! as never);
		await new Promise((resolve) => setTimeout(resolve, 10));
	});

	it("status 指令输出机器人状态与性能摘要", async () => {
		const replies = await client.receive("status");
		expect(replies).toHaveLength(1);
		expect(replies[0]).toContain("mock");
	});

	it("两个子服务的 Config 均可解析", () => {
		expect(ProfileProvider.Config({})).toEqual({
			tickInterval: 5000,
		});
		expect(EnvInfoProvider.Config({})).toEqual({});
	});
});
