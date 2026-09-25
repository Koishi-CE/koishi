// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * `koishi-scripts version`：跨仓库 changeset version 编排器（发布链第一环）。
 *
 * 宿主工作区里每个 external/* 项目都是独立 git 仓库、各自的 Changesets
 * 独立运作（发版说明按仓库隔离）。本命令遍历全部项目，对 .changeset/ 里
 * 还有 pending 条目（*.md，README.md 除外）的项目在其目录内执行
 * `changeset version`（消费条目、升版本号、写 CHANGELOG），没有 pending
 * 条目的项目自动跳过——把 N 个仓库合成一条命令。
 *
 * changeset 二进制解析顺序：优先项目自身 node_modules/.bin（monorepo
 * 本地安装），回退宿主工作区根 node_modules/.bin（提升安装的单包插件）；
 * Windows 上 .cmd（npm/pnpm/yarn）与 .exe（Bun）两种 shim 形态均探测，
 * 项目本地整体优先于工作区根。任一项目失败 → 立即中断（版本号已变但
 * 发布链断掉时，重跑本命令幂等：已消费的条目不会二次消费）。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "../index.ts";
import { runCommand } from "./run.ts";

/** 列出 external/ 下含 package.json 的项目目录（按目录名排序，输出稳定）。 */
function listProjects(): string[] {
	const externalDir = join(cwd, "external");
	return readdirSync(externalDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(externalDir, entry.name))
		.filter((dir) => existsSync(join(dir, "package.json")))
		.sort();
}

/** 项目是否有 pending changeset（.changeset/*.md，README.md 除外）。 */
function hasPendingChangesets(projectDir: string): boolean {
	const changesetDir = join(projectDir, ".changeset");
	let entries: string[];
	try {
		entries = readdirSync(changesetDir);
	} catch {
		return false; // 无 .changeset 目录 → 该项目未接入或无条目
	}
	return entries.some(
		(name) =>
			name.toLowerCase() !== "readme.md" &&
			name.toLowerCase().endsWith(".md"),
	);
}

/**
 * 解析项目可用的 changeset 可执行文件路径（项目本地优先，回退工作区根）。
 *
 * Windows 下 bin shim 形态随安装器而异：npm/pnpm/yarn 生成 .cmd 批处理，
 * Bun 生成 .exe（bunx 垫片）——两级候选各自遍历全部扩展名，保证
 * Bun 工作区（无 .cmd）也能命中；两级候选均为 .cmd/.exe 皆缺时交 PATH 兜底。
 */
function resolveChangesetBin(projectDir: string): string {
	const isWin = process.platform === "win32";
	const exts = isWin ? [".cmd", ".exe"] : [""];
	const bases = [
		join(projectDir, "node_modules", ".bin"),
		join(cwd, "node_modules", ".bin"),
	];
	for (const base of bases) {
		for (const ext of exts) {
			const candidate = join(base, `changeset${ext}`);
			try {
				if (statSync(candidate).isFile()) {
					return candidate;
				}
			} catch {
				// 候选不存在，继续下一个
			}
		}
	}
	// 都没找到 → 交给 PATH 兜底（错误信息由 spawn 输出）
	return "changeset";
}

/** 主流程：遍历 → 有 pending 才执行 → 失败即中断。返回退出码。 */
export default function runVersion(): number {
	let projects: string[];
	try {
		projects = listProjects();
	} catch {
		console.log(
			"[version] 当前目录下无 external/，请在宿主工作区根执行",
		);
		return 1;
	}
	if (projects.length === 0) {
		console.log("[version] external/ 下未发现任何项目");
		return 0;
	}
	let consumed = 0;
	for (const projectDir of projects) {
		const projectName =
			projectDir.split(/[\\/]/).pop() ?? projectDir;
		if (!hasPendingChangesets(projectDir)) {
			console.log(
				`[version] ⏭  ${projectName}：无 pending changeset，跳过`,
			);
			continue;
		}
		console.log(
			`[version] 📦 ${projectName}：执行 changeset version ...`,
		);
		const bin = resolveChangesetBin(projectDir);
		const code = runCommand(projectDir, bin, ["version"]);
		if (code !== 0) {
			console.log(
				`[version] ❌ ${projectName} changeset version 失败（退出码 ${code}），已中断`,
			);
			return code;
		}
		consumed += 1;
	}
	console.log(
		`[version] 完成：${consumed}/${projects.length} 个项目消费了 changeset`,
	);
	return 0;
}
