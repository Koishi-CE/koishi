// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * `koishi-scripts build`：全工作区构建编排器（发布链第二环）。
 *
 * external/ 下的子项目各自携带 node_modules（单包插件或 pnpm monorepo），
 * build 脚本均为纯净执行器（tsdown / node scripts/…），只需一个 script
 * 执行器，不需要包管理器的安装能力——统一用 `bun run`。不可借道 yarn
 * 或 corepack pnpm：宿主工作区根 packageManager 钉 `bun@x`（下游模板
 * 策略），corepack shim 读到该字段即拒绝执行（Unsupported package
 * manager specification）；bun 是宿主唯一保证在场的工具链。
 * 串行构建、失败即中断（发布链不允许多项目半成品）。
 */
import {
	existsSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import { cwd } from "../index.ts";
import { runCommand } from "./run.ts";

interface Project {
	/** 项目目录绝对路径。 */
	dir: string;
	/** 目录名（展示用）。 */
	name: string;
}

/** 列出 external/ 下有 build 脚本的项目。 */
function listProjects(): Project[] {
	const externalDir = join(cwd, "external");
	const dirs = readdirSync(externalDir, {
		withFileTypes: true,
	})
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(externalDir, entry.name))
		.sort();
	const projects: Project[] = [];
	for (const dir of dirs) {
		const manifestPath = join(dir, "package.json");
		if (!existsSync(manifestPath)) {
			continue;
		}
		const pkg = JSON.parse(
			readFileSync(manifestPath, "utf8"),
		) as {
			scripts?: Record<string, unknown>;
		};
		if (pkg.scripts?.["build"] === undefined) {
			console.log(
				`[build] ⏭  ${dir.split(/[\\/]/).pop()}：无 build 脚本，跳过`,
			);
			continue;
		}
		projects.push({
			dir,
			name: dir.split(/[\\/]/).pop() ?? dir,
		});
	}
	return projects;
}

/** 主流程：串行构建，失败即中断。返回退出码。 */
export default function runBuild(): number {
	let projects: Project[];
	try {
		projects = listProjects();
	} catch {
		console.log(
			"[build] 当前目录下无 external/，请在宿主工作区根执行",
		);
		return 1;
	}
	if (projects.length === 0) {
		console.log("[build] external/ 下未发现任何可构建项目");
		return 0;
	}
	console.log(
		`[build] 共 ${projects.length} 个项目，开始串行构建\n`,
	);
	const startedAt = Date.now();
	for (const project of projects) {
		console.log(`[build] 🔨 ${project.name}`);
		const code = runCommand(project.dir, "bun", [
			"run",
			"build",
		]);
		if (code !== 0) {
			console.log(
				`[build] ❌ ${project.name} 构建失败（退出码 ${code}），已中断`,
			);
			return code;
		}
		console.log(`[build] ✅ ${project.name} 构建完成\n`);
	}
	const seconds = ((Date.now() - startedAt) / 1000).toFixed(
		1,
	);
	console.log(
		`[build] 全部完成：${projects.length} 个项目，耗时 ${seconds}s`,
	);
	return 0;
}
