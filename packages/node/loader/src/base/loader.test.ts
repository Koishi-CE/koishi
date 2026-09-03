// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Loader 抽象基类行为测试（内存桩，不触盘）：migrateEntry 的 group 键
 * 重建与随机标识、readConfig 的迁移/插值/回写决策、writeConfig 的合并
 * 与静默语义、resolve/keyFor/replace 的插件反查、paths 的作用域路径
 * 计算、deprecated 别名转发与 group 插件的增删改联动。
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import {
	type Context,
	type Dict,
	type EffectScope,
	Logger,
	type Plugin,
	sleep,
} from "@koishi-ce/koishi";
import type { ResolvedConfigFile } from "./config-file.ts";
import { Loader } from "./index.ts";

beforeAll(() => {
	// createApp 期间 loader 的 apply/unload 与启动横幅均为生命周期 info；组配置
	// 更新会触发 "duplicate plugin" 的 app 域 warn——一并收敛为仅错误级
	const levels = Logger.levels as Record<string, number>;
	levels["loader"] = 1;
	levels["app"] = 1;
});

afterAll(() => {
	// 恢复域级阈值，避免同进程后续测试文件被连带静默
	const levels = Logger.levels as Record<string, number>;
	delete levels["loader"];
	delete levels["app"];
});

/** loader 测试桩：不落盘、不解析真实模块的 Loader 实现 */
class TestLoader extends Loader {
	/** 插件名 -> mock 插件对象 的内存注册表 */
	data: Dict<unknown> = Object.create(null);

	/** saveConfig 收到的写盘请求（配置回写链路的观察口） */
	writes: { filename: string; config: unknown }[] = [];

	/** parseConfig 返回的预设配置（readConfig 的数据源） */
	parsed: unknown = {};

	/** fullReload 收到的调用记录 */
	reloads: number[] = [];

	override async import(name: string) {
		return (this.data[name] ||= {
			name,
			apply: (ctx: Context) => {
				ctx.accept();
			},
		});
	}

	override fullReload(code?: number) {
		this.reloads.push(code ?? -1);
	}

	protected override locateConfig(): Promise<ResolvedConfigFile> {
		throw new Error("test loader does not touch the file system");
	}

	protected override async parseConfig(): Promise<unknown> {
		return this.parsed;
	}

	protected override async saveConfig(filename: string, config: unknown) {
		this.writes.push({ filename, config });
	}
}

/** 暴露 protected 成员的探针桩（仅供测试直调） */
class ExposedLoader extends TestLoader {
	exposedMigrateEntry(name: string, config?: Dict<unknown>) {
		return this.migrateEntry(name, config);
	}
}

/** 新建已初始化读写状态的桩（filename/mime 仅为传递参数） */
function setupLoader(parsed: unknown, writable = true) {
	const loader = new ExposedLoader();
	loader.parsed = parsed;
	loader.config = parsed as Context.Config;
	loader.writable = writable;
	loader.filename = "koishi.yml";
	loader.mime = "application/yaml";
	return loader;
}

describe("Loader.migrateEntry", () => {
	it("非 group 名直接返回 undefined", () => {
		const loader = setupLoader({});
		expect(loader.exposedMigrateEntry("foo", {})).toBeUndefined();
	});

	it("group 键重建：$ 前缀原样、已有标识保持、缺标识生成随机标识", () => {
		const loader = setupLoader({});
		const result = loader.exposedMigrateEntry("group", {
			$if: true,
			"a:x": { v: 1 },
			b: { v: 2 },
			"~c": { v: 3 },
		});
		expect(result?.["$if"]).toBe(true);
		expect(result?.["a:x"]).toEqual({ v: 1 });
		const keys = Object.keys(result ?? {});
		expect(keys[0]).toBe("$if");
		expect(keys[1]).toBe("a:x");
		// 无标识键（含 ~ 前缀形态）规范化为 name:ident，值保持原配置
		expect(keys[2]).toMatch(/^b:[0-9a-z]{6}$/);
		expect(result?.[keys[2] as string]).toEqual({ v: 2 });
		expect(keys[3]).toMatch(/^~c:[0-9a-z]{6}$/);
		expect(result?.[keys[3] as string]).toEqual({ v: 3 });
	});
	it("标识冲突时生成新的随机标识保证唯一", () => {
		const loader = setupLoader({});
		const result = loader.exposedMigrateEntry("group", {
			"a:x": {},
			"b:x": {},
		});
		const keys = Object.keys(result ?? {});
		expect(keys[0]).toBe("a:x");
		expect(keys[1]).not.toBe("b:x");
		expect(keys[1]).toMatch(/^b:[0-9a-z]{6}$/);
	});

	it("嵌套 group 递归重建", () => {
		const loader = setupLoader({});
		const result = loader.exposedMigrateEntry("group", {
			"group:outer": { inner: {} },
		});
		const outer = (result?.["group:outer"] ?? {}) as Dict<unknown>;
		expect(Object.keys(outer)[0]).toMatch(/^inner:[0-9a-z]{6}$/);
	});
});

