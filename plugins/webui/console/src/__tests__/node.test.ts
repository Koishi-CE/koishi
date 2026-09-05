// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Entry } from "@koishi-ce/console";
import NodeConsole, {
	rewriteSharedImports,
} from "../node/index.ts";

describe("rewriteSharedImports", () => {
	test("压缩形态的静态导入被改写", () => {
		expect(
			rewriteSharedImports(
				'import{Fragment as e}from"vue";import{Schema as x}from"@koishi-ce/client";',
			),
		).toBe(
			'import{Fragment as e}from"../vue.js";import{Schema as x}from"../client.js";',
		);
	});

	test("带空格的静态导入被改写", () => {
		expect(
			rewriteSharedImports('import d from "vue-router";\n'),
		).toBe('import d from "../vue-router.js";\n');
	});

	test("无绑定名的副作用导入被改写（曾致 logger 插件整模块加载失败）", () => {
		expect(
			rewriteSharedImports('import"vue-router";var y=1;'),
		).toBe('import"../vue-router.js";var y=1;');
		expect(
			rewriteSharedImports(
				'import "vue-router";\nvar y=1;',
			),
		).toBe('import "../vue-router.js";\nvar y=1;');
	});

	test("再导出形态被改写", () => {
		expect(
			rewriteSharedImports(
				'export{useRouter}from"vue-router";',
			),
		).toBe('export{useRouter}from"../vue-router.js";');
		expect(rewriteSharedImports("export*from'vue';")).toBe(
			"export*from'../vue.js';",
		);
	});

	test("动态导入被改写", () => {
		expect(
			rewriteSharedImports('const m=import("vue");'),
		).toBe('const m=import("../vue.js");');
	});

	test("上游包名映射到同一份共享 client", () => {
		expect(
			rewriteSharedImports(
				'import{send}from"@koishijs/client";',
			),
		).toBe('import{send}from"../client.js";');
	});

	test("映射之外的说明符原样保留", () => {
		const source =
			'import{x}from"lodash";import"./chunk-abc123.js";import"./style.css";const s="import from \'vue\'";';
		expect(rewriteSharedImports(source)).toBe(source);
	});
});

/** resolveEntry 依赖实例的 config 与 getFiles，测试中以最小宿主对象模拟 */
interface FakeHost {
	config: { devMode: boolean; uiPath: string };
	getFiles(files: Entry.Files): string | string[];
}

const resolveEntry = (
	NodeConsole.prototype as unknown as {
		resolveEntry: (
			this: FakeHost,
			files: Entry.Files,
			key: string,
		) => string[];
	}
).resolveEntry;

const host = (devMode = false, uiPath = ""): FakeHost => ({
	config: { devMode, uiPath },
	getFiles: (files) =>
		typeof files === "string" || Array.isArray(files)
			? files
			: files.prod,
});

describe("resolveEntry", () => {
	const root = join(tmpdir(), "koishi-console-entry-test");

	test("产物目录含 style.css 时按约定名下发", () => {
		const dir = join(root, "a");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "style.css"), "");
		expect(
			resolveEntry.call(
				host(),
				{ dev: "", prod: dir },
				"key1",
			),
		).toEqual([
			"/@plugin-key1/index.js",
			"/@plugin-key1/style.css",
		]);
	});

	test("旧版插件包只有 index.css 时兜底下发（存量 1.0.0 包样式修复）", () => {
		const dir = join(root, "b");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "index.css"), "");
		expect(
			resolveEntry.call(
				host(),
				{ dev: "", prod: dir },
				"key2",
			),
		).toEqual([
			"/@plugin-key2/index.js",
			"/@plugin-key2/index.css",
		]);
	});

	test("两个样式并存时 style.css 优先", () => {
		const dir = join(root, "c");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "index.css"), "");
		writeFileSync(join(dir, "style.css"), "");
		expect(
			resolveEntry.call(
				host(),
				{ dev: "", prod: dir },
				"key3",
			),
		).toEqual([
			"/@plugin-key3/index.js",
			"/@plugin-key3/style.css",
		]);
	});

	test("无样式产物只下发入口脚本", () => {
		const dir = join(root, "d");
		mkdirSync(dir, { recursive: true });
		expect(
			resolveEntry.call(
				host(),
				{ dev: "", prod: dir },
				"key4",
			),
		).toEqual(["/@plugin-key4/index.js"]);
	});

	test("数组形态的具名文件直接映射 URL，不追加探测", () => {
		expect(
			resolveEntry.call(
				host(),
				["/pkg/dist/index.js", "/pkg/dist/a.css"],
				"k",
			),
		).toEqual(["/@plugin-k", "/@plugin-k"]);
	});

	test("devMode 走 /vite/@fs/ 前缀（目录形态同样追加入口名）", () => {
		const dir = join(root, "a"); // 复用含 style.css 的目录
		expect(
			resolveEntry.call(
				host(true),
				{ dev: "", prod: dir },
				"key5",
			),
		).toEqual([
			`/vite/@fs/${dir}/index.js`,
			`/vite/@fs/${dir}/style.css`,
		]);
	});

	test("清理临时目录", () => {
		rmSync(root, { recursive: true, force: true });
		expect(existsSync(root)).toBe(false);
	});
});
