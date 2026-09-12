// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * CLI 旗标解析层：仓库根常量、Options 契约与旗标解析。
 *
 * 各子命令模块共享的输入面——旗标集在入口解析一次，之后以
 * Options 对象在步骤函数间传递（不再回头读 process.argv）。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根（tooling/release/ 的上两级）。 */
export const ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);

/** CLI 旗标集。 */
export interface Options {
	dryRun: boolean;
	push: boolean;
	allowDirty: boolean;
	skipBuild: boolean;
	skipTest: boolean;
	/** --only：仅发布名单内的包（逗号分隔包名；补发 / 重发场景）。 */
	only: string[];
}

/** 解析旗标；遇到未知旗标 / --only 缺参返回 null。 */
export function parseOptions(
	args: readonly string[],
): Options | null {
	const options: Options = {
		dryRun: false,
		push: false,
		allowDirty: false,
		skipBuild: false,
		skipTest: false,
		only: [],
	};
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		switch (arg) {
			case "--dry-run": {
				options.dryRun = true;
				break;
			}
			case "--only": {
				const value = args[i + 1];
				if (value === undefined || value.startsWith("--")) {
					return null;
				}
				options.only = value
					.split(",")
					.map((name) => name.trim())
					.filter((name) => name !== "");
				i += 1;
				break;
			}
			case "--push": {
				options.push = true;
				break;
			}
			case "--allow-dirty": {
				options.allowDirty = true;
				break;
			}
			case "--skip-build": {
				options.skipBuild = true;
				break;
			}
			case "--skip-test": {
				options.skipTest = true;
				break;
			}
			default: {
				return null;
			}
		}
	}
	return options;
}
