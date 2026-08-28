/**
 * 配置文件的格式层：扩展名 → MIME 映射、解析 / 序列化与定位。
 *
 * 只做"文件 ↔ 对象"的纯转换，不持有任何 Loader 状态；
 * 读写时机与回写合并策略见 base.ts 的 readConfig / writeConfig。
 */

import type { Dict } from "@koishi-ce/core";
import { promises as fs } from "fs";
import * as yaml from "js-yaml";
import * as path from "path";

/** 支持写入的配置文件扩展名与对应 MIME 类型 */
export const writable: Dict<string> = {
	".json": "application/json",
	".yaml": "application/yaml",
	".yml": "application/yaml",
};

/** 支持的配置文件扩展名集合 */
export const extensions = new Set(Object.keys(writable));

/** 解析出的配置文件位置 */
export interface ResolvedConfigFile {
	/** 配置文件绝对路径 */
	filename: string;
	/** 配置文件 MIME 类型 */
	mime: string | undefined;
	/** 配置文件所在目录（显式传入目录时为该目录本身） */
	baseDir: string;
}

/**
 * 依据 init 入参解析配置文件位置：
 * - 显式指向文件：直接采用（校验扩展名受支持）；
 * - 显式指向目录或未提供：在目录内按优先级查找默认配置。
 */
export async function resolveConfigFile(
	baseDir: string,
	filename?: string,
): Promise<ResolvedConfigFile> {
	if (filename) {
		filename = path.resolve(baseDir, filename);
		const stats = await fs.stat(filename);
		if (stats.isFile()) {
			const extname = path.extname(filename);
			if (!extensions.has(extname)) {
				throw new Error(`extension "${extname}" not supported`);
			}
			return {
				baseDir: path.dirname(filename),
				filename,
				mime: writable[extname],
			};
		}
		baseDir = filename;
	}
	return { baseDir, ...(await findConfigFile(baseDir)) };
}

/** 在 baseDir 下按优先级查找默认配置文件（koishi.config.* 优先于 koishi.*） */
async function findConfigFile(
	baseDir: string,
): Promise<{ filename: string; mime: string | undefined }> {
	const files = await fs.readdir(baseDir);
	for (const basename of ["koishi.config", "koishi"]) {
		for (const extname of extensions) {
			if (files.includes(basename + extname)) {
				return {
					mime: writable[extname],
					filename: path.resolve(baseDir, basename + extname),
				};
			}
		}
	}
	throw new Error("config file not found");
}

/** 从文件读取并解析配置：yaml / json 走文本解析，其余按模块 require 加载 */
export async function parseConfig(
	filename: string,
	mime: string | undefined,
): Promise<any> {
	if (mime === "application/yaml") {
		return yaml.load(await fs.readFile(filename, "utf8"));
	} else if (mime === "application/json") {
		// 此处不用 require，避免把配置文件缓存进 require.cache 导致后续修改失效
		return JSON.parse(await fs.readFile(filename, "utf8"));
	}
	const module = require(filename);
	return module.default || module;
}

/** 将配置序列化为待写入的文本内容 */
export function dumpConfig(config: any, mime: string | undefined) {
	if (mime === "application/yaml") return yaml.dump(config);
	if (mime === "application/json") return JSON.stringify(config, null, 2);
	// 理论上不可达：mime 只会来自 writable 表
	throw new Error(`unsupported config mime: ${mime}`);
}
