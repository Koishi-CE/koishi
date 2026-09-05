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
import { App, type Plugin, Time } from "@koishi-ce/koishi";
import memory from "@koishi-ce/plugin-database-memory";
import mock from "@koishi-ce/plugin-mock";
import analytics from "./index.ts";

// Analytics 类仅默认导出，实例类型经构造器派生（namespace 侧的 Payload 等随实例可用）
type Analytics = InstanceType<typeof analytics>;

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

// 同 admin：CJS 实现配 ESM 声明，nodenext 互操作视图多包一层 default，类型层穿透取真实类
app.plugin(memory);
// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
app.plugin(
	FakeConsole as unknown as Plugin.Constructor<App>,
);
// statsInternal 归零：每条消息事件后立即落库，便于断言
app.plugin(analytics, {
	statsInternal: 0,
	recentDayCount: 7,
});
app.plugin(mock);

// 注册一个空指令，用于驱动 command/execute 计数；带回复以驱动 send 事件
app.command("analytics-probe").action(() => "probe-done");

const service = () =>
	app.get("console.services.analytics") as Analytics;

const client = app.mock.client("123", "321");

beforeAll(async () => {
	await app.start();
	await app.mock.initUser("123", 1, { id: 1 });
	await app.mock.initChannel("321");
	// 预置昨日消息历史：一收一发（memory 驱动下数组 create 对联合主键报缺键，逐条写入）
	const yesterday = Time.getDateNumber() - 1;
	await app.database.create("analytics.message", {
		date: yesterday,
		hour: 10,
		type: "receive",
		selfId: "514",
		platform: "mock",
		count: 2,
	});
	await app.database.create("analytics.message", {
		date: yesterday,
		hour: 10,
		type: "send",
		selfId: "514",
		platform: "mock",
		count: 3,
	});
	// 预置昨日指令记录：一个用户两次调用
	await app.database.create("analytics.command", {
		date: yesterday,
		hour: 11,
		name: "analytics-probe",
		selfId: "514",
		userId: 1,
		channelId: "321",
		platform: "mock",
		count: 2,
	});
});

afterAll(async () => {
	await app.stop();
});

describe("analytics 统计服务", () => {
	it("消息收发与指令执行被计数落库", async () => {
		await client.receive("analytics-probe");
		// 强制上传，避免与构造期上传落在同一毫秒被跳过
		await service().upload(true);

		const today = Time.getDateNumber();
		const rows = await app.database.get(
			"analytics.message",
			{
				date: today,
			},
		);
		// mock 会话：用户消息计入 receive（mock 编码器不派发 send 会话，发出侧见下一用例）
		expect(rows.length).toBeGreaterThan(0);
		const receiveRow = rows.find(
			(row) => row.type === "receive",
		);
		expect(receiveRow?.count).toBe(1);
		expect(receiveRow?.platform).toBe("mock");
		expect(receiveRow?.selfId).toBe("514");

		const commands = await app.database.get(
			"analytics.command",
			{
				date: today,
			},
		);
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({
			name: "analytics-probe",
			userId: 1,
			channelId: "321",
		});
	});

	it("send 事件计入发出消息数", async () => {
		// mock 编码器不派发 send 会话，此处直接派发最小会话驱动计数
		app.emit("send", {
			selfId: "514",
			platform: "mock",
		} as never);
		await service().upload(true);
		const today = Time.getDateNumber();
		const rows = await app.database.get(
			"analytics.message",
			{
				date: today,
				type: "send",
			},
		);
		expect(rows[0]?.count).toBe(1);
	});

	it("非强制上传在间隔超时后触发（statsInternal=0）", async () => {
		// statsInternal 为 0：任意时间流逝都满足间隔条件，走 forced=false 路径
		await new Promise((resolve) => setTimeout(resolve, 5));
		const before = +service().lastUpdate;
		await service().upload();
		// 触发后 lastUpdate 刷新为更新的时间
		expect(+service().lastUpdate).toBeGreaterThanOrEqual(
			before,
		);
	});

	it("非强制上传在跨小时边界触发", async () => {
		// 将记录的小时号置为不可能值：dateHour !== updateHour 分支命中
		service().updateHour = -1;
		await service().upload();
		expect(service().updateHour).toBe(
			new Date().getHours(),
		);
	});

	it("download 聚合数值指标与各图表数据", async () => {
		const payload = await service().download();

		expect(payload.userCount).toBeGreaterThanOrEqual(1);
		// 昨日没有新用户与新群组
		expect(payload.userIncrement).toBe(0);
		expect(payload.guildCount).toBe(0);
		expect(payload.guildIncrement).toBe(0);

		// 指令日均调用：预置 2 次 / 有效天数 1
		expect(payload.commandRate["analytics-probe"]).toBe(2);

		// DAU 历史：下标 1（昨天）为 1 个去重用户，长度为 8（7+1）；
		// 今天的指令执行（上一用例）也计入下标 0
		expect(payload.dauHistory).toHaveLength(8);
		expect(payload.dauHistory[1]).toBe(1);
		expect(payload.dauHistory[0]).toBe(1);

		// 各机器人消息：昨天的收发日均
		const bot = payload.messageByBot["mock"]?.["514"];
		expect(bot?.receive).toBe(2);
		expect(bot?.send).toBe(3);

		// 按日历史：昨天收 2 发 3，今天恒为 0 占位
		expect(payload.messageByDate[1]).toEqual({
			receive: 2,
			send: 3,
		});
		expect(payload.messageByDate[0]).toEqual({
			receive: 0,
			send: 0,
		});

		// 按小时分布：24 个时段，10 点的日均收发
		expect(payload.messageByHour).toHaveLength(24);
		expect(payload.messageByHour[10]).toEqual({
			receive: 2,
			send: 3,
		});
		expect(payload.messageByHour[23]).toEqual({
			receive: 0,
			send: 0,
		});
	});

	it("get 按自然日缓存聚合结果", async () => {
		const svc = service();
		let downloads = 0;
		const original = svc.download.bind(svc);
		svc.download = async () => {
			downloads += 1;
			return original();
		};
		const first = await svc.get();
		const second = await svc.get();
		expect(second).toEqual(first);
		// 同一天内重复拉取不触发重新聚合
		expect(downloads).toBe(1);
		svc.download = original;
	});
});
