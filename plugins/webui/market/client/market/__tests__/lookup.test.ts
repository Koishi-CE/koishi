import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @file 市场按需 lookup(lookup.ts)的单元测试。
 *
 * mock @koishi-ce/client(send/store),按用例 resetModules 隔离模块级缓存。
 * 覆盖:本地满足与 missing 登记、RPC 成功落地、服务名本地扫描、单飞去重、
 * 世代号丢弃过期响应、响应版本落后时的 force 重进、快照换版后的全量重放、
 * lookupCurrent 失效分支与空入参短路。
 */

const client = vi.hoisted(() => ({
	send: vi.fn(),
	store: {} as any,
}));

vi.mock("@koishi-ce/client", () => ({
	send: client.send,
	receive: vi.fn(),
	store: client.store,
}));

import { makeManifestEntry, resetStore } from "./helpers";

type LookupModule = typeof import("../lookup");

/** 每个用例重新加载模块,保证 lookup 缓存/世代号互不串扰。 */
async function loadLookup(): Promise<LookupModule> {
	vi.resetModules();
	return await import("../lookup");
}

/** 构造 market/lookup 的成功响应。 */
function lookupResponse(
	data: Record<string, any> = {},
	services: Record<string, string[]> = {},
	dataVersion = 1,
) {
	return { data, services, dataVersion };
}

beforeEach(() => {
	client.send.mockReset();
	resetStore(client.store);
});

describe("getMarketObject / getMarketServiceProviders", () => {
	it("未查询且快照无数据时返回 undefined / 空数组", async () => {
		const lookup = await loadLookup();
		expect(lookup.getMarketObject("koishi-plugin-foo")).toBeUndefined();
		expect(lookup.getMarketServiceProviders("dice")).toEqual([]);
	});

	it("当前快照(store)中的条目可直接命中", async () => {
		const lookup = await loadLookup();
		const entry = makeManifestEntry();
		client.store.market = { data: { "koishi-plugin-foo": entry } };
		expect(lookup.getMarketObject("koishi-plugin-foo")).toBe(entry);
	});

	it("RPC 落地的 lookup 缓存可命中", async () => {
		const lookup = await loadLookup();
		const entry = makeManifestEntry();
		const services = { dice: ["koishi-plugin-foo"] };
		client.send.mockResolvedValueOnce(
			lookupResponse({ "koishi-plugin-foo": entry }, services),
		);
		await lookup.loadMarketObjects(["koishi-plugin-foo"]);
		expect(lookup.getMarketObject("koishi-plugin-foo")).toBe(entry);
		expect(lookup.getMarketServiceProviders("dice")).toEqual([
			"koishi-plugin-foo",
		]);
	});
});

