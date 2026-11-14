// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

// CLI 旗标解析层：旗标在入口解析一次，之后以 Options 对象在步骤函数间传递。
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** 仓库根（tooling/release/core/ 的上三级）。 */
export const ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
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
	/** --commit：version 环消费 changeset 后提交版本变化（CI 拆分 job 用）。 */
	commit: boolean;
	/** --only：仅发布名单内的包（逗号分隔包名；补发 / 重发场景）。 */
	only: string[];
}

/** 解析旗标（strict 模式）；未知旗标 / --only 缺参或值以 -- 开头 → null。 */
export function parseOptions(
	args: readonly string[],
): Options | null {
	try {
		const { values } = parseArgs({
			args: [...args],
			options: {
				"dry-run": { type: "boolean" },
				push: { type: "boolean" },
				"allow-dirty": { type: "boolean" },
				"skip-build": { type: "boolean" },
				"skip-test": { type: "boolean" },
				commit: { type: "boolean" },
				only: { type: "string" },
			},
			strict: true,
		});
		return {
			dryRun: values["dry-run"] === true,
			push: values.push === true,
			allowDirty: values["allow-dirty"] === true,
			skipBuild: values["skip-build"] === true,
			skipTest: values["skip-test"] === true,
			commit: values.commit === true,
			only: (values.only ?? "")
				.split(",")
				.map((name) => name.trim())
				.filter((name) => name !== ""),
		};
	} catch {
		return null;
	}
}
