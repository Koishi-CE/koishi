import { describe, expect, it, vi } from "vitest";

vi.mock("../../installer/index.js", () => ({
	SELF_PACKAGE: "@koishi-ce/plugin-marketn",
}));
vi.mock("../index.js", () => ({
	configPatchKeys: ["bulkMode", "idleProbe", "marketSilentRules"],
	configReloadKeys: new Set(["idleProbe"]),
	normalizeMarketSilentRules: vi.fn((value: unknown) => value),
}));

import type { Config } from "../index.js";
import { normalizeMarketSilentRules } from "../index.js";
import {
	ensureMarketNextConfigDefaults,
	removeLegacyCollapsedGroupsConfig,
	updateMarketNextConfig,
} from "../manage.js";

/** koishi 内部 loader.record 符号（fork 表挂载键）。 */
const RECORD = Symbol.for("koishi.loader.record");

interface Fixture {
	writeConfig: ReturnType<typeof vi.fn>;
	reload: ReturnType<typeof vi.fn>;
	refresh: ReturnType<typeof vi.fn>;
	loaderEntry: { scope: Record<symbol | string, unknown> };
	asContext: () => unknown;
}

/** 构造 ctx 桩:loader.plugins 为传入对象,entry 的 fork 树含一个持有该 plugins 的叶子。 */
function context(
	plugins: Record<string, unknown>,
	options?: { entryHoldsPlugins?: boolean },
) {
	const writeConfig = vi.fn(async () => {});
	const refresh = vi.fn();
	const reload = vi.fn(async () => {});
	// entry → record fork → leaf(scope.config === plugins 的父级查找目标)
	const leafScope: Record<symbol | string, unknown> = options?.entryHoldsPlugins
		? { config: plugins }
		: { config: { other: true } };
	const leafCtx = { scope: leafScope };
	const entryScope: Record<symbol | string, unknown> = {
		config: { root: true },
		[RECORD]: { fork1: { ctx: leafCtx } },
	};
	const fixture: Fixture = {
		writeConfig,
		reload,
		refresh,
		loaderEntry: { scope: entryScope },
		asContext: () =>
			({
				loader: {
					config: { plugins },
					writable: true,
					writeConfig,
					entry: { scope: entryScope },
					reload,
				},
				get: () => ({ refresh }),
			}) as never,
	};
	return { fixture, ctx: fixture.asContext() as never };
}

/** 构造 loader.entry 缺失(entry 为 undefined)的 ctx 桩。 */
function contextWithoutEntry(plugins: Record<string, unknown>) {
	const refresh = vi.fn();
	const reload = vi.fn(async () => {});
	const writeConfig = vi.fn(async () => {});
	return {
		reload,
		refresh,
		asContext: () =>
			({
				loader: {
					config: { plugins },
					writable: true,
					writeConfig,
					entry: undefined,
					reload,
				},
				get: () => ({ refresh }),
			}) as never,
	};
}

