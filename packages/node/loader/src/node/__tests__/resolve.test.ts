/**
 * 插件名解析测试：候选说明符生成规则（对齐历史 ns-require 语义）、
 * Bun.resolveSync 实际解析，以及纯 fs 兜底（Bun 父目录快照缓存场景，
 * 即市场装完插件后同进程立即可加载的关键路径）。
 */
import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pluginCandidates, resolvePlugin } from "../resolve.ts";

describe("pluginCandidates", () => {
	it("裸短名：本组织优先，其次上游官方，最后社区前缀", () => {
		expect(pluginCandidates("foo", "/base")).toEqual([
			"@koishi-ce/plugin-foo",
			"@koishijs/plugin-foo",
			"koishi-plugin-foo",
		]);
	});

	it("已带社区前缀的完整包名直接采用", () => {
		expect(pluginCandidates("koishi-plugin-foo", "/base")).toEqual([
			"koishi-plugin-foo",
		]);
	});

	it("已带官方组织前缀的完整包名直接采用", () => {
		expect(pluginCandidates("@koishi-ce/plugin-foo", "/base")).toEqual([
			"@koishi-ce/plugin-foo",
		]);
	});

	it("scoped 名为内层补全社区前缀", () => {
		expect(pluginCandidates("@scope/foo", "/base")).toEqual([
			"@scope/koishi-plugin-foo",
		]);
		expect(pluginCandidates("@scope/koishi-plugin-foo", "/base")).toEqual([
			"@scope/koishi-plugin-foo",
		]);
	});

	it("仅组织名（无内层）抛错", () => {
		expect(() => pluginCandidates("@broken", "/base")).toThrow(
			'cannot resolve plugin "@broken"',
		);
	});

	it("相对路径相对 baseDir 解析为绝对路径", () => {
		expect(pluginCandidates("./local", "/base/dir")).toEqual([
			resolve("/base/dir", "./local"),
		]);
	});

	it("绝对路径直接采用", () => {
		expect(pluginCandidates(resolve("/x/y"), "/base")).toEqual([
			resolve("/x/y"),
		]);
	});
});

