import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @file 市场页运行时上下文(context.ts)的单元测试。
 *
 * mock @koishi-ce/client(store 供快照数据查询)与 ../shared/i18n(避免拉起
 * 真实 vue-i18n 装配)。覆盖:formatShortname 的市场短名/官方与常规前缀/
 * scoped 相对形态/原名兜底、isPluginPackage 命名正则与 useMarketI18n 的
 * market. 前缀拼接。
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

vi.mock("../../shared/i18n", () => ({
	useMarketNextI18n: () => ({
		t: (key: string, ...args: any[]) => ({ key, args }),
		locale: { value: "zh-CN" },
	}),
}));

import { resetStore } from "./helpers";

type ContextModule = typeof import("../context");

async function loadContext(): Promise<ContextModule> {
	vi.resetModules();
	return await import("../context");
}

beforeEach(() => {
	resetStore(client.store);
});

describe("formatShortname", () => {
	it("运行时快照提供的市场短名最优先", async () => {
		const context = await loadContext();
		client.store.market = {
			data: { "koishi-plugin-foo": { shortname: "Foo Bar" } },
		};
		expect(context.formatShortname("koishi-plugin-foo")).toBe("Foo Bar");
	});

	it("短名与全名相同时继续走前缀削减", async () => {
		const context = await loadContext();
		client.store.market = {
			data: { "koishi-plugin-foo": { shortname: "koishi-plugin-foo" } },
		};
		expect(context.formatShortname("koishi-plugin-foo")).toBe("foo");
	});

	it("官方与常规插件前缀被剥离", async () => {
		const context = await loadContext();
		expect(context.formatShortname("@koishijs/plugin-foo")).toBe("foo");
		expect(context.formatShortname("koishi-plugin-foo")).toBe("foo");
	});

	it("scoped 包保留相对形态,其余原名返回", async () => {
		const context = await loadContext();
		expect(context.formatShortname("@scope/koishi-plugin-foo")).toBe(
			"@scope/foo",
		);
		expect(context.formatShortname("@scope/other-pkg")).toBe(
			"@scope/other-pkg",
		);
		expect(context.formatShortname("webui")).toBe("webui");
	});
});

describe("isPluginPackage", () => {
	it("官方与常规(含 scoped)插件包名通过", async () => {
		const context = await loadContext();
		expect(context.isPluginPackage("@koishijs/plugin-foo")).toBe(true);
		expect(context.isPluginPackage("koishi-plugin-foo")).toBe(true);
		expect(context.isPluginPackage("@scope/koishi-plugin-foo")).toBe(true);
		expect(context.isPluginPackage("path/koishi-plugin-foo")).toBe(true);
	});

	it("非插件包名、大写、空前缀与空短名被拒绝", async () => {
		const context = await loadContext();
		expect(context.isPluginPackage("@koishijs/plug-foo")).toBe(false);
		expect(context.isPluginPackage("koishi-plugin-Foo")).toBe(false);
		expect(context.isPluginPackage("koishi-plugin-")).toBe(false);
		expect(context.isPluginPackage("xkoishi-plugin-foo")).toBe(false);
		expect(context.isPluginPackage("foo")).toBe(false);
	});
});

describe("useMarketI18n / kConfig", () => {
	it("t 函数自动追加 market. 前缀并透传参数", async () => {
		const context = await loadContext();
		const { t, locale } = context.useMarketI18n();
		const result = t("filter.title", 1, "x") as any;
		expect(result.key).toBe("market.filter.title");
		expect(result.args).toEqual([1, "x"]);
		expect(locale.value).toBe("zh-CN");
	});

	it("kConfig 是注入键(Symbol)", async () => {
		const context = await loadContext();
		expect(typeof context.kConfig).toBe("symbol");
	});
});
