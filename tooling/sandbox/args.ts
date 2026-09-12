// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/** 命令行参数的解析结果。 */
export interface SandboxOptions {
	/** 沙盒落点（缺省用工作区同级 koishi-ce-sandbox）。 */
	target?: string;
	/** 打包模式（bun pm pack + 真实 install）。 */
	pack: boolean;
	/** 清空重建已存在的沙盒。 */
	force: boolean;
}

/**
 * 解析命令行参数：首个非旗标位置参数为落点目录；`--`（bun run 透传分隔符）
 * 忽略；`--pack` / `--force` 为旗标。其余旗标不识别，报错退出。
 */
export function parseArgv(argv: string[]): SandboxOptions {
	const options: SandboxOptions = {
		pack: false,
		force: false,
	};
	for (const arg of argv) {
		if (arg === "--") continue;
		if (arg === "--pack") {
			options.pack = true;
		} else if (arg === "--force") {
			options.force = true;
		} else if (arg.startsWith("--")) {
			throw new Error(
				`未知旗标：${arg}（仅支持 --pack / --force）`,
			);
		} else if (options.target === undefined) {
			options.target = arg;
		} else {
			throw new Error(`多余的落点参数：${arg}`);
		}
	}
	return options;
}
