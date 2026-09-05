// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { expect, test } from "bun:test";
import { renderManifest } from "../index.ts";
import {
	baseManifest,
	templateFiles,
} from "../template.ts";

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
		expect(
			guarded.has(key) || key.startsWith("@koishi-ce/"),
		).toBe(true);
	}
	for (const key of Object.keys(devDependencies ?? {})) {
		expect(
			key === "bun-types" || key.startsWith("@koishi-ce/"),
		).toBe(true);
	}
});

test("内置模板 packageManager 钉 Bun，脚本用 Bun Shell 环境变量前缀", () => {
	const manifest = baseManifest();
	const { scripts } = manifest as unknown as {
		scripts: Record<string, string>;
	};
	// 本项目只支持 Bun 运行时：packageManager 形如 bun@1.x.y
	expect(manifest["packageManager"] ?? "").toMatch(
		/^bun@\d+\.\d+\.\d+/,
	);
	// cross-env 已移除：bun run 走 Bun Shell，环境变量前缀天然跨平台
	expect(scripts["dev"]).toBe(
		"NODE_ENV=development koishi start",
	);
	expect(JSON.stringify(manifest)).not.toContain(
		"cross-env",
	);
});

test("内置模板提供插件开发全链脚本入口（koishi-scripts 子命令形态）", () => {
	const { scripts } = baseManifest() as unknown as {
		scripts: Record<string, string>;
	};
	// 插件开发链 = devDep @koishi-ce/scripts 的 koishi-scripts CLI 子命令；
	// new 用主命令名 setup（new/create/init 是 koishi-scripts 的别名）
	expect(scripts["new"]).toBe("koishi-scripts setup");
	expect(scripts["clone"]).toBe("koishi-scripts clone");
	expect(scripts["build"]).toBe("koishi-scripts build");
	expect(scripts["release:version"]).toBe(
		"koishi-scripts version",
	);
	// release 链 = version → build → publish 三环串联（前环自引用脚本）
	expect(scripts["release"]).toBe(
		"bun run release:version && bun run build && koishi-scripts publish",
	);
	expect(scripts["release:dryrun"]).toBe(
		"bun run release:version && bun run build && koishi-scripts publish --dry-run",
	);
});

test("内置模板以 npm alias 钉住 koishi 裸名，版本保持 4.18.x 冻结线", () => {
	const request = baseManifest().dependencies?.["koishi"];
	expect(typeof request).toBe("string");
	// alias 形态 npm:@koishi-ce/koishi-shim@^4.18.x——版本若漂出 ^4 区间，
	// 上游插件的 peer `koishi ^4` 判定为不满足，market UI 会试图改写它
	expect(request ?? "").toMatch(
		/^npm:@koishi-ce\/koishi-shim@\^4\./,
	);
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
		expect(
			templateFiles[file]?.length ?? 0,
		).toBeGreaterThan(0);
	}
	expect(templateFiles["koishi.yml"]).toContain(
		"endpoint: https://registry.koishi.chat/index.json",
	);
});

test("koishi.yml 预写策略：sqlite 默认启用开箱数据库，非必需件与官方 adapter 保持 ~ 禁用", () => {
	const yml = templateFiles["koishi.yml"] ?? "";
	// 配置页导出形态：插件键带 uid 实例后缀，分组带 $collapsed / $label 元数据
	expect(yml).toMatch(/database-sqlite:[a-z0-9]{6}:/);
	expect(yml).toContain("$collapsed: true");
	expect(yml).toContain("$label: ");
	// 依赖数据库但非必需 / 暂无需启用的 CE 插件：预装但 ~ 禁用
	for (const name of [
		"~admin",
		"~bind",
		"~broadcast",
		"~callme",
		"~auth",
		"~inspect",
		"~server-temp",
		"~mock",
	]) {
		expect(yml).toContain(name);
	}
	// 随模板默认启用的 CE 插件（含 sqlite 数据库）：条目存在且无 ~ 前缀
	for (const name of [
		"database-sqlite",
		"dataview",
		"analytics",
		"rate-limit",
		"echo",
		"assets-local",
		"status",
		"sandbox",
		"theme-vanilla",
	]) {
		expect(yml).toContain(name);
		expect(yml).not.toContain(`~${name}`);
	}
	// database-sqlite 依赖在册（随模板预装，启用即得数据库）
	expect(
		baseManifest().dependencies?.[
			"@koishi-ce/plugin-database-sqlite"
		],
	).toBe("^1.0.0");
	// 官方 adapter 只以 ~ 禁用条目预写（未预装，市场装后启用）；
	// 未再分发的 database（mongo / mysql / postgres）不再预写占位条目
	for (const name of [
		"~adapter-discord",
		"~adapter-telegram",
		"~adapter-qq",
	]) {
		expect(yml).toContain(name);
	}
	expect(yml).not.toContain("database-mongo");
	// 模板依赖里不得出现官方 adapter / database 包名（只预写不预装）
	expect(JSON.stringify(baseManifest())).not.toContain(
		"adapter-",
	);
	expect(JSON.stringify(baseManifest())).not.toContain(
		"@koishijs/plugin-database-",
	);
});

test("renderManifest 渲染内置模板：常规改写生效，prod 模式保留 koishi alias", () => {
	const output = JSON.parse(
		renderManifest(baseManifest(), "my-app", false),
	);
	expect(output.name).toBe("my-app");
	expect(output.private).toBe(true);
	expect(output.version).toBe("0.0.0");
	expect(output.scripts.start).toBe("koishi start");
	expect(output.packageManager).toMatch(/^bun@/);
	expect(output.dependencies.koishi).toBe(
		"npm:@koishi-ce/koishi-shim@^4.18.11",
	);

	const prod = JSON.parse(
		renderManifest(baseManifest(), "my-app", true),
	);
	expect("workspaces" in prod).toBe(false);
	expect("devDependencies" in prod).toBe(false);
	// 四个上游名 alias 是运行时依赖，prod 模式下必须原样保留
	expect(prod.dependencies.koishi).toBe(
		"npm:@koishi-ce/koishi-shim@^4.18.11",
	);
	expect(
		prod.dependencies["@koishijs/plugin-console"],
	).toBe("npm:@koishi-ce/console-shim@^5.30.11");
	expect(prod.dependencies["@koishijs/core"]).toBe(
		"npm:@koishi-ce/koishi-shim@4.18.11",
	);
	expect(prod.dependencies["@koishijs/loader"]).toBe(
		"npm:@koishi-ce/koishi-shim@^4.18.11",
	);
});
