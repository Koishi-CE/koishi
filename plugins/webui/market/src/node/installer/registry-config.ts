// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 本机 npm registry 配置探测（零子进程）。
 *
 * 刻意不 spawn 子进程——原依赖 get-registry 按 user-agent 选
 * `bun config get registry`，而 Bun 没有 config 子命令，Bun 运行时下子进程
 * 退出码 1 直接炸掉 market 服务启动；读 npmrc 是零子进程的等价路径。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 从单个 .npmrc 文件提取 registry 配置项；文件不存在或读取出错一律视为未配置 */
function readNpmrcRegistry(
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
	} catch {}
	return undefined;
}

/**
 * 读取本机 npm registry 配置（优先级对齐 npm 自身：环境变量 > 项目
 * .npmrc > 用户 ~/.npmrc）。任何一步都拿不到时回落 npm 官方源（对齐被
 * 移除的 get-registry 的默认值），保证 http 恒有 endpoint 可拼接相对
 * URL——缺省时相对请求会在 resolveURL 抛 Invalid URL。
 */
export function getLocalRegistry(
	cwd: string,
	userHome: string = homedir(),
): string {
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
	return "https://registry.npmjs.org/";
}