describe("findMarketNextConfigNode（经公开操作间接验证）", () => {
	it("按新短名 @koishi-ce/plugin-marketn 定位并清理废弃键", () => {
		const config = {} as Config;
		const plugins = { "@koishi-ce/plugin-marketn": { marketLayout: "x" } };
		expect(ensureMarketNextConfigDefaults(context(plugins).ctx, config)).toBe(
			true,
		);
		// 废弃键被删除
		expect(plugins["@koishi-ce/plugin-marketn"]).toEqual({});
	});

	it("按旧短名 market-next 定位（含 :ident 后缀）", () => {
		const config = {} as Config;
		const plugins = { "market-next:ident": { marketLayout: "x" } };
		expect(ensureMarketNextConfigDefaults(context(plugins).ctx, config)).toBe(
			true,
		);
		expect(plugins["market-next:ident"]).toEqual({});
	});

	it("按配置对象引用（identity）定位", () => {
		const plugins: Record<string, unknown> = {};
		const config = { marketLayout: "x" } as unknown as Config;
		plugins["anything:else"] = config;
		expect(ensureMarketNextConfigDefaults(context(plugins).ctx, config)).toBe(
			true,
		);
		expect(plugins["anything:else"]).toEqual({});
	});

	it("深层 group 嵌套下定位", () => {
		const config = {} as Config;
		const plugins = {
			"group:a": {
				"group:b": { "group:c": { "market-next": { marketLayout: "x" } } },
			},
		};
		expect(ensureMarketNextConfigDefaults(context(plugins).ctx, config)).toBe(
			true,
		);
		expect(plugins["group:a"]["group:b"]["group:c"]["market-next"]).toEqual({});
	});

	it("仅有禁用节点时作为 fallback 返回", () => {
		const config = {} as Config;
		const plugins = { "~market-next:old": { marketLayout: "x" } };
		expect(ensureMarketNextConfigDefaults(context(plugins).ctx, config)).toBe(
			true,
		);
		// fallback 节点同样被清理
		expect(plugins["~market-next:old"]).toEqual({});
	});

	it("非对象候选值（null / 字符串 / $ 元键）被跳过", () => {
		const config = {} as Config;
		// biome-ignore lint/style/useNamingConvention: koishi 配置树的 $ 元键形态
		const plugins = {
			$label: "x",
			"market-next:1": null,
			"market-next:2": "str",
		};
		expect(ensureMarketNextConfigDefaults(context(plugins).ctx, config)).toBe(
			false,
		);
	});

	it("未启用优先于禁用 fallback（含 identity 命中）", () => {
		const disabledConfig = { marketLayout: "x" };
		const enabledConfig = { marketLayout: "y" };
		const plugins = {
			"~market-next:old": disabledConfig,
			"market-next:2": enabledConfig,
		};
		const { ctx } = context(plugins);
		expect(ensureMarketNextConfigDefaults(ctx, enabledConfig as Config)).toBe(
			true,
		);
		expect(enabledConfig).toEqual({});
		expect(disabledConfig).toEqual({ marketLayout: "x" });
	});

	it("找不到节点时各操作返回 false", async () => {
		const config = {} as Config;
		const { ctx } = context({ "other:1": {} });
		expect(ensureMarketNextConfigDefaults(ctx, config)).toBe(false);
		expect(removeLegacyCollapsedGroupsConfig(ctx, config)).toBe(false);
		expect(
			await updateMarketNextConfig(ctx, config, { marketSilentRules: [] }),
		).toBe(false);
	});
});

describe("ensureMarketNextConfigDefaults", () => {
	it("无废弃键时返回 false（无写盘需求）", () => {
		const config = {} as Config;
		const plugins = { "market-next": {} };
		expect(ensureMarketNextConfigDefaults(context(plugins).ctx, config)).toBe(
			false,
		);
	});
});

describe("removeLegacyCollapsedGroupsConfig", () => {
	it("删除存在的 collapsedGroups 字段,重复调用返回 false", () => {
		const config = {} as Config;
		const plugins = {
			"@koishi-ce/plugin-marketn": { collapsedGroups: { core: true } },
		};
		const { ctx } = context(plugins);

		expect(removeLegacyCollapsedGroupsConfig(ctx, config)).toBe(true);
		expect(plugins["@koishi-ce/plugin-marketn"]).toEqual({});
		expect(removeLegacyCollapsedGroupsConfig(ctx, config)).toBe(false);
	});
});

