/**
 * env 文件支持：解析 .env / .env.local 并注入 process.env。
 *
 * 记录注入的键（localKeys），在重读配置前先撤销，避免污染宿主环境；
 * 进程启动时即已存在的环境变量键永远不会被 env 文件覆盖。
 */

import type { Dict } from "@koishi-ce/core";
import * as dotenv from "dotenv";
import { promises as fs } from "fs";

/** 进程启动时即已存在的环境变量键（env 文件不得覆盖这些键） */
const initialKeys = Object.getOwnPropertyNames(process.env);

/** 读取并合并全部 env 文件（后者覆盖前者），文件缺失时静默跳过 */
export async function parseEnvFiles(filenames: readonly string[]) {
	const parsed: Dict<string> = {};
	for (const filename of filenames) {
		try {
			const raw = await fs.readFile(filename, "utf8");
			Object.assign(parsed, dotenv.parse(raw));
		} catch {}
	}
	return parsed;
}

/** 将解析结果注入 process.env（不覆盖进程原有键），返回注入的键列表 */
export function injectEnv(parsed: Dict<string>) {
	const keys: string[] = [];
	for (const key in parsed) {
		if (initialKeys.includes(key)) continue;
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
