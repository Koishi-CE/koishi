import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file data-store.ts 的单元测试:前端数据仓的兜底初始化、各子表读取、
 * 双写补丁的本地合并与服务端回填。
 */

vi.mock("@koishi-ce/client", async () => {
	const { createKoishiClientStub } = await import("../../__tests__/helpers");
	return createKoishiClientStub();
});

// vi.mock 只是运行时替换,tsc 仍按真实模块类型推导;统一断言为桩视图
const { send, store } = (await import(
	"@koishi-ce/client"
)) as unknown as KoishiClientStub;
const {
	getBundleRecords,
	getCollapsedGroups,
	getMarketDataStore,
	getPendingOverrides,
	getWritableBundleRecords,
	patchMarketNextData,
} = await import("../data-store");

beforeEach(() => {
	send.mockReset();
	store.marketData = undefined;
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("getMarketDataStore", () => {
	it("store.marketData 缺失时落到本地兜底仓,重复读取返回同一引用", () => {
		const first = getMarketDataStore();
		expect(getMarketDataStore()).toBe(first);
		expect(store.marketData).toBe(first);
		expect(first).toMatchObject({
			override: {},
			updateIgnored: {},
			bundleRecords: {},
			collapsedGroups: {},
		});
	});

	it("store.marketData 已由服务端推送时直接返回该对象", () => {
		const pushed = { override: { "pkg-a": "^1.0.0" } };
		store.marketData = pushed;
		expect(getMarketDataStore()).toBe(pushed);
	});
});

describe("子表读取", () => {
	it("override 与折叠表缺失时就地初始化,已有则原样返回", () => {
		store.marketData = {};
		expect(getPendingOverrides()).toEqual({});
		expect(getCollapsedGroups()).toEqual({});
		const overrides = { "pkg-a": "" };
		const collapsed = { group: true };
		store.marketData = { override: overrides, collapsedGroups: collapsed };
		expect(getPendingOverrides()).toBe(overrides);
		expect(getCollapsedGroups()).toBe(collapsed);
	});

	it("合包记录只读视图缺失时返回空对象,可写视图就地初始化", () => {
		store.marketData = {};
		expect(getBundleRecords()).toEqual({});
		const writable = getWritableBundleRecords();
		expect(writable).toEqual({});
		expect(getWritableBundleRecords()).toBe(writable);
		const records = { "koishi-plugin-pa-demo": { package: "x" } };
		store.marketData = { bundleRecords: records };
		expect(getBundleRecords()).toBe(records);
	});
});

describe("patchMarketNextData", () => {
	it("本地立即合并,服务端回填规整后的完整数据并返回 true", async () => {
		send.mockResolvedValue({
			collapsedGroups: { group: true },
			override: { "pkg-a": "^2.0.0" },
		});
		await expect(
			patchMarketNextData({ override: { "pkg-a": "^1.0.0" } }),
		).resolves.toBe(true);
		expect(store.marketData).toMatchObject({
			override: { "pkg-a": "^2.0.0" },
			collapsedGroups: { group: true },
		});
	});

	it("RPC 无任务返回 false(本地已合并)", async () => {
		send.mockReturnValue(undefined);
		await expect(
			patchMarketNextData({ collapsedGroups: { g: false } }),
		).resolves.toBe(false);
		expect(getCollapsedGroups()).toEqual({ g: false });
	});

	it("RPC 失败返回 false 并只告警", async () => {
		send.mockRejectedValue(new Error("rpc down"));
		await expect(patchMarketNextData({})).resolves.toBe(false);
	});
});