describe("resolvePlugin", () => {
	it("从 baseDir 的 node_modules 解析社区包入口", async () => {
		const dir = await fs.mkdtemp(join(tmpdir(), "koishi-loader-res-"));
		try {
			await fs.mkdir(join(dir, "node_modules", "koishi-plugin-foo"), {
				recursive: true,
			});
			await Bun.write(
				join(dir, "node_modules", "koishi-plugin-foo", "package.json"),
				JSON.stringify({ name: "koishi-plugin-foo", main: "index.js" }),
			);
			await Bun.write(
				join(dir, "node_modules", "koishi-plugin-foo", "index.js"),
				"module.exports = {}",
			);
			const resolved = resolvePlugin("foo", dir);
			expect(resolved).toBe(
				join(dir, "node_modules", "koishi-plugin-foo", "index.js"),
			);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("全部候选失败时抛错", () => {
		expect(() => resolvePlugin("definitely-not-a-plugin", "/")).toThrow(
			'cannot resolve plugin "definitely-not-a-plugin"',
		);
	});
});

describe("resolvePlugin 纯 fs 兜底（Bun 父目录快照缓存）", () => {
	/** 建立临时目录并在用后清理 */
	async function withDir(fn: (dir: string) => Promise<void>) {
		const dir = await fs.mkdtemp(join(tmpdir(), "koishi-loader-fsres-"));
		try {
			await fn(dir);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	}

	/** 落盘一个最小插件包并返回其目录 */
	async function writePlugin(
		pkgDir: string,
		meta: Record<string, unknown>,
		files: Record<string, string>,
	) {
		await fs.mkdir(pkgDir, { recursive: true });
		await Bun.write(
			join(pkgDir, "package.json"),
			JSON.stringify({ description: "", ...meta }),
		);
		for (const [name, content] of Object.entries(files)) {
			await Bun.write(join(pkgDir, name), content);
		}
		return pkgDir;
	}

	it("市场安装时序：装包前解析失败触发快照后，落盘包由 fs 兜底命中", async () => {
		await withDir(async (dir) => {
			// 预建 node_modules（生产中恒存在——Bun 父目录快照缓存的
			// 触发条件：解析失败时包的父目录已存在）
			await fs.mkdir(join(dir, "node_modules"), { recursive: true });
			// 装包前解析：三候选必然失败（Bun.resolveSync 失败 + fs 兜底
			// 也找不到），同时把目录快照写入解析缓存
			expect(() => resolvePlugin("late-install", dir)).toThrow(
				'cannot resolve plugin "late-install"',
			);

			// 同进程落盘（模拟市场 bun install 完成）——Bun.resolveSync 因
			// 快照仍失败，fs 兜底应命中入口绝对路径（无需重启进程）
			const pkgDir = await writePlugin(
				join(dir, "node_modules", "koishi-plugin-late-install"),
				{ name: "koishi-plugin-late-install", main: "lib/index.cjs" },
				{ "lib/index.cjs": "module.exports = 1" },
			);
			expect(resolvePlugin("late-install", dir)).toBe(
				join(pkgDir, "lib", "index.cjs"),
			);
		});
	});

	it("作用域包 + scope 目录预存在（生产 @koishijs 场景）同样兜底命中", async () => {
		await withDir(async (dir) => {
			// scope 目录预存在：scoped 候选的失败会缓存 scope 目录快照
			await fs.mkdir(join(dir, "node_modules", "@koishijs"), {
				recursive: true,
			});
			expect(() => resolvePlugin("scoped-late", dir)).toThrow();

			const pkgDir = await writePlugin(
				join(dir, "node_modules", "@koishijs", "plugin-scoped-late"),
				{ name: "@koishijs/plugin-scoped-late", main: "index.js" },
				{ "index.js": "module.exports = 1" },
			);
			expect(resolvePlugin("scoped-late", dir)).toBe(join(pkgDir, "index.js"));
		});
	});

	it("exports 条件表按 bun → require → node → default 序取主入口", async () => {
		await withDir(async (dir) => {
			await fs.mkdir(join(dir, "node_modules", "@koishijs"), {
				recursive: true,
			});
			expect(() => resolvePlugin("exp-demo", dir)).toThrow();

			const pkgDir = await writePlugin(
				join(dir, "node_modules", "@koishijs", "plugin-exp-demo"),
				{
					name: "@koishijs/plugin-exp-demo",
					exports: {
						".": {
							types: "./lib/index.d.ts",
							bun: "./lib/bun.mjs",
							require: "./lib/index.cjs",
							default: "./lib/index.cjs",
						},
					},
				},
				{
					"lib/bun.mjs": "export const x = 1",
					"lib/index.cjs": "module.exports = 1",
				},
			);
			// 与 Bun.resolveSync 未被污染时的选择一致：bun 条件优先
			expect(resolvePlugin("exp-demo", dir)).toBe(join(pkgDir, "lib/bun.mjs"));
		});
	});

	it("无 main 的包回落 index.js，再回落 module 字段", async () => {
		await withDir(async (dir) => {
			await fs.mkdir(join(dir, "node_modules"), { recursive: true });
			expect(() => resolvePlugin("nomain-demo", dir)).toThrow();

			const pkgDir = await writePlugin(
				join(dir, "node_modules", "koishi-plugin-nomain-demo"),
				{ name: "koishi-plugin-nomain-demo", module: "lib/esm.mjs" },
				{ "lib/esm.mjs": "export const x = 1" },
			);
			expect(resolvePlugin("nomain-demo", dir)).toBe(
				join(pkgDir, "lib/esm.mjs"),
			);
		});
	});

	it("包存在但入口不可识别 / 缺失时仍抛错", async () => {
		await withDir(async (dir) => {
			await fs.mkdir(join(dir, "node_modules"), { recursive: true });
			expect(() => resolvePlugin("broken-entry", dir)).toThrow();

			// 包落盘但 main 指向不存在的文件：近似 Node「包存在但入口
			// 坏」语义，报无法解析而非返回错误入口
			await writePlugin(
				join(dir, "node_modules", "koishi-plugin-broken-entry"),
				{ name: "koishi-plugin-broken-entry", main: "lib/missing.cjs" },
				{},
			);
			expect(() => resolvePlugin("broken-entry", dir)).toThrow(
				'cannot resolve plugin "broken-entry"',
			);
		});
	});
});
