// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	discoverWorkspaceDirs,
	ROOT,
	readJsonFile,
} from "../shared/workspace.ts";

/** 枚举出的一个 workspace 包（目录 + 包名 + 版本）。 */
export interface WorkspacePackage {
	/** 包名（如 @koishi-ce/core）。 */
	name: string;
	/** 包目录绝对路径。 */
	dir: string;
	/** package.json 的 version（缺失为 undefined）。 */
	version: string | undefined;
}

/**
 * 按根 package.json 的 workspaces 声明枚举全部包（目录枚举策略见
 * shared/workspace.ts）。不检查作用域（由调用方按需过滤）。
 */
export function resolveWorkspacePackages(
	root: string,
): WorkspacePackage[] {
	const packages: WorkspacePackage[] = [];
	for (const dir of discoverWorkspaceDirs(root)) {
		const manifest = readJsonFile(
			join(dir, "package.json"),
		);
		const name = manifest?.["name"];
		if (typeof name !== "string" || name === "") {
			continue;
		}
		const version = manifest?.["version"];
		packages.push({
			name,
			dir,
			version:
				typeof version === "string" ? version : undefined,
		});
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
