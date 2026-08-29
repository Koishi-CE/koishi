/**
 * release 链共用的进程执行工具。
 *
 * Windows 上 npm/yarn/corepack/pnpm 均为 .cmd 批处理，CreateProcess 无法
 * 直接执行（spawn 报 ENOENT）——必须经 cmd.exe 显式执行。
 * 参数数组原样传递，不经 shell 展开，无注入面（规避 Node 对 shell:true
 * 传参的 DEP0190 警告）。
 * 可执行文件用字面量 "cmd.exe" 而非 ComSpec 环境变量：环境变量是外部
 * 可控输入，直接作为 spawn 目标存在替换执行程序的风险（CodeQL
 * shell-command-injection-from-environment）；cmd.exe 恒在 System32
 * （默认 PATH 内），行为与 ComSpec 缺省值一致。
 */
import { spawnSync } from "node:child_process";

/** Windows 下把命令包装为经 cmd.exe 执行的形式（其余平台原样返回）。 */
function wrapWin(cmd: string, args: readonly string[]): [string, string[]] {
	if (process.platform !== "win32") {
		return [cmd, [...args]];
	}
	return ["cmd.exe", ["/d", "/s", "/c", cmd, ...args]];
}

/** 在指定目录执行命令，stdio 直通当前进程；返回退出码（启动失败 → 1）。 */
export function runCommand(
	cwd: string,
	cmd: string,
	args: readonly string[],
): number {
	const [realCmd, realArgs] = wrapWin(cmd, args);
	const res = spawnSync(realCmd, realArgs, { cwd, stdio: "inherit" });
	if (res.error !== undefined) {
		process.stderr.write(`[run] ⚠️ 无法启动 ${cmd}: ${res.error.message}\n`);
		return 1;
	}
	return res.status ?? 1;
}

/** 执行命令并捕获 stdout（npm whoami / owner ls 等查询用）；失败返回 null。 */
export function captureCommand(
	cwd: string,
	cmd: string,
	args: readonly string[],
): string | null {
	const [realCmd, realArgs] = wrapWin(cmd, args);
	const res = spawnSync(realCmd, realArgs, { cwd, encoding: "utf8" });
	if (res.error !== undefined || res.status !== 0) {
		return null;
	}
	return res.stdout?.trim() ?? "";
}
