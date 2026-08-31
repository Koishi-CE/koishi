/**
 * Bun require 的 ESM 入口分歧种子测试：postgres 形态包的依赖链修复、
 * 无分歧与未知形态包零副作用、peer 链间接消费方、ESM import 侧不受
 * 污染、幂等性，以及 nodeRequireEntry 的 exports 形态矩阵。
 */
import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Manifest, nodeRequireEntry, seedCjsInterop } from "../interop.ts";

/** 写入一个 fixture 包：清单 + 若干文件 */
async function writePkg(
	base: string,
	name: string,
	manifest: Record<string, unknown>,
	files: Record<string, string>,
) {
	const dir = join(base, "node_modules", name);
	await fs.mkdir(dir, { recursive: true });
	await Bun.write(join(dir, "package.json"), JSON.stringify(manifest));
	for (const [filename, content] of Object.entries(files)) {
		await Bun.write(join(dir, filename), content);
	}
}

/**
 * 建立临时 fixture 项目：koishi-plugin-fixture 为被加载的插件（CJS），
 * pg-like 建模 postgres（bun/import→ESM、default→CJS），normal-pkg 无
 * 分歧，broken-pkg 的 exports 为数组（形态未知），chain-pkg 经
 * peerDependencies 进入依赖树且自身消费 pg-like，absent-pkg 声明未装。
 */
async function withFixtures(fn: (dir: string) => Promise<void> | void) {
	const dir = await fs.mkdtemp(join(tmpdir(), "koishi-loader-interop-"));
	try {
		await writePkg(
			dir,
			"koishi-plugin-fixture",
			{
				name: "koishi-plugin-fixture",
				main: "index.js",
				dependencies: {
					"pg-like": "*",
					"normal-pkg": "*",
					"broken-pkg": "*",
					"absent-pkg": "*",
				},
				peerDependencies: { "chain-pkg": "*" },
			},
			{
				"index.js":
					"module.exports = { pg: require('pg-like'), normal: require('normal-pkg'), broken: require('broken-pkg') }",
			},
		);
		await writePkg(
			dir,
			"pg-like",
			{
				name: "pg-like",
				type: "module",
				main: "cjs/index.js",
				exports: {
					types: "./types/index.d.ts",
					bun: "./esm/index.js",
					workerd: "./cf/index.js",
					import: "./esm/index.js",
					default: "./cjs/index.js",
				},
			},
			{
				"esm/index.js": "export default function pgEsm() { return 'esm' }",
				"cjs/index.js": "module.exports = function pgCjs() { return 'cjs' }",
			},
		);
		await writePkg(
			dir,
			"normal-pkg",
			{ name: "normal-pkg", main: "index.js" },
			{ "index.js": "module.exports = { tag: 'normal' }" },
		);
		await writePkg(
			dir,
			"chain-pkg",
			{
				name: "chain-pkg",
				main: "index.js",
				dependencies: { "pg-like": "*" },
			},
			{ "index.js": "module.exports = { pg: require('pg-like') }" },
		);
		await writePkg(
			dir,
			"broken-pkg",
			{ name: "broken-pkg", main: "cjs/index.js", exports: ["./cjs/index.js"] },
			{ "cjs/index.js": "module.exports = { tag: 'broken' }" },
		);
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("seedCjsInterop", () => {
	it("postgres 形态包：CJS 消费方拿到 Node 语义入口的导出", async () => {
		await withFixtures(async (dir) => {
			const entry = join(
				dir,
				"node_modules",
				"koishi-plugin-fixture",
				"index.js",
			);
			seedCjsInterop(entry);
			const plugin = require(entry) as {
				pg: () => string;
				normal: unknown;
				broken: unknown;
			};
			// require 命中种子：拿到 CJS 产物（函数）而非 ESM namespace
			expect(typeof plugin.pg).toBe("function");
			expect(plugin.pg()).toBe("cjs");
			// 无分歧包与未知形态包维持 Bun 原生行为
			expect(plugin.normal).toEqual({ tag: "normal" });
			expect(plugin.broken).toEqual({ tag: "broken" });
			// peer 链上的间接消费方（未被插件直接 require）同样命中种子
			const chain = require(
				join(dir, "node_modules", "chain-pkg", "index.js"),
			) as { pg: () => string };
			expect(typeof chain.pg).toBe("function");
			expect(chain.pg()).toBe("cjs");
		});
	});

	it("ESM import 侧不受种子影响", async () => {
		await withFixtures(async (dir) => {
			const entry = join(
				dir,
				"node_modules",
				"koishi-plugin-fixture",
				"index.js",
			);
			seedCjsInterop(entry);
			// 以 ESM import 加载被 seed 的入口文件：仍按 ESM 求值
			const esm = (await import(
				pathToFileURL(join(dir, "node_modules", "pg-like", "esm", "index.js"))
					.href
			)) as { default: () => string };
			expect(esm.default()).toBe("esm");
		});
	});

	it("幂等：重复预置不重复加载、导出保持同一引用", async () => {
		await withFixtures(async (dir) => {
			const entry = join(
				dir,
				"node_modules",
				"koishi-plugin-fixture",
				"index.js",
			);
			const consumerDir = join(dir, "node_modules", "koishi-plugin-fixture");
			const key = require.resolve("pg-like", { paths: [consumerDir] });
			seedCjsInterop(entry);
			const first = require.cache[key]?.exports;
			expect(typeof first).toBe("function");
			seedCjsInterop(entry);
			expect(require.cache[key]?.exports).toBe(first);
		});
	});

	it("入口无 package.json（脚本插件）时安全跳过", () => {
		expect(() =>
			seedCjsInterop(join(tmpdir(), "definitely-lonely-xyz.js")),
		).not.toThrow();
	});
});

describe("nodeRequireEntry", () => {
	const base = "P:\\pkg";

	it("扁平条件表按键序取 Node require 首个命中（postgres 形态取 default）", () => {
		const manifest: Manifest = {
			exports: {
				types: "./types/index.d.ts",
				bun: "./esm/index.js",
				workerd: "./cf/index.js",
				import: "./esm/index.js",
				default: "./cjs/index.js",
			},
		};
		expect(nodeRequireEntry(manifest, base)).toBe(join(base, "cjs/index.js"));
	});

	it("键序优先：default 在前则 default 生效（与 Node 一致）", () => {
		const manifest: Manifest = {
			exports: { default: "./d.js", require: "./c.cjs" },
		};
		expect(nodeRequireEntry(manifest, base)).toBe(join(base, "d.js"));
	});

	it('嵌套 "." 形态命中 require 条件', () => {
		const manifest: Manifest = {
			exports: {
				".": { import: "./m.mjs", require: "./c.cjs", default: "./d.js" },
			},
		};
		expect(nodeRequireEntry(manifest, base)).toBe(join(base, "c.cjs"));
	});

	it("无 exports 时回落 main", () => {
		expect(nodeRequireEntry({ main: "./lib.js" }, base)).toBe(
			join(base, "lib.js"),
		);
	});

	it("子路径表 / 数组 / 深层嵌套 / 非 main 字符串均为未知", () => {
		expect(
			nodeRequireEntry({ exports: { "./sub": "./s.js" } }, base),
		).toBeUndefined();
		expect(nodeRequireEntry({ exports: ["./a.js"] }, base)).toBeUndefined();
		expect(
			nodeRequireEntry(
				{ exports: { ".": { require: { node: "./n.js" } } } },
				base,
			),
		).toBeUndefined();
		expect(nodeRequireEntry({ main: 42 }, base)).toBeUndefined();
		expect(nodeRequireEntry({}, base)).toBeUndefined();
	});
});
