import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @file 市场快照 client 侧状态层(state.ts)的单元测试。
 *
 * mock @koishi-ce/client(send/receive/store),按用例 resetModules 隔离
 * 模块级快照状态。覆盖:store 初值采用、缓存命中与单飞复用、force 刷新、
 * http-gzip 失败回退 inline、请求不可用报错、superseded 重试与超限、
 * getMarketSnapshotData 取值优先级、restoreMarketSnapshot 回填与
 * market/patch 增量合并。
 */

const client = vi.hoisted(() => ({
	send: vi.fn(),
	receive: vi.fn(),
	store: {} as any,
}));

vi.mock("@koishi-ce/client", () => ({
	send: client.send,
	receive: client.receive,
	store: client.store,
}));

import { makeManifestEntry, resetStore } from "./helpers";

type StateModule = typeof import("../state");

/** 每个用例重新加载模块,保证快照/任务状态互不串扰。 */
async function loadState(): Promise<StateModule> {
	vi.resetModules();
	client.receive.mockReset();
	return await import("../state");
}

/** 构造一份 inline 快照载荷。 */
function inlinePayload(
	dataVersion = 1,
	data: Record<string, any> = { "koishi-plugin-foo": makeManifestEntry() },
) {
	return { data, dataVersion, total: 1, failed: 0, progress: 1 };
}

beforeEach(() => {
	client.send.mockReset();
	resetStore(client.store);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.doUnmock("../snapshot-utils");
});

describe("getMarketSnapshotData", () => {
	it("无快照无 store 时兜底空对象", async () => {
		const state = await loadState();
		expect(state.getMarketSnapshotData()).toEqual({});
	});

	it("无快照时采用 store.market.data", async () => {
		const state = await loadState();
		const data = { "koishi-plugin-foo": makeManifestEntry() };
		client.store.market = { data, dataVersion: 1 };
		expect(state.getMarketSnapshotData()).toBe(data);
	});

	it("有快照时始终优先快照本体,store 版本漂移不影响", async () => {
		const state = await loadState();
		client.store.market = inlinePayload(1);
		await state.loadMarketSnapshot();
		const published = state.marketSnapshot.value!;
		// store 版本前进后,getMarketSnapshotData 仍认快照本体
		client.store.market = {
			dataVersion: 99,
			data: { other: makeManifestEntry() },
		};
		expect(state.getMarketSnapshotData()).toBe(published.data);
	});
});

describe("restoreMarketSnapshot", () => {
	it("store.market 存在但 data 丢失时用快照回填", async () => {
		const state = await loadState();
		client.store.market = inlinePayload(1);
		await state.loadMarketSnapshot();
		const snapshotData = state.marketSnapshot.value!.data;
		client.store.market = { dataVersion: 1 };
		state.restoreMarketSnapshot();
		expect(client.store.market.data).toBe(snapshotData);
	});

	it("store.market 缺失 / data 尚在 / 无快照时均不动作", async () => {
		const state = await loadState();
		state.restoreMarketSnapshot();
		expect(client.store.market).toBeUndefined();
		client.store.market = inlinePayload(1);
		await state.loadMarketSnapshot();
		const keep = { stable: makeManifestEntry() };
		client.store.market = { data: keep, dataVersion: 1 };
		state.restoreMarketSnapshot();
		expect(client.store.market.data).toBe(keep);
	});
});

