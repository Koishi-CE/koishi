// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

// 进程执行层与跨子命令共用的有界并发池。
//
// win32 上 npm 是 .cmd shim，CreateProcess 无法直执（spawn 报 ENOENT），必须
// 经 cmd.exe /d /s /c 显式包装；参数数组原样传递不经 shell 展开，无注入面。
// 捕获型查询走 spawnSync（Bun.spawn 管道在 win32 高并发下存在读端 EOF 不送达
// 的竞态）；直通型执行走 Bun.spawn（stdio 不经捕获管道，无该竞态）。stdin
// 默认 "ignore"，需要交互认证的命令（npm publish 的 OTP 浏览器认证要求
// stdin/stdout 双 TTY）传 "inherit"——断开 stdin 会直接抛 EOTP。
import { spawnSync } from "node:child_process";

/** win32 下把 .cmd 型命令（npm）包装为经 cmd.exe 执行的形式。 */
function wrapCmdShim(
	cmd: string,
	args: readonly string[],
): [string, string[]] {
	if (process.platform !== "win32") {
		return [cmd, [...args]];
	}
	return ["cmd.exe", ["/d", "/s", "/c", cmd, ...args]];
}

/** 执行命令（bun / git 等真实可执行文件），三路 stdio 直通；返回退出码。 */
export async function run(
	cmd: string,
	args: readonly string[],
	cwd: string,
	stdin?: "ignore" | "inherit",
): Promise<number> {
	const proc = Bun.spawn([cmd, ...args], {
		cwd,
		stdin: stdin ?? "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	return await proc.exited;
}

/** 执行 npm 命令（win32 经 cmd.exe 包装），stdio 直通；返回退出码。 */
export async function runNpm(
	args: readonly string[],
	cwd: string,
	stdin?: "ignore" | "inherit",
): Promise<number> {
	const [cmd, wrapped] = wrapCmdShim("npm", args);
	return await run(cmd, wrapped, cwd, stdin);
}

/** 执行命令并捕获 stdout（查询用）；非零退出或启动失败 → null。 */
export function capture(
	cmd: string,
	args: readonly string[],
	cwd: string,
): string | null {
	const res = spawnSync(cmd, [...args], {
		cwd,
		encoding: "utf8",
	});
	if (res.error !== undefined || res.status !== 0) {
		return null;
	}
	return res.stdout?.trim() ?? "";
}

/** 执行 npm 查询命令（win32 经 cmd.exe 包装）并捕获 stdout；失败 → null。 */
export function captureNpm(
	args: readonly string[],
	cwd: string,
): string | null {
	const [cmd, wrapped] = wrapCmdShim("npm", args);
	return capture(cmd, wrapped, cwd);
}

/** 有界并发池：失败即停止调度新任务，等在跑任务收尾后抛出首个错误。 */
export async function runPool<T>(
	items: readonly T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	let failed = false;
	let firstError: unknown;
	const lane = async (): Promise<void> => {
		while (!failed) {
			const item = items[next];
			next += 1;
			if (item === undefined) {
				return;
			}
			try {
				await worker(item);
			} catch (err) {
				if (!failed) {
					failed = true;
					firstError = err;
				}
				return;
			}
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(limit, items.length) },
			() => lane(),
		),
	);
	if (firstError !== undefined) {
		throw firstError;
	}
}
