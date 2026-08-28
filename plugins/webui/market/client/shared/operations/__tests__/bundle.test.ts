import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginBundleManifest } from "../../../../src/shared/bundle";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file bundle.ts 的单元测试:本地合包记录推导、分组路径反查、
 * 成员配置节点分布统计、远端记录拉取与回退链。
 *
 * 合包命名样例 koishi-plugin-pa-demo:短名 pa-demo,分组标识 pa-pa-demo,
 * groupKey 形如 group:pa-pa-demo(见 src/shared/bundle-idents)。
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
	createLocalBundleRecord,
	fetchBundleRecord,
	getBundleMemberConfigState,
	resolveBundlePackageFromGroup,
	resolveBundleRecordFromGroup,
} = await import("../bundle");

const BUNDLE = "koishi-plugin-pa-demo";

/** 构造带两成员的 koishi.bundle 清单。 */
function manifest(label?: string): PluginBundleManifest {
	return {
		label,
		members: [
			{ package: "koishi-plugin-foo", plugin: "foo", version: "^1.0.0" },
			{ package: "koishi-plugin-bar", plugin: "bar", version: "^2.0.0" },
		],
	};
}

/** 布置本地已装合包:store.packages 里带 koishi.bundle 字段的 package.json。 */
function installLocalBundle(
	name = BUNDLE,
	bundle = manifest(),
	version = "1.0.0",
) {
	store.packages[name] = { package: { name, version, koishi: { bundle } } };
}

beforeEach(() => {
	store.packages = {};
	store.dependencies = {};
	send.mockReset();
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createLocalBundleRecord", () => {
	it("非合包命名直接返回 undefined", () => {
		expect(createLocalBundleRecord("koishi-plugin-normal")).toBeUndefined();
	});

	it("本地未安装(packages 与 dependencies 均无)时返回 undefined", () => {
		expect(createLocalBundleRecord(BUNDLE)).toBeUndefined();
	});

	it("已装但无 koishi.bundle 字段或清单成员为空时返回 undefined", () => {
		installLocalBundle(BUNDLE, null as any);
		expect(createLocalBundleRecord(BUNDLE)).toBeUndefined();
		installLocalBundle(BUNDLE, { members: [] });
		expect(createLocalBundleRecord(BUNDLE)).toBeUndefined();
	});

	it("从本地 package.json 推导记录:成员全选、skipped、版本取已装版本", () => {
		installLocalBundle(BUNDLE, manifest("演示合包"), "3.2.1");
		const record = createLocalBundleRecord(BUNDLE);
		expect(record).toMatchObject({
			package: BUNDLE,
			version: "3.2.1",
			label: "演示合包",
			groupKey: "group:pa-pa-demo",
			installedAt: 0,
			members: [
				{
					package: "koishi-plugin-foo",
					selected: true,
					installedByBundle: false,
					skipped: true,
				},
				{
					package: "koishi-plugin-bar",
					selected: true,
					installedByBundle: false,
					skipped: true,
				},
			],
		});
	});

	it("版本取 dependencies.resolved,优先于 packages 里的 package.version", () => {
		store.dependencies[BUNDLE] = { resolved: "2.0.0" };
		store.packages[BUNDLE] = {
			package: { version: "1.0.0", koishi: { bundle: manifest() } },
		};
		expect(createLocalBundleRecord(BUNDLE)?.version).toBe("2.0.0");
		delete store.dependencies[BUNDLE];
		expect(createLocalBundleRecord(BUNDLE)?.version).toBe("1.0.0");
	});

	it("仅 dependencies 有记录(无 package.json 可解析)时返回 undefined", () => {
		store.dependencies[BUNDLE] = { resolved: "2.0.0" };
		expect(createLocalBundleRecord(BUNDLE)).toBeUndefined();
	});

	it("清单缺 label 时用合包短名兜底", () => {
		installLocalBundle(BUNDLE, manifest(), "1.0.0");
		expect(createLocalBundleRecord(BUNDLE)?.label).toBe("pa-demo");
	});
});