describe("updateMarketNextConfig", () => {
	it("按白名单应用 patch 并写盘、刷新 config 视图", async () => {
		const config = {} as Config;
		const plugins = { "@koishi-ce/plugin-marketn": { bulkMode: false } };
		const { ctx, fixture } = context(plugins);

		expect(await updateMarketNextConfig(ctx, config, { bulkMode: true })).toBe(
			true,
		);
		expect(plugins["@koishi-ce/plugin-marketn"]).toMatchObject({
			bulkMode: true,
		});
		expect(fixture.writeConfig).toHaveBeenCalledWith(true);
		expect(fixture.refresh).toHaveBeenCalledWith("config");
		expect(fixture.refresh).not.toHaveBeenCalledWith("entry");
		expect(fixture.reload).not.toHaveBeenCalled();
	});

	it("patch 不含白名单键时整体拒绝", async () => {
		const config = {} as Config;
		const plugins = { "market-next": {} };
		const { ctx, fixture } = context(plugins);

		expect(
			await updateMarketNextConfig(ctx, config, {
				registry: { endpoint: "x" },
			} as never),
		).toBe(false);
		expect(fixture.writeConfig).not.toHaveBeenCalled();
	});

	it("幂等 patch（白名单键值未变）返回 true 且不写盘", async () => {
		const config = {} as Config;
		const plugins = { "market-next": { bulkMode: true } };
		const { ctx, fixture } = context(plugins);

		expect(await updateMarketNextConfig(ctx, config, { bulkMode: true })).toBe(
			true,
		);
		expect(fixture.writeConfig).not.toHaveBeenCalled();
		expect(fixture.refresh).not.toHaveBeenCalled();
	});

	it("marketSilentRules 键入库前先归一化", async () => {
		const config = {} as Config;
		const plugins = { "market-next": {} };
		const { ctx } = context(plugins);

		await updateMarketNextConfig(ctx, config, { marketSilentRules: [] });
		expect(normalizeMarketSilentRules).toHaveBeenCalledWith([]);
	});

	it("涉及热重载键时定位父 Context 做单插件 reload 并补刷 entry", async () => {
		const config = {} as Config;
		const plugins = { "market-next": {} };
		const { ctx, fixture } = context(plugins, { entryHoldsPlugins: true });

		expect(
			await updateMarketNextConfig(ctx, config, { idleProbe: false }),
		).toBe(true);
		expect(fixture.reload).toHaveBeenCalledTimes(1);
		// reload 的第一参数应为 fork 树中持有该 plugins 的 leaf Context
		const leaf = (
			fixture.loaderEntry.scope[RECORD] as { fork1: { ctx: unknown } }
		).fork1.ctx;
		const [reloadCtx] = fixture.reload.mock.calls[0] as unknown[];
		expect(reloadCtx).toBe(leaf);
		expect(fixture.refresh).toHaveBeenCalledWith("config");
		expect(fixture.refresh).toHaveBeenCalledWith("entry");
	});

	it("目标键为禁用态（~ 前缀）时不 reload 仍刷新 entry", async () => {
		const config = {} as Config;
		const plugins = { "~market-next:old": {} };
		const { ctx, fixture } = context(plugins, { entryHoldsPlugins: true });

		expect(
			await updateMarketNextConfig(ctx, config, { idleProbe: false }),
		).toBe(true);
		expect(fixture.reload).not.toHaveBeenCalled();
		expect(fixture.refresh).toHaveBeenCalledWith("entry");
	});

	it("fork 树中找不到父 Context 时不 reload", async () => {
		const config = {} as Config;
		const plugins = { "market-next": {} };
		const { ctx, fixture } = context(plugins); // leaf 持有的是别的对象

		expect(
			await updateMarketNextConfig(ctx, config, { idleProbe: false }),
		).toBe(true);
		expect(fixture.reload).not.toHaveBeenCalled();
		expect(fixture.refresh).toHaveBeenCalledWith("entry");
	});

	it("loader.entry 缺失时不 reload", async () => {
		const config = {} as Config;
		const plugins = { "market-next": {} };
		const fixture = contextWithoutEntry(plugins);

		expect(
			await updateMarketNextConfig(fixture.asContext() as never, config, {
				idleProbe: false,
			}),
		).toBe(true);
		expect(fixture.reload).not.toHaveBeenCalled();
		expect(fixture.refresh).toHaveBeenCalledWith("entry");
	});
});