describe("loadMarketSnapshot", () => {
	it("无本地快照但 store 有数据时直接采用并同步 legacy store", async () => {
		const state = await loadState();
		client.store.market = { ...inlinePayload(1), extra: "keep" };
		const snapshot = await state.loadMarketSnapshot();
		expect(client.send).not.toHaveBeenCalled();
		expect(snapshot.data["koishi-plugin-foo"]).toBeDefined();
		expect(client.store.market.extra).toBe("keep");
		expect(client.store.market.data["koishi-plugin-foo"]).toBe(
			snapshot.data["koishi-plugin-foo"],
		);
		expect(state.marketSnapshotError.value).toBeUndefined();
	});

	it("已有快照且 store 摘要 key 未变时返回缓存", async () => {
		const state = await loadState();
		client.store.market = inlinePayload(1);
		const first = await state.loadMarketSnapshot();
		const second = await state.loadMarketSnapshot();
		expect(second).toBe(first);
		expect(client.send).not.toHaveBeenCalled();
	});

	it("force 强制刷新:发 http-gzip 请求并发布 inline 响应", async () => {
		const state = await loadState();
		client.store.market = inlinePayload(1);
		await state.loadMarketSnapshot();
		client.send.mockResolvedValueOnce(inlinePayload(2));
		const snapshot = await state.loadMarketSnapshot(true);
		expect(client.send).toHaveBeenCalledTimes(1);
		expect(client.send).toHaveBeenCalledWith("market/index", {
			transport: "http-gzip",
		});
		expect(snapshot.dataVersion).toBe(2);
	});

	it("响应不带 data 时发布空数据对象", async () => {
		const state = await loadState();
		client.store.market = {};
		client.send.mockResolvedValueOnce({
			dataVersion: 1,
			total: 0,
			failed: 0,
			progress: 1,
		});
		const snapshot = await state.loadMarketSnapshot();
		expect(snapshot.data).toEqual({});
		expect(client.store.market.data).toEqual({});
	});

	it("请求不可用(send 返回 undefined)时抛错并记录错误态", async () => {
		const state = await loadState();
		client.send.mockResolvedValueOnce(undefined);
		await expect(state.loadMarketSnapshot()).rejects.toThrow(
			"market index request is unavailable",
		);
		expect(state.marketSnapshotError.value).toBeInstanceOf(Error);
		expect(state.marketSnapshotLoading.value).toBe(false);
	});

	it("http-gzip 传输失败时告警并回退 inline", async () => {
		const state = await loadState();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 500 }),
		);
		client.store.market = {};
		client.send
			.mockResolvedValueOnce({
				transport: "http-gzip",
				url: "/market.gz",
				payload: { dataVersion: 1, total: 1, failed: 0, progress: 1 },
			})
			.mockResolvedValueOnce(inlinePayload(1));
		const snapshot = await state.loadMarketSnapshot();
		expect(client.send).toHaveBeenCalledTimes(2);
		expect(client.send).toHaveBeenLastCalledWith("market/index", {
			transport: "inline",
		});
		expect(warn).toHaveBeenCalledOnce();
		expect(snapshot.data["koishi-plugin-foo"]).toBeDefined();
	});

	it("回退请求也不可用时抛错", async () => {
		const state = await loadState();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 500 }),
		);
		client.store.market = {};
		client.send
			.mockResolvedValueOnce({
				transport: "http-gzip",
				url: "/market.gz",
				payload: { dataVersion: 1, total: 1, failed: 0, progress: 1 },
			})
			.mockResolvedValueOnce(undefined);
		await expect(state.loadMarketSnapshot()).rejects.toThrow(
			"market index fallback request is unavailable",
		);
	});

	it("请求期间被新数据取代(superseded)时强制重试一次", async () => {
		const state = await loadState();
		client.store.market = { dataVersion: 1 };
		client.send.mockImplementationOnce(async () => {
			// 模拟请求期间服务端推送了更新的快照
			client.store.market = { dataVersion: 2 };
			return inlinePayload(1);
		});
		client.send.mockResolvedValueOnce(inlinePayload(2));
		const snapshot = await state.loadMarketSnapshot();
		expect(client.send).toHaveBeenCalledTimes(2);
		expect(snapshot.dataVersion).toBe(2);
		expect(state.marketSnapshotError.value).toBeUndefined();
	});

	it('superseded 重试超过 3 次抛"变化过于频繁"哨兵错误', async () => {
		const state = await loadState();
		client.store.market = { dataVersion: 0 };
		let version = 0;
		client.send.mockImplementation(async () => {
			version += 1;
			client.store.market = { dataVersion: version + 1 };
			return inlinePayload(version);
		});
		await expect(state.loadMarketSnapshot()).rejects.toThrow(
			"market snapshot changed too frequently",
		);
		expect(client.send).toHaveBeenCalledTimes(4);
		expect(state.marketSnapshotError.value).toBeInstanceOf(Error);
	});

	it("进行中的请求被并发调用复用(单飞),loading 状态随任务切换", async () => {
		const state = await loadState();
		client.store.market = {};
		let resolveSend!: (value: any) => void;
		client.send.mockImplementationOnce(
			() => new Promise((resolve) => (resolveSend = resolve)),
		);
		const first = state.loadMarketSnapshot();
		expect(state.marketSnapshotLoading.value).toBe(true);
		const second = state.loadMarketSnapshot();
		resolveSend(inlinePayload(1));
		const [a, b] = await Promise.all([first, second]);
		expect(b).toBe(a);
		expect(client.send).toHaveBeenCalledTimes(1);
		expect(state.marketSnapshotLoading.value).toBe(false);
	});

	it("store 尚无 key 时进行中的任务同样被复用", async () => {
		const state = await loadState();
		client.store.market = {};
		let resolveSend!: (value: any) => void;
		client.send.mockImplementationOnce(
			() => new Promise((resolve) => (resolveSend = resolve)),
		);
		const first = state.loadMarketSnapshot();
		resetStore(client.store);
		const second = state.loadMarketSnapshot();
		resolveSend(inlinePayload(1));
		const [a, b] = await Promise.all([first, second]);
		expect(b).toBe(a);
		expect(client.send).toHaveBeenCalledTimes(1);
	});

	it("请求期间 store 换新 key:后来的调用等旧任务落地后带新 key 重进", async () => {
		const state = await loadState();
		client.store.market = { dataVersion: 1 };
		let resolveFirst!: (value: any) => void;
		client.send.mockImplementationOnce(
			() => new Promise((resolve) => (resolveFirst = resolve)),
		);
		const first = state.loadMarketSnapshot();
		// 请求期间 store 被更新数据接管 → 第二次调用不再复用旧任务
		client.store.market = { dataVersion: 2 };
		client.send.mockResolvedValueOnce(inlinePayload(2));
		const second = state.loadMarketSnapshot();
		resolveFirst(inlinePayload(1));
		const [a, b] = await Promise.all([first, second]);
		expect(a.dataVersion).toBe(2);
		expect(b.dataVersion).toBe(2);
		// 第一次请求因 superseded 重试一次,第二次调用复用重试后的缓存
		expect(client.send).toHaveBeenCalledTimes(2);
	});

	it("非传输形态的解析错误直接抛出,不回退 inline", async () => {
		vi.doMock("../snapshot-utils", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../snapshot-utils")>();
			return {
				...actual,
				resolveMarketSnapshot: vi.fn().mockRejectedValue(new Error("boom")),
			};
		});
		const state = await loadState();
		client.store.market = {};
		client.send.mockResolvedValue(inlinePayload(1));
		await expect(state.loadMarketSnapshot()).rejects.toThrow("boom");
		expect(client.send).toHaveBeenCalledTimes(1);
		expect(state.marketSnapshotError.value).toBeInstanceOf(Error);
	});
});