describe("resolveBundlePackageFromGroup", () => {
	it("无分组路径时返回 undefined", () => {
		expect(resolveBundlePackageFromGroup(undefined)).toBeUndefined();
	});

	it("持久化记录的 groupKey 命中(带或不带 group: 前缀)", () => {
		const records = {
			[BUNDLE]: { groupKey: "group:pa-pa-demo", package: BUNDLE },
		} as any;
		expect(resolveBundlePackageFromGroup("group:pa-pa-demo", records)).toBe(
			BUNDLE,
		);
		expect(resolveBundlePackageFromGroup("pa-pa-demo", records)).toBe(BUNDLE);
	});

	it("无持久化记录时遍历本地已装包,以分组标识比对(裸标识)", () => {
		store.dependencies["koishi-plugin-normal"] = { resolved: "1.0.0" };
		installLocalBundle();
		expect(resolveBundlePackageFromGroup("group:pa-pa-demo")).toBe(BUNDLE);
		expect(resolveBundlePackageFromGroup("pa-other")).toBeUndefined();
	});

	it("依赖表与包表取并集参与查找", () => {
		store.dependencies[BUNDLE] = { resolved: "1.0.0" };
		store.packages[BUNDLE] = {
			package: { version: "1.0.0", koishi: { bundle: manifest() } },
		};
		expect(resolveBundlePackageFromGroup("pa-pa-demo")).toBe(BUNDLE);
	});
});

describe("resolveBundleRecordFromGroup", () => {
	it("持久化记录优先于本地推导", () => {
		installLocalBundle();
		const persisted = {
			package: BUNDLE,
			version: "9.9.9",
			installedAt: 42,
			members: [],
		} as any;
		expect(
			resolveBundleRecordFromGroup("group:pa-pa-demo", { [BUNDLE]: persisted }),
		).toBe(persisted);
	});

	it("无持久化记录时回退本地推导视图", () => {
		installLocalBundle();
		expect(resolveBundleRecordFromGroup("pa-pa-demo")?.version).toBe("1.0.0");
	});

	it("反查不到包名时返回 undefined", () => {
		expect(resolveBundleRecordFromGroup("pa-none")).toBeUndefined();
	});
});

describe("getBundleMemberConfigState", () => {
	/** 构造 ctx:configWriter 服务按包名/插件键两键都能查。 */
	function createContext(nodesByPackage: any[], nodesByPlugin: any[] = []) {
		const writer = {
			get: vi.fn((key: string) =>
				key === "koishi-plugin-foo" ? nodesByPackage : nodesByPlugin,
			),
		};
		return { get: () => writer } as any;
	}

	const member = { package: "koishi-plugin-foo", plugin: "foo" };

	it("按 path/id 去重后,父节点在组内的归 group、组外的归 external", () => {
		const inGroup = {
			path: "plugins.foo",
			parent: { path: "group:pa-pa-demo" },
		};
		const outside = { id: "node-2", parent: { path: "group:other" } };
		const duplicate = { path: "plugins.foo", parent: undefined };
		const ctx = createContext([inGroup, outside], [duplicate, inGroup]);
		const state = getBundleMemberConfigState(ctx, member, "group:pa-pa-demo");
		expect(state.all).toHaveLength(2);
		expect(state.group).toEqual([inGroup]);
		expect(state.external).toEqual([outside]);
	});

	it("groupKey 用裸标识也能命中(两侧前缀归一)", () => {
		const node = { path: "x", parent: { id: "group:pa-pa-demo" } };
		const state = getBundleMemberConfigState(
			createContext([node]),
			member,
			"pa-pa-demo",
		);
		expect(state.group).toEqual([node]);
		expect(state.external).toEqual([]);
	});

	it("member.plugin 为空串时只按包名查一次", () => {
		const node = { path: "x", parent: { path: "group:pa-pa-demo" } };
		const ctx = createContext([node]);
		const state = getBundleMemberConfigState(
			ctx,
			{ package: "koishi-plugin-foo", plugin: "" },
			"pa-pa-demo",
		);
		expect(state.all).toEqual([node]);
		expect(ctx.get("configWriter").get).toHaveBeenCalledTimes(1);
	});

	it("缺 groupKey 或节点缺父路径时全部归 external", () => {
		const node = { path: "x" };
		expect(
			getBundleMemberConfigState(createContext([node]), member).external,
		).toEqual([node]);
		const withParent = { path: "y", parent: { path: "group:pa-pa-demo" } };
		expect(
			getBundleMemberConfigState(createContext([withParent]), member).external,
		).toEqual([withParent]);
	});

	it("未安装 config 插件时三组均为空数组", () => {
		const ctx = { get: () => undefined } as any;
		expect(getBundleMemberConfigState(ctx, member, "pa-pa-demo")).toEqual({
			all: [],
			group: [],
			external: [],
		});
	});

	it("writer 返回的列表里混入空节点时被跳过", () => {
		const node = { path: "x", parent: { path: "group:pa-pa-demo" } };
		const state = getBundleMemberConfigState(
			createContext([null, node]),
			member,
			"pa-pa-demo",
		);
		expect(state.all).toEqual([node]);
	});
});

