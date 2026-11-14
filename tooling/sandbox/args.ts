// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { parseArgs } from "node:util";

/** 命令行参数的解析结果。 */
export interface SandboxOptions {
	/** 沙盒落点（缺省用工作区同级 Debug/koishi-ce-sandbox）。 */
	target?: string;
	/** 打包模式（bun pm pack + 真实 install）。 */
	pack: boolean;
	/** 清空重建已存在的沙盒。 */
	force: boolean;
	/** 生成完成后立即在前台启动沙盒实例。 */
	start: boolean;
}

/**
 * 解析命令行参数：首个非旗标位置参数为落点目录；`--pack` / `--force` /
 * `--start` 为旗标；其余旗标不识别，报错退出。`--`（bun run 透传分隔符，
 * 如 `bun run sandbox -- --pack`）在解析前剥除——parseArgs 会把 `--` 之后的
 * 词元一律当位置参数，不剥会吃掉旗标。
 */
export function parseArgv(argv: string[]): SandboxOptions {
	let parsed: {
		values: Record<string, string | boolean | undefined>;
		positionals: string[];
	};
	try {
		parsed = parseArgs({
			args: argv.filter((arg) => arg !== "--"),
			options: {
				pack: { type: "boolean" },
				force: { type: "boolean" },
				start: { type: "boolean" },
			},
			strict: true,
			allowPositionals: true,
		});
	} catch (err) {
		throw new Error(
			`参数错误：${err instanceof Error ? err.message : String(err)}（仅支持 [目录] / --pack / --force / --start）`,
		);
	}
	if (parsed.positionals.length > 1) {
		throw new Error(
			`多余的落点参数：${parsed.positionals[1]}`,
		);
	}
	return {
		target: parsed.positionals[0],
		pack: parsed.values.pack === true,
		force: parsed.values.force === true,
		start: parsed.values.start === true,
	};
}
