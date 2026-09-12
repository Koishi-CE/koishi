// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 子进程封装：git 命令与目录级批量 numstat。
 */
import { spawnSync } from "node:child_process";

/** 跑一条子进程命令，返回 stdout（git diff --no-index 的退出码 1 表示有差异，不是错误）。 */
export function run(
	cmd: string,
	args: string[],
	cwd?: string,
): { out: string; code: number } {
	const result = spawnSync(cmd, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return {
		out: (result.stdout ?? "") + (result.stderr ?? ""),
		code: result.status ?? -1,
	};
}

/**
 * 一对目录的批量 -w numstat：一次 git 进程替代逐文件 spawn。
 *
 * 走 -z 形态规避含空格路径与 `{a => b}` 花括号改写；每条记录为
 * 「增删行 + 源路径 + 目标路径」三段（NUL 分隔）。共同文件两侧路径都真实
 * 且相对路径一致；单侧文件的一侧是 /dev/null，重命名配对的两侧相对路径
 * 不同，均不会落入 common，天然被过滤。
 */
export function numstatChurn(
	oursDir: string,
	upDir: string,
	common: readonly string[],
): Map<string, [number, number]> {
	const map = new Map<string, [number, number]>();
	if (!common.length) return map;
	const commonSet = new Set(common);
	const normalize = (p: string) => p.replace(/\\/g, "/");
	const oursPrefix = `${normalize(oursDir)}/`;
	const upPrefix = `${normalize(upDir)}/`;
	// 去掉传入目录前缀取相对路径；git 以传入形态回显路径，win32 下可能混用分隔符
	const relative = (p: string): string | undefined => {
		const n = normalize(p);
		if (n.startsWith(oursPrefix))
			return n.slice(oursPrefix.length);
		if (n.startsWith(upPrefix))
			return n.slice(upPrefix.length);
		return undefined;
	};
	const { out } = run("git", [
		"diff",
		"--no-index",
		"-w",
		"--numstat",
		"-z",
		"--",
		oursDir,
		upDir,
	]);
	const chunks = out.split("\0");
	// stdout 以 NUL 收尾，stderr 追加在其后，按三段一组消费即可天然丢弃尾部杂音
	for (let i = 0; i + 2 < chunks.length; i += 3) {
		const meta = chunks[i];
		const src = chunks[i + 1];
		const dst = chunks[i + 2];
		if (!meta || !src || !dst) continue;
		const [add, del] = meta.split("\t");
		if (!add || !del) continue;
		// 二进制文件 numstat 记 "-"，与旧逐文件口径一致记作 ±1 行
		const counts: [number, number] =
			add === "-" ? [1, 1] : [Number(add), Number(del)];
		if (src === "/dev/null" || dst === "/dev/null")
			continue;
		const rel = relative(src);
		if (
			!rel ||
			rel !== relative(dst) ||
			!commonSet.has(rel)
		)
			continue;
		map.set(rel, counts);
	}
	return map;
}