describe("market/patch 增量合并", () => {
	it("服务端补丁与现有快照浅合并后重新发布", async () => {
		const state = await loadState();
		client.store.market = inlinePayload(1);
		await state.loadMarketSnapshot();
		expect(client.receive).toHaveBeenCalledOnce();
		const handler = client.receive.mock.calls[0]![1] as (value: any) => void;
		handler({
			data: { "koishi-plugin-bar": makeManifestEntry() },
			dataVersion: 5,
		});
		const data = state.marketSnapshot.value!.data;
		expect(data["koishi-plugin-foo"]).toBeDefined();
		expect(data["koishi-plugin-bar"]).toBeDefined();
		expect(state.marketSnapshot.value!.dataVersion).toBe(5);
		expect(client.store.market.data["koishi-plugin-bar"]).toBeDefined();
	});

	it("补丁不带 data 或尚无快照时忽略", async () => {
		const state = await loadState();
		const handler = client.receive.mock.calls[0]![1] as (value: any) => void;
		handler({ data: { "koishi-plugin-bar": makeManifestEntry() } });
		expect(state.marketSnapshot.value).toBeUndefined();
		expect(client.store.market).toBeUndefined();

		client.store.market = inlinePayload(1);
		await state.loadMarketSnapshot();
		const before = state.marketSnapshot.value;
		handler({});
		expect(state.marketSnapshot.value).toBe(before);
	});
});