describe("fetchBundleRecord", () => {
	it("非合包命名直接返回 undefined 且不发 RPC", async () => {
		expect(await fetchBundleRecord("koishi-plugin-normal")).toBeUndefined();
		expect(send).not.toHaveBeenCalled();
	});

	it("RPC 失败或无 versions 时回退本地推导", async () => {
		installLocalBundle();
		send.mockRejectedValue(new Error("network down"));
		expect((await fetchBundleRecord(BUNDLE))?.version).toBe("1.0.0");
		send.mockResolvedValue({ versions: undefined });
		expect((await fetchBundleRecord(BUNDLE))?.version).toBe("1.0.0");
	});

	it("远端 versions 为空对象时(无可用 entry)也回退本地推导", async () => {
		installLocalBundle();
		send.mockResolvedValue({ versions: {} });
		expect((await fetchBundleRecord(BUNDLE))?.version).toBe("1.0.0");
	});

	it("优先取本地已装版本对应的远端清单", async () => {
		store.dependencies[BUNDLE] = { resolved: "2.0.0" };
		send.mockResolvedValue({
			versions: {
				"2.0.0": {
					koishi: { bundle: { label: "v2", members: manifest().members } },
				},
				"1.0.0": {
					koishi: { bundle: { label: "v1", members: manifest().members } },
				},
			},
		});
		const record = await fetchBundleRecord(BUNDLE);
		expect(record).toMatchObject({
			version: "2.0.0",
			label: "v2",
			fallback: true,
		});
	});

	it("本地版本在远端不存在时取远端第一个版本", async () => {
		store.packages[BUNDLE] = {
			package: { version: "0.1.0", koishi: { bundle: manifest() } },
		};
		send.mockResolvedValue({
			versions: {
				"3.0.0": {
					koishi: { bundle: { label: "v3", members: manifest().members } },
				},
			},
		});
		expect((await fetchBundleRecord(BUNDLE))?.version).toBe("3.0.0");
	});

	it("远端清单成员为空时回退本地推导", async () => {
		installLocalBundle();
		send.mockResolvedValue({
			versions: { "1.0.0": { koishi: { bundle: { members: [] } } } },
		});
		expect((await fetchBundleRecord(BUNDLE))?.label).toBe("pa-demo");
	});

	it("本地也未安装且远端无可用清单时返回 undefined", async () => {
		send.mockResolvedValue({});
		expect(await fetchBundleRecord(BUNDLE)).toBeUndefined();
	});
});
