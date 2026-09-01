// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * env 文件支持：解析 .env / .env.local 并注入 process.env。
 *
 * 解析器为 dotenv 格式的自实现子集（替代 dotenv 依赖）：支持注释、
 * 可选 export 前缀、单/双引号值（双引号处理 \n \r \t 等常见转义，
 * 引号值可跨行，如证书内容）、无引号值的行内注释剥离。
 *
 * 记录注入的键（localKeys），在重读配置前先撤销，避免污染宿主环境；
 * 进程启动时即已存在的环境变量键永远不会被 env 文件覆盖。
 */

import type { Dict } from "@koishi-ce/core";

/** 进程启动时即已存在的环境变量键（env 文件不得覆盖这些键）。
 *
 * Windows 的环境块大小写不敏感：进程实际携带的键名可能是注册表里的
 * 原始形式（如 PowerShell 会话下的 "Path"），而 env 文件里写的往往是
 * 大写 "PATH"——直接按字面比对会漏判，把既有变量当新键注入并覆盖。
 * 因此 win32 下统一大写归一后比对；POSIX 严格区分大小写，保持原样。 */
const foldKey =
	process.platform === "win32"
		? (key: string): string => key.toUpperCase()
		: (key: string): string => key;
const initialKeys = new Set(
	Object.getOwnPropertyNames(process.env).map(foldKey),
);

/** 找到带引号值的闭合引号位置（跳过转义字符），未闭合返回 -1 */
function findQuoteClose(raw: string, quote: string): number {
	for (let index = 1; index < raw.length; index++) {
		if (raw[index] === "\\") {
			index++;
		} else if (raw[index] === quote) {
			return index;
		}
	}
	return -1;
}

/** 去掉首尾引号并按引号类型处理转义 */
function unquote(raw: string, quote: string): string {
	const body = raw.slice(1, -1);
	if (quote === "'") {
		// 单引号：字面值，仅还原转义的引号本身
		return body.replace(/\\'/g, "'");
	}
	// 双引号：还原常见转义序列
	return body
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");
}

/**
 * 解析 dotenv 格式的 env 文件文本为键值表。
 * 无法识别的行（缺失分隔符等）静默跳过。
 */
export function parseEnv(source: string): Dict<string> {
	const result: Dict<string> = {};
	const lines = source.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		let line = (lines[index] ?? "").trim();
		// 空行与注释行跳过；支持可选的 export 前缀
		if (!line || line.startsWith("#")) continue;
		line = line.replace(/^export\s+/, "");
		const assignment = /^([\w.-]+)\s*[=:]\s*(.*)$/.exec(line);
		if (!assignment) continue;
		const [, key = "", rest = ""] = assignment;
		const quote = rest[0];
		if (quote === '"' || quote === "'") {
			// 带引号的值可能跨行（如证书），持续读入直到引号闭合
			let raw = rest;
			let close = findQuoteClose(raw, quote);
			while (close < 0 && index + 1 < lines.length) {
				raw += `\n${lines[++index] ?? ""}`;
				close = findQuoteClose(raw, quote);
			}
			result[key] = close < 0 ? raw : unquote(raw.slice(0, close + 1), quote);
		} else {
			// 无引号值：剥离行内注释（# 前需有空白）与首尾空白
			result[key] = rest.replace(/\s+#.*$/, "").trim();
		}
	}
	return result;
}

/** 读取并合并全部 env 文件（后者覆盖前者），文件缺失时静默跳过 */
export async function parseEnvFiles(filenames: readonly string[]) {
	const parsed: Dict<string> = {};
	for (const filename of filenames) {
		try {
			Object.assign(parsed, parseEnv(await Bun.file(filename).text()));
		} catch {}
	}
	return parsed;
}

/** 将解析结果注入 process.env（不覆盖进程原有键），返回注入的键列表 */
export function injectEnv(parsed: Dict<string>) {
	const keys: string[] = [];
	for (const key in parsed) {
		if (initialKeys.has(foldKey(key))) continue;
		process.env[key] = parsed[key];
		keys.push(key);
	}
	return keys;
}

/** 撤销此前由 env 文件注入的环境变量 */
export function revertEnv(keys: readonly string[]) {
	for (const key of keys) {
		delete process.env[key];
	}
}