describe("Loader.readConfig", () => {
	it("initial 读取执行迁移并回写，返回插值后的配置", async () => {
		const loader = setupLoader({
			name: "n-${{ env.LDR_BASE_VAR }}",
			plugins: { plain: {} },
		});
		process.env["LDR_BASE_VAR"] = "value";
		try {
			const config = await loader.readConfig(true);
			expect(config.name).toBe("n-value");
			// 回写一次，内容为插值前的原始配置（plain 键已被迁移规范化）
			expect(loader.writes).toHaveLength(1);
			const written = loader.writes[0]?.config as Dict<unknown>;
			expect(written["name"]).toBe("n-${{ env.LDR_BASE_VAR }}");
			expect(Object.keys(written["plugins"] as Dict<unknown>)[0]).toMatch(
				/^plain:[0-9a-z]{6}$/,
			);
		} finally {
			delete process.env["LDR_BASE_VAR"];
		}
	});

	it("非首次读取不迁移，只读状态不回写", async () => {
		const loader = setupLoader({ plugins: { plain: {} } }, false);
		const config = await loader.readConfig();
		// Context.Config 会展开 schema 默认值，只校验插件表原样透传
		expect(config.plugins).toEqual({ plain: {} });
		// 只读配置跳过回写，plugins 键未被迁移改写
		expect(loader.writes).toHaveLength(0);
		expect(loader.config.plugins).toEqual({ plain: {} });
	});
});

describe("Loader.writeConfig", () => {
	it("同轮微任务内的多次调用合并为一次写盘", async () => {
		const loader = setupLoader({});
		const first = loader.writeConfig(true);
		const second = loader.writeConfig(true);
		expect(second).toBe(first);
		await first;
		expect(loader.writes).toHaveLength(1);
		// 下一轮可再次写盘
		await loader.writeConfig(true);
		expect(loader.writes).toHaveLength(2);
	});

	it("任一非静默调用使本轮写盘广播 config 事件", async () => {
		const loader = setupLoader({});
		const emit = mock();
		loader.app = { emit } as unknown as Context;
		await Promise.all([loader.writeConfig(true), loader.writeConfig(false)]);
		expect(emit).toHaveBeenCalledTimes(1);
		expect(emit).toHaveBeenCalledWith("config");
	});

	it("全部静默时不广播事件", async () => {
		const loader = setupLoader({});
		const emit = mock();
		loader.app = { emit } as unknown as Context;
		await loader.writeConfig(true);
		expect(emit).not.toHaveBeenCalled();
	});

	it("只读配置写盘抛错", async () => {
		const loader = setupLoader({}, false);
		await expect(loader.writeConfig()).rejects.toThrow(
			"cannot overwrite readonly config",
		);
	});
});

describe("Loader.interpolate / isTruthyLike", () => {
	it("递归插值字符串/数组/对象", () => {
		const loader = setupLoader({});
		process.env["LDR_INT_VAR"] = "1";
		try {
			expect(
				loader.interpolate({
					a: "${{ env.LDR_INT_VAR }}",
					b: ["${{ env.LDR_INT_VAR }}"],
					c: 1,
					d: null,
				}),
			).toEqual({ a: "1", b: ["1"], c: 1, d: null });
		} finally {
			delete process.env["LDR_INT_VAR"];
		}
	});

	it("isTruthyLike：缺省为真，按插值结果求值", () => {
		const loader = setupLoader({});
		expect(loader.isTruthyLike(null)).toBe(true);
		expect(loader.isTruthyLike(undefined)).toBe(true);
		expect(loader.isTruthyLike("env.LDR_MISSING_VAR")).toBe(false);
		process.env["LDR_PRESENT_VAR"] = "1";
		try {
			expect(loader.isTruthyLike("env.LDR_PRESENT_VAR")).toBe(true);
		} finally {
			delete process.env["LDR_PRESENT_VAR"];
		}
	});
});

