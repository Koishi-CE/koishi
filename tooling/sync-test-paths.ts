// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 把 tsconfig.base.json 的 paths 同步注入各 workspace 包的 tsconfig.json。
 *
 * 为什么需要这一步：Bun 测试运行时按「离文件最近的 tsconfig.json」读取 paths，
 * 既不跟随 extends 也无全局配置——不注入的话，测试里的 `@koishi-ce/*` 导入会
 * 解析到 lib 产物（被覆盖率忽略），src 源码永远进不了 `bun test --coverage` 报告。
 *
 * 对 tsc 无语义影响：注入的 paths 与从 base 继承的指向完全相同（仅按包目录
 * 重写了相对前缀），统一类型检查走根 tsconfig.json / tsconfig.web.json，不读包级配置。
 *
 * 用法：bun tooling/sync-test-paths.ts
 * 修改 tsconfig.base.json 的 paths 后重跑一次即可，脚本幂等（按标记块整体替换）。
 */
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

/** 纯前端工程不注入：其包级 tsconfig 服务于 client 侧类型视图（指向 lib d.ts 等），不能被 node 侧 src 映射覆盖 */
const EXCLUDED = new Set(["packages/web/client", "apps/online"]);

/** 解析 JSONC（容忍 // 行注释） */
function readJsonc(path: string): Record<string, unknown> {
	const text = readFileSync(path, "utf8");
	return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}

const base = readJsonc(join(repoRoot, "tsconfig.base.json")) as {
	compilerOptions: { paths: Record<string, string[]> };
};
const basePaths = base.compilerOptions.paths;

/** 收集 workspace 包根目录（对应根 package.json 的 workspaces 通配） */
function collectPackageDirs(): string[] {
	const dirs: string[] = [];
	for (const group of [
		"packages/node/*",
		"packages/web/*",
		"plugins/common/*",
		"plugins/infra/*",
		"plugins/webui/*",
		"apps/*",
	]) {
		const parent = dirname(group);
		for (const name of readdirSync(join(repoRoot, parent))) {
			const dir = join(parent, name);
			if (!statSync(join(repoRoot, dir)).isDirectory()) continue;
			if (EXCLUDED.has(dir.replace(/\\/g, "/"))) continue;
			if (!existsSync(join(repoRoot, dir, "tsconfig.json"))) continue;
			dirs.push(dir);
		}
	}
	return dirs;
}

const HEAD =
	"// 由 tooling/sync-test-paths.ts 生成，勿手工编辑（源：tsconfig.base.json paths；Bun 测试运行时只认本文件直接声明的 paths）";
let updated = 0;
const written: { path: string; original: string }[] = [];
let skipped = 0;

for (const dir of collectPackageDirs()) {
	const cfgPath = join(repoRoot, dir, "tsconfig.json");
	const original = readFileSync(cfgPath, "utf8");
	const cfg = readJsonc(cfgPath) as Record<
		string,
		{ paths?: Record<string, string[]> } & Record<string, unknown>
	>;
	cfg.compilerOptions ??= {};

	// 已有手工 paths 且无同步标记（HEAD 注释） → 拒绝覆盖，交由人工处理
	if (cfg.compilerOptions.paths && !original.includes(HEAD)) {
		console.warn(`[跳过] ${dir}/tsconfig.json 已有手工 paths，请人工合并`);
		skipped++;
		continue;
	}

	// 目标从「相对仓库根」改写为「相对本包目录」，统一正斜杠并带 ./ 前缀
	const from = dirname(cfgPath);
	const paths: Record<string, string[]> = {};
	for (const [name, targets] of Object.entries(basePaths)) {
		paths[name] = targets.map((target) => {
			const rel = relative(from, resolve(repoRoot, target)).replace(/\\/g, "/");
			return rel.startsWith(".") ? rel : `./${rel}`;
		});
	}
	cfg.compilerOptions.paths = paths;

	// 序列化后把标记注释插到 "paths" 行上方（作为下次同步的识别依据），先落盘 raw 形态
	const text = `${JSON.stringify(cfg, null, "\t")}\n`;
	const patched = text.replace(/\t"paths": \{/, `\t${HEAD}\n\t\t"paths": {`);
	if (patched === text) {
		console.warn(`[异常] ${dir}/tsconfig.json 未能插入标记，请检查`);
		continue;
	}
	writeFileSync(cfgPath, patched);
	written.push({ path: cfgPath, original });
}

// 收尾交给 biome 统一格式（单元素数组内联等行宽规则由 biome 裁决，脚本不复刻）
if (written.length > 0) {
	const fmt = Bun.spawnSync({
		cmd: [
			"bun",
			"x",
			"biome",
			"check",
			"--write",
			...written.map((x) => x.path),
		],
		cwd: repoRoot,
		stdout: "inherit",
		stderr: "inherit",
	});
	if (fmt.exitCode !== 0) {
		console.warn("[提示] biome 格式化未成功，请手动执行 bun run format");
	}
}

// 以「biome 格式化后的最终内容」与原内容比对，只有真正变化才计入更新（保证幂等安静）
for (const { path, original } of written) {
	if (readFileSync(path, "utf8") !== original) {
		updated++;
		console.log(`[同步] ${path}`);
	}
}

console.log(`完成：更新 ${updated} 个，跳过 ${skipped} 个`);
