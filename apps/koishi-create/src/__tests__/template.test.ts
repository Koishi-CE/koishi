// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { expect, test } from "bun:test";
import { renderManifest } from "../index.ts";
import { baseManifest, templateFiles } from "../template.ts";

test("内置模板依赖纯度：不含任何 @koishijs / koishi-plugin 官方生态包", () => {
	const { dependencies, devDependencies } = baseManifest();
	// 四个上游名是刻意的 npm alias 占位（koishi 裸名 / @koishijs/plugin-console /
	// @koishijs/core / @koishijs/loader），其余必须是 @koishi-ce 作用域
	const guarded = new Set([
		"koishi",
		"@koishijs/plugin-console",
		"@koishijs/core",
		"@koishijs/loader",
	]);
	for (const key of Object.keys(dependencies ?? {})) {
		expect(guarded.has(key) || key.startsWith("@koishi-ce/")).toBe(true);
	}
	for (const key of Object.keys(devDependencies ?? {})) {
		expect(key === "bun-types" || key.startsWith("@koishi-ce/")).toBe(true);
	}
});

test("内置模板 packageManager 钉 Bun，脚本用 Bun Shell 环境变量前缀", () => {
	const manifest = baseManifest();
	const { scripts } = manifest as unknown as {
		scripts: Record<string, string>;
	};
	// 本项目只支持 Bun 运行时：packageManager 形如 bun@1.x.y
	expect(manifest["packageManager"] ?? "").toMatch(/^bun@\d+\.\d+\.\d+/);
	// cross-env 已移除：bun run 走 Bun Shell，环境变量前缀天然跨平台
	expect(scripts["dev"]).toBe("NODE_ENV=development koishi start");
	expect(JSON.stringify(manifest)).not.toContain("cross-env");
});

test("内置模板以 npm alias 钉住 koishi 裸名，版本保持 4.18.x 冻结线", () => {
	const request = baseManifest().dependencies?.["koishi"];
	expect(typeof request).toBe("string");
	// alias 形态 npm:@koishi-ce/koishi-shim@^4.18.x——版本若漂出 ^4 区间，
	// 上游插件的 peer `koishi ^4` 判定为不满足，market UI 会试图改写它
	expect(request ?? "").toMatch(/^npm:@koishi-ce\/koishi-shim@\^4\./);
});

test("内置模板钉住 console / core / loader 上游 peer 名，防 Bun 自动装官方全家桶", () => {
	const { dependencies } = baseManifest();
	// CE webui 插件 peer ^5.30.11：alias 版本冻结 5.30.x 线
	expect(dependencies?.["@koishijs/plugin-console"]).toBe(
		"npm:@koishi-ce/console-shim@^5.30.11",
	);
	// @koishi-ce/loader 的 peer 精确锁 4.18.11：alias 必须逐字相等（不带 ^）
	expect(dependencies?.["@koishijs/core"]).toBe(
		"npm:@koishi-ce/koishi-shim@4.18.11",
	);
	// config / hmr 插件的 loader peer：koishi-shim 是 core + loader 的合并
	// 再导出（与上游 koishi 主包同构），4.18.11 满足 ^4.6.11
	expect(dependencies?.["@koishijs/loader"]).toBe(
		"npm:@koishi-ce/koishi-shim@^4.18.11",
	);
});

test("内置模板静态文件齐备，koishi.yml 预配 market 镜像源", () => {
	for (const file of [
		".env",
		".gitignore",
		"koishi.yml",
		"tsconfig.json",
		"README.md",
	]) {
		expect(templateFiles[file]?.length ?? 0).toBeGreaterThan(0);
	}
	expect(templateFiles["koishi.yml"]).toContain(
		"endpoint: https://registry.koishi.chat/index.json",
	);
});

test("koishi.yml 预写策略对齐官方实例：CE 插件装而禁用，官方 adapter/database 只写不装", () => {
	const yml = templateFiles["koishi.yml"] ?? "";
	// 依赖数据库 / 暂无需启用的 CE 插件：预装但 ~ 禁用
	for (const name of [
		"~admin",
		"~bind",
		"~analytics",
		"~auth",
		"~dataview",
		"~rate-limit",
		"~inspect",
		"~server-temp",
	]) {
		expect(yml).toContain(name);
	}
	// 无需数据库即可工作的 CE 插件：直接启用
	for (const name of ["assets-local", "theme-vanilla", "status", "sandbox"]) {
		expect(yml).toContain(name);
	}
	// 官方 adapter / database 只以 ~ 禁用条目预写（未预装，市场装后启用）
	for (const name of [
		"~adapter-discord",
		"~adapter-telegram",
		"~adapter-qq",
		"~database-sqlite",
		"~database-postgres",
	]) {
		expect(yml).toContain(name);
	}
	// 模板依赖里不得出现官方 adapter / database 包名（只预写不预装）
	expect(JSON.stringify(baseManifest())).not.toContain("adapter-");
	expect(JSON.stringify(baseManifest())).not.toContain("database-");
});

test("renderManifest 渲染内置模板：常规改写生效，prod 模式保留 koishi alias", () => {
	const output = JSON.parse(renderManifest(baseManifest(), "my-app", false));
	expect(output.name).toBe("my-app");
	expect(output.private).toBe(true);
	expect(output.version).toBe("0.0.0");
	expect(output.scripts.start).toBe("koishi start");
	expect(output.packageManager).toMatch(/^bun@/);
	expect(output.dependencies.koishi).toBe(
		"npm:@koishi-ce/koishi-shim@^4.18.11",
	);

	const prod = JSON.parse(renderManifest(baseManifest(), "my-app", true));
	expect("workspaces" in prod).toBe(false);
	expect("devDependencies" in prod).toBe(false);
	// 四个上游名 alias 是运行时依赖，prod 模式下必须原样保留
	expect(prod.dependencies.koishi).toBe("npm:@koishi-ce/koishi-shim@^4.18.11");
	expect(prod.dependencies["@koishijs/plugin-console"]).toBe(
		"npm:@koishi-ce/console-shim@^5.30.11",
	);
	expect(prod.dependencies["@koishijs/core"]).toBe(
		"npm:@koishi-ce/koishi-shim@4.18.11",
	);
	expect(prod.dependencies["@koishijs/loader"]).toBe(
		"npm:@koishi-ce/koishi-shim@^4.18.11",
	);
});
