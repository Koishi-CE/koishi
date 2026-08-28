import { describe, expect, it, vi } from "vitest";

/**
 * @file market 域顶层出口(market/index.ts)的单元测试。
 *
 * mock @koishi-ce/client(组件经 utils 链依赖 send/store),验证四个组件
 * 导出与 utils 聚合符号的 re-export 面,node 环境下仅做模块加载与
 * 符号同一性断言,不渲染 DOM。
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

describe("market 顶层出口", () => {
	it("导出四个组件与 utils 聚合符号", async () => {
		const mod = await import("../index");
		const utils = await import("../utils");
		expect(mod.MarketIcon).toBeTruthy();
		expect(mod.MarketFilter).toBeTruthy();
		expect(mod.MarketList).toBeTruthy();
		expect(mod.MarketSearch).toBeTruthy();
		expect(mod.badges).toBe(utils.badges);
		expect(mod.getSortedPrepared).toBe(utils.getSortedPrepared);
		expect(mod.getUsers).toBe(utils.getUsers);
		expect(mod.isPluginPackage).toBe(utils.isPluginPackage);
	});
});