describe("Loader 插件反查（resolve / keyFor / replace）", () => {
	it("挂载后的插件可反查短名，replace 迁移反查记录", async () => {
		const loader = setupLoader({ plugins: {} });
		const app = await loader.createApp();

		const foo = (await loader.import("koishi-plugin-foo")) as Plugin.Object;
		app.plugin(foo);
		await loader.resolve("koishi-plugin-foo");
		expect(loader.keyFor(foo)).toBe("foo");

		// 未登记的插件反查为 undefined
		const unknown: Plugin.Object = { name: "unknown", apply: () => {} };
		expect(loader.keyFor(unknown)).toBeUndefined();

		// replace：把 foo 的反查记录迁移到 bar
		const bar: Plugin.Object = { name: "bar", apply: () => {} };
		app.plugin(bar);
		loader.replace(foo, bar);
		expect(loader.keyFor(foo)).toBeUndefined();
		expect(loader.keyFor(bar)).toBe("foo");

		// 任意一侧未注册时 replace 不生效
		loader.replace(unknown, unknown);
		expect(loader.keyFor(unknown)).toBeUndefined();
	});

	it("deprecated 别名转发到新方法", async () => {
		const loader = setupLoader({ plugins: {} });
		const app = await loader.createApp();

		// resolvePlugin → resolve
		const plugin = await loader.resolvePlugin("koishi-plugin-alias");
		// data 注册表按 Dict<unknown> 声明，按被比较侧的 Plugin 形状收窄
		expect(plugin).toBe(
			loader.data["koishi-plugin-alias"] as Plugin | undefined,
		);

		// reloadPlugin → reload（group 引用键挂载出 fork，可反查完整引用键）
		const fork = await loader.reloadPlugin(app, "group:alias", {});
		expect(fork).toBeTruthy();
		expect(loader.getRefName(fork!)).toBe("group:alias");

		// unloadPlugin → unload（卸载后引用记录被清除）
		loader.unloadPlugin(app, "group:alias");
		expect(loader.getRefName(fork!)).toBeUndefined();
	});
});

describe("Loader.paths", () => {
	it("根作用域为空、fork 取自身标识、runtime 聚合子路径", async () => {
		const loader = setupLoader({
			plugins: { "group:g": { "baz:qux": {} } },
		});
		const app = await loader.createApp();

		// 根作用域：路径为空
		expect(loader.paths(app.scope)).toEqual([]);

		// 根组 fork：key 为 "entry"
		const entryFork = await loader.reload(app, "group:aux", {});
		expect(loader.paths(entryFork as unknown as EffectScope)).toEqual(["aux"]);

		// runtime 作用域：聚合其全部子 fork 的路径（顶层各 fork 的标识）
		expect(loader.paths(loader.entry.scope.runtime)).toEqual([
			"entry",
			"g",
			"aux",
		]);

		// 无标识的 fork（key 为空）沿父级上溯到根
		const plainFork = await loader.reload(app, "plain", {});
		expect(loader.paths(plainFork as unknown as EffectScope)).toEqual([]);
	});
});

describe("group 插件", () => {
	it("配置更新后新增键挂载、保留键存活", async () => {
		const loader = setupLoader({
			plugins: { "group:g": { a: {}, b: {} } },
		});
		const app = await loader.createApp();
		expect(app.registry.get(loader.data["a"] as Plugin)).toBeTruthy();
		expect(app.registry.get(loader.data["b"] as Plugin)).toBeTruthy();

		// 更新：保留 b、新增 c（组配置键变更会触发 cordis 的 fork 重建，
		// 删除键的行为受 restart 语义影响，此处只断言结果形态）
		loader.config = {
			plugins: { "group:g": { b: {}, c: {} } },
		} as Context.Config;
		app.scope.update(loader.config);
		await sleep(10);

		expect(app.registry.get(loader.data["b"] as Plugin)).toBeTruthy();
		expect(app.registry.get(loader.data["c"] as Plugin)).toBeTruthy();
	});

	it("$ 前缀与 ~ 前缀的键不参与加载", async () => {
		const loader = setupLoader({
			plugins: {
				"~disabled": {},
				$comment: "meta",
				enabled: {},
			},
		});
		const app = await loader.createApp();
		expect(app.registry.get(loader.data["enabled"] as Plugin)).toBeTruthy();
		expect(loader.data["~disabled"]).toBeUndefined();
		expect(loader.data["$comment"]).toBeUndefined();
	});
});
