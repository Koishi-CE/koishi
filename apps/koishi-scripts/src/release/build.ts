// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * `koishi-scripts build`：全工作区构建编排器（发布链第二环）。
 *
 * 宿主工作区是混合形态：单包插件是 yarn workspace 成员（依赖从根提升，
 * yarn build 即可）；pnpm monorepo（有 pnpm-lock.yaml 与 packageManager
 * 字段）构建走 corepack pnpm。本命令按各项目实际情况选择包管理器执行其
 * build 脚本，串行构建、失败即中断（发布链不允许多项目半成品）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "../index.ts";
import { runCommand } from "./run.ts";

interface Project {
	/** 项目目录绝对路径。 */
	dir: string;
	/** 目录名（展示用）。 */
	name: string;
	/** 使用的包管理器：pnpm monorepo 或 yarn workspace 成员。 */
	pm: "pnpm" | "yarn";
}

/** 列出 external/ 下有 build 脚本的项目，并探测其包管理器。 */
function listProjects(): Project[] {
	const externalDir = join(cwd, "external");
	const dirs = readdirSync(externalDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(externalDir, entry.name))
		.sort();
	const projects: Project[] = [];
	for (const dir of dirs) {
		const manifestPath = join(dir, "package.json");
		if (!existsSync(manifestPath)) {
			continue;
		}
		const pkg = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			scripts?: Record<string, unknown>;
		};
		if (pkg.scripts?.["build"] === undefined) {
			console.log(
				`[build] ⏭  ${dir.split(/[\\/]/).pop()}：无 build 脚本，跳过`,
			);
			continue;
		}
		const pm: Project["pm"] = existsSync(join(dir, "pnpm-lock.yaml"))
			? "pnpm"
			: "yarn";
		projects.push({ dir, name: dir.split(/[\\/]/).pop() ?? dir, pm });
	}
	return projects;
}

/** 主流程：串行构建，失败即中断。返回退出码。 */
export default function runBuild(): number {
	let projects: Project[];
	try {
		projects = listProjects();
	} catch {
		console.log("[build] 当前目录下无 external/，请在宿主工作区根执行");
		return 1;
	}
	if (projects.length === 0) {
		console.log("[build] external/ 下未发现任何可构建项目");
		return 0;
	}
	console.log(`[build] 共 ${projects.length} 个项目，开始串行构建\n`);
	const startedAt = Date.now();
	for (const project of projects) {
		const label = `${project.name}（${project.pm}）`;
		console.log(`[build] 🔨 ${label}`);
		const code =
			project.pm === "pnpm"
				? runCommand(project.dir, "corepack", ["pnpm", "run", "build"])
				: runCommand(project.dir, "yarn", ["run", "build"]);
		if (code !== 0) {
			console.log(`[build] ❌ ${label} 构建失败（退出码 ${code}），已中断`);
			return code;
		}
		console.log(`[build] ✅ ${label} 构建完成\n`);
	}
	const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
	console.log(`[build] 全部完成：${projects.length} 个项目，耗时 ${seconds}s`);
	return 0;
}
