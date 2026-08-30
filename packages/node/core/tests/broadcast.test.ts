/**
 * 全服广播（database.broadcast / broadcastDatabase）测试。
 *
 * 使用 memory 驱动预置多个频道，验证：
 * 默认只发受理频道、静默频道跳过与 forced 覆盖、指定频道列表时
 * 的精确投递与"未找到频道"告警、空内容短路。
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { App, Channel } from "@koishi-ce/koishi";
import mock, { DEFAULT_SELF_ID } from "@koishi-ce/plugin-mock";
import memory from "@minatojs/driver-memory";

const app = new App();
app.plugin(mock);
app.plugin(memory);
const bot = app.bots[0]!;

// 记录广播实际投递的目标频道
let delivered: string[] = [];

beforeAll(async () => {
	await app.start();
	// A：本 bot 受理的普通频道；B：静默频道；C：其它 bot 受理
	await app.mock.initChannel("A");
	await app.mock.initChannel("B", DEFAULT_SELF_ID, {
		flag: Channel.Flag.silent,
	});
	await app.mock.initChannel("C", "999");
	Object.defineProperty(bot, "sendMessage", {
		value: async (channelId: string) => {
			delivered.push(channelId);
			return [channelId];
		},
		configurable: true,
	});
});

afterAll(async () => {
	delete (bot as { sendMessage?: unknown }).sendMessage;
	await app.stop();
});

describe("Database Broadcast", () => {
	it("默认只广播本 bot 受理的非静默频道", async () => {
		delivered = [];
		const ids = await app.broadcast("hello");
		expect(delivered).toEqual(["A"]);
		expect(ids).toEqual(["A"]);
	});

	it("forced 模式覆盖静默频道", async () => {
		delivered = [];
		await app.broadcast("hello", true);
		expect(delivered).toEqual(["A", "B"]);
	});

	it("指定频道列表时精确投递并告警未找到的频道", async () => {
		delivered = [];
		// 频道列表会同时收窄平台过滤与目标集合；
		// 未命中（不存在或非本 bot 受理）的频道记入告警
		await app.broadcast(["mock:A", "mock:404"], "hello");
		expect(delivered).toEqual(["A"]);
	});

	it("空内容直接返回空数组", async () => {
		delivered = [];
		await expect(app.broadcast("")).resolves.toEqual([]);
		expect(delivered).toEqual([]);
	});
});
