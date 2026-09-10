// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * bun 安装子进程的驱动与输出转发。
 *
 * Bun-first：CE 生态只存在 bun 这一种包管理器，直接驱动 bun 执行安装
 * （上游经 which-pm-runs 探测 npm/yarn/bun，此处固定为 bun）。子进程本身的
 * 创建见 ./proc.ts；本模块负责退出码归一化与日志转发，不持有任何服务状态。
 */
import { Logger } from "@koishi-ce/koishi";
import { spawnBun } from "./proc.ts";

const logger = new Logger("market");

/**
 * 在 cwd 下执行 `bun <args>`，返回退出码（spawn 失败与异常退出统一为非 0，
 * 由调用方按失败处理）。
 *
 * 输出按行转发到 market 日志：未成行的尾段暂存到下一次数据到来时补齐，
 * 避免半行日志刷屏。
 */
export function runBun(
	args: string[],
	cwd: string,
): Promise<number> {
	return new Promise<number>((resolve) => {
		const child = spawnBun(args, cwd);
		child.on("exit", (code) => resolve(code ?? -1));
		child.on("error", () => resolve(-1));

		let stderr = "";
		child.stderr?.on("data", (data) => {
			stderr += data.toString();
			const lines = stderr.split("\n");
			stderr = lines.pop() ?? "";
			for (const line of lines) {
				logger.warn(line);
			}
		});

		let stdout = "";
		child.stdout?.on("data", (data) => {
			stdout += data.toString();
			const lines = stdout.split("\n");
			stdout = lines.pop() ?? "";
			for (const line of lines) {
				logger.info(line);
			}
		});
	});
}