describe("loadMarketObjects / loadMarketServiceProviders", () => {
	it("快照数据可用时本地满足:不发请求,缺失名记入 missing", async () => {
		const lookup = await loadLookup();
		const entry = makeManifestEntry();
		client.store.market = { data: { "koishi-plugin-foo": entry } };
		await lookup.loadMarketObjects(["koishi-plugin-foo", "koishi-plugin-gone"]);
		expect(client.send).not.toHaveBeenCalled();
		// 换掉 store 使快照不可用后再次请求:已确认 missing 的名字被跳过
		resetStore(client.store);
		client.store.market = { dataVersion: 1 };
		await lookup.loadMarketObjects(["koishi-plugin-gone"]);
		expect(client.send).not.toHaveBeenCalled();
	});

	it("服务名在快照可用时本地扫描填充,不发请求", async () => {
		const lookup = await loadLookup();
		const provider = makeManifestEntry({
			package: {
				name: "koishi-plugin-dice",
				contributors: [],
				maintainers: [],
			},
		});
		client.store.market = { data: { "koishi-plugin-dice": provider } };
		await lookup.loadMarketServiceProviders(["dice"]);
		expect(client.send).not.toHaveBeenCalled();
		expect(lookup.getMarketServiceProviders("dice")).toEqual([
			"koishi-plugin-dice",
		]);
	});

	it("空入参与纯空白名直接短路", async () => {
		const lookup = await loadLookup();
		await lookup.loadMarketObjects([]);
		await lookup.loadMarketObjects(["  ", ""]);
		await lookup.loadMarketServiceProviders([]);
		expect(client.send).not.toHaveBeenCalled();
	});

	it("入参被归一化(trim/去重)后请求", async () => {
		const lookup = await loadLookup();
		client.send.mockResolvedValueOnce(lookupResponse());
		await lookup.loadMarketObjects([
			" koishi-plugin-foo ",
			"koishi-plugin-foo",
		]);
		expect(client.send).toHaveBeenCalledWith("market/lookup", {
			names: ["koishi-plugin-foo"],
			services: [],
		});
	});

	it("单飞去重:并发同质请求只发一次 RPC", async () => {
		const lookup = await loadLookup();
		let resolveSend: (value: any) => void = () => {};
		client.send.mockImplementationOnce(
			() => new Promise((resolve) => (resolveSend = resolve)),
		);
		const first = lookup.loadMarketObjects(["koishi-plugin-foo"]);
		const second = lookup.loadMarketObjects(["koishi-plugin-foo"]);
		resolveSend(lookupResponse({}, {}, 1));
		const [a, b] = await Promise.all([first, second]);
		expect(a).toBe(b);
		expect(client.send).toHaveBeenCalledTimes(1);
	});

	it("响应为 undefined 时静默返回", async () => {
		const lookup = await loadLookup();
		client.send.mockResolvedValueOnce(undefined);
		await expect(
			lookup.loadMarketObjects(["koishi-plugin-foo"]),
		).resolves.toBeUndefined();
		expect(lookup.getMarketObject("koishi-plugin-foo")).toBeUndefined();
	});

	it("已落地的名字在快照版本一致时跳过,版本漂移后重新请求", async () => {
		const lookup = await loadLookup();
		client.send.mockResolvedValueOnce(
			lookupResponse({ "koishi-plugin-foo": makeManifestEntry() }, {}, 1),
		);
		await lookup.loadMarketObjects(["koishi-plugin-foo"]);
		// lookupDataVersion 与 store 一致 → 命中缓存,不再发请求
		client.store.market = { dataVersion: 1 };
		await lookup.loadMarketObjects(["koishi-plugin-foo"]);
		expect(client.send).toHaveBeenCalledTimes(1);
		// store 版本前进 → lookupCurrent 失效 → 重新请求
		client.store.market = { dataVersion: 2 };
		client.send.mockResolvedValueOnce(lookupResponse({}, {}, 2));
		await lookup.loadMarketObjects(["koishi-plugin-foo"]);
		expect(client.send).toHaveBeenCalledTimes(2);
	});

	it("本地扫描过的服务名再次请求时跳过(hasOwnProperty 命中)", async () => {
		const lookup = await loadLookup();
		const provider = makeManifestEntry({
			package: {
				name: "koishi-plugin-dice",
				contributors: [],
				maintainers: [],
			},
		});
		client.store.market = { data: { "koishi-plugin-dice": provider } };
		await lookup.loadMarketServiceProviders(["dice"]);
		resetStore(client.store);
		await lookup.loadMarketServiceProviders(["dice"]);
		expect(client.send).not.toHaveBeenCalled();
	});

	it("响应版本落后于 store 时被 superseded,force 重发", async () => {
		const lookup = await loadLookup();
		client.store.market = { dataVersion: 5 };
		client.send
			.mockResolvedValueOnce(lookupResponse({}, {}, 3))
			.mockResolvedValueOnce(
				lookupResponse({ "koishi-plugin-foo": makeManifestEntry() }, {}, 5),
			);
		await lookup.loadMarketObjects(["koishi-plugin-foo"]);
		expect(client.send).toHaveBeenCalledTimes(2);
		expect(lookup.getMarketObject("koishi-plugin-foo")).toBeDefined();
	});
	it("世代号过期:refresh 后回来的旧响应被丢弃", async () => {
		const lookup = await loadLookup();
		let resolveFirst: (value: any) => void = () => {};
		client.send.mockImplementationOnce(
			() => new Promise((resolve) => (resolveFirst = resolve)),
		);
		const stale = lookup.loadMarketObjects(["koishi-plugin-foo"]);
		// refresh 使世代号 +1,并重放一次空响应
		client.send.mockResolvedValueOnce(undefined);
		await lookup.refreshMarketLookups();
		resolveFirst(
			lookupResponse({ "koishi-plugin-foo": makeManifestEntry() }, {}, 1),
		);
		await stale;
		expect(lookup.getMarketObject("koishi-plugin-foo")).toBeUndefined();
	});
});

describe("refreshMarketLookups", () => {
	it("无历史请求时直接返回,不发请求", async () => {
		const lookup = await loadLookup();
		await lookup.refreshMarketLookups();
		expect(client.send).not.toHaveBeenCalled();
	});

	it("快照换版后全量重放历史请求", async () => {
		const lookup = await loadLookup();
		client.send
			.mockResolvedValueOnce(
				lookupResponse({ "koishi-plugin-foo": makeManifestEntry() }, {}, 1),
			)
			.mockResolvedValueOnce(lookupResponse({}, { dice: [] }, 1))
			.mockResolvedValueOnce(
				lookupResponse(
					{ "koishi-plugin-bar": makeManifestEntry() },
					{ dice: ["koishi-plugin-bar"] },
					2,
				),
			);
		await lookup.loadMarketObjects(["koishi-plugin-foo"]);
		await lookup.loadMarketServiceProviders(["dice"]);
		await lookup.refreshMarketLookups();
		expect(client.send).toHaveBeenCalledTimes(3);
		// 重放后缓存被新数据替换
		expect(lookup.getMarketObject("koishi-plugin-foo")).toBeUndefined();
		expect(lookup.getMarketObject("koishi-plugin-bar")).toBeDefined();
		expect(lookup.getMarketServiceProviders("dice")).toEqual([
			"koishi-plugin-bar",
		]);
	});
});
