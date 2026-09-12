// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT } from "./config.ts";

/** 枚举出的一个 workspace 包（目录 + 包名）。 */
export interface WorkspacePackage {
	/** 包名（如 @koishi-ce/core）。 */
	name: string;
	/** 包目录绝对路径。 */
	dir: string;
}

/**
 * 按根 package.json 的 workspaces 声明枚举全部包：glob 扫出目录，取其中
 * 含 package.json 且带 name 的子目录。不检查作用域（由调用方按需过滤）。
 */
export function resolveWorkspacePackages(
	root: string,
): WorkspacePackage[] {
	const manifest = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	) as { workspaces?: string[] };
	const workspaces = manifest.workspaces ?? [];
	const packages: WorkspacePackage[] = [];
	const seen = new Set<string>();
	for (const pattern of workspaces) {
		// Bun 1.4.2 win32 下 scanSync 的位置参数形态恒返回空，须用对象形态传 cwd
		for (const entry of new Bun.Glob(pattern).scanSync({
			cwd: root,
			onlyFiles: false,
		})) {
			const dir = resolve(root, entry);
			if (seen.has(dir)) continue;
			seen.add(dir);
			const file = join(dir, "package.json");
			if (!existsSync(file)) continue;
			const name = (
				JSON.parse(readFileSync(file, "utf8")) as {
					name?: string;
				}
			).name;
			if (!name) continue;
			packages.push({ name, dir });
		}
	}
	return packages;
}

/** 链接模式的运行前提抽查：宿主入口与前端宿主产物缺失时给出明确指引。 */
export function checkBuildArtifacts(
	packages: WorkspacePackage[],
): string[] {
	const missing: string[] = [];
	const byName = new Map(
		packages.map((pkg) => [pkg.name, pkg.dir]),
	);
	const cli = byName.get("@koishi-ce/koishi");
	if (!cli || !existsSync(join(cli, "lib/cli/index.mjs"))) {
		missing.push("packages/node/cli/lib/cli/index.mjs");
	}
	const core = byName.get("@koishi-ce/core");
	if (!core || !existsSync(join(core, "lib/index.mjs"))) {
		missing.push("packages/node/core/lib/index.mjs");
	}
	if (
		!existsSync(
			join(ROOT, "plugins/webui/console/dist/index.html"),
		)
	) {
		missing.push("plugins/webui/console/dist/index.html");
	}
	return missing;
}
