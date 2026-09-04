// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * release 工具链的进程执行层。
 *
 * Windows 上 npm 以 .cmd 批处理 shim 暴露，CreateProcess 无法直接执行
 * （spawn 报 ENOENT），必须经 cmd.exe 显式执行；参数数组原样传递不经
 * shell 展开，无注入面。cmd.exe 用字面量而非 ComSpec 环境变量，规避
 * 环境变量作为 spawn 目标的替换执行风险（与 apps/koishi-scripts 的
 * run.ts 同一结论）。bun / git 是真实可执行文件，直接 spawn。
 *
 * 捕获型查询走 spawnSync：Bun.spawn 的管道在 win32 高并发下存在读端
 * EOF 不送达的竞态（本仓 typecheck 因此弃用 Bun.spawn 管道并发），查询类调用
 * 低频且需要返回值，同步执行最稳；直通型执行走 Bun.spawn，stdio 全程不经
 * 捕获管道，无该竞态，支持异步等待以便并发编排。注意 Bun.spawn 的
 * stdout/stderr 默认是无人读取的管道而非继承终端，输出会被整体丢弃，
 * 必须显式 "inherit"；stdin 默认保持 "ignore"（构建 / git 类命令不读
 * 标准输入），需要交互认证的命令显式传 { stdin: "inherit" }——npm 的
 * OTP 浏览器认证（otplease）要求 stdin/stdout 双 TTY 才会弹浏览器并
 * 轮询等待，stdin 断开时直接抛 EOTP。
 */
import { spawnSync } from "node:child_process";

/** win32 下把 .cmd 型命令（npm）包装为经 cmd.exe 执行的形式；其余平台原样。 */
function wrapCmdShim(
	cmd: string,
	args: readonly string[],
): [string, string[]] {
	if (process.platform !== "win32") {
		return [cmd, [...args]];
	}
	return ["cmd.exe", ["/d", "/s", "/c", cmd, ...args]];
}

/** 直通执行的选项。 */
export type RunOptions = {
	/** 子进程 stdin；默认 "ignore"，需要交互认证（如 npm publish 的 OTP 浏览器认证）时传 "inherit"。 */
	stdin?: "ignore" | "inherit";
};

/** 执行命令（bun / git 等真实可执行文件），三路 stdio 直通当前进程；返回退出码。 */
export async function run(
	cmd: string,
	args: readonly string[],
	cwd: string,
	options?: RunOptions,
): Promise<number> {
	const proc = Bun.spawn([cmd, ...args], {
		cwd,
		stdin: options?.stdin ?? "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	return await proc.exited;
}

/** 执行 npm 命令（win32 经 cmd.exe 包装），stdio 直通；返回退出码。 */
export async function runNpm(
	args: readonly string[],
	cwd: string,
	options?: RunOptions,
): Promise<number> {
	const [cmd, wrapped] = wrapCmdShim("npm", args);
	return await run(cmd, wrapped, cwd, options);
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
