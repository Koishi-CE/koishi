// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 本机 npm registry 配置探测（纯函数域，零子进程、零网络）。
 *
 * 优先级对齐 npm 自身：环境变量 > 项目 .npmrc > 用户 ~/.npmrc。刻意不
 * spawn 子进程探测——既有实现按 user-agent 选 `bun config get registry`，
 * 而 Bun 没有 config 子命令，子进程退出码 1 会直接炸掉调用方；读 npmrc
 * 是零依赖、零子进程的等价路径。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** npm 官方源：探测不到本机配置时的最终回落。 */
export const NPM_OFFICIAL_REGISTRY =
	"https://registry.npmjs.org/";

/**
 * 从单个 .npmrc 文件提取 registry 配置项（非注释、非 scoped 的 registry= 行）。
 * 文件不存在或未配置时返回 undefined，读文件异常一律静默吞掉。
 */
export function readNpmrcRegistry(
	file: string,
): string | undefined {
	try {
		for (const line of readFileSync(file, "utf8").split(
			/\r?\n/,
		)) {
			const matched = /^\s*registry\s*=\s*(\S+)\s*$/.exec(
				line,
			);
			const value = matched?.[1];
			if (value) return value;
		}
	} catch {
		// registry 探测不允许打断主流程，任何读取失败都视为未配置
	}
	return undefined;
}

/**
 * 读取本机 npm registry 配置（优先级对齐 npm 自身：环境变量 > 项目
 * .npmrc > 用户 ~/.npmrc）。任何一步都拿不到时返回 undefined，由调用方
 * 决定回落源（通常回落 {@link NPM_OFFICIAL_REGISTRY}）。
 */
export function getLocalRegistry(
	cwd: string = process.cwd(),
	userHome: string = homedir(),
): string | undefined {
	const candidates = [
		process.env["npm_config_registry"],
		readNpmrcRegistry(join(cwd, ".npmrc")),
		readNpmrcRegistry(join(userHome, ".npmrc")),
	];
	for (const candidate of candidates) {
		if (
			candidate?.startsWith("https://") ||
			candidate?.startsWith("http://")
		) {
			return candidate;
		}
	}
	return undefined;
}
