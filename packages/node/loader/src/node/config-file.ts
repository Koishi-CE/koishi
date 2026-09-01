// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 配置文件 I/O 的 Bun 实现：定位、解析与序列化写回。
 *
 * 对应 base/index.ts 声明的三个平台缝隙（locateConfig / parseConfig /
 * saveConfig），由 NodeLoader 接线。yaml 走 Bun 原生 Bun.YAML，
 * 文件内容读写走 Bun.file / Bun.write；目录探测与原子改名用 node:fs
 * （Bun 原生实现了同名 API）。
 */

import { constants, promises as fs } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type { Dict } from "@koishi-ce/core";
import {
	extensions,
	type ResolvedConfigFile,
	writable,
} from "../base/config-file.ts";

/** 探测文件是否可写（不可写则运行期不回盘） */
async function isWritable(filename: string) {
	try {
		await fs.access(filename, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * 依据 init 入参解析配置文件位置：
 * - 显式指向文件：直接采用（校验扩展名受支持）；
 * - 显式指向目录或未提供：在目录内按优先级查找默认配置。
 */
export async function locateConfig(
	baseDir: string,
	filename?: string,
): Promise<ResolvedConfigFile> {
	if (filename) {
		filename = resolve(baseDir, filename);
		const stats = await fs.stat(filename);
		if (stats.isFile()) {
			const ext = extname(filename);
			if (!extensions.has(ext)) {
				throw new Error(`extension "${ext}" not supported`);
			}
			return {
				baseDir: dirname(filename),
				filename,
				mime: writable[ext],
				writable: await isWritable(filename),
			};
		}
		baseDir = filename;
	}
	const found = await findConfigFile(baseDir);
	return {
		baseDir,
		filename: found.filename,
		mime: found.mime,
		writable: await isWritable(found.filename),
	};
}

/** 在 baseDir 下按优先级查找默认配置文件（koishi.config.* 优先于 koishi.*） */
async function findConfigFile(
	baseDir: string,
): Promise<{ filename: string; mime: string | undefined }> {
	const files = await fs.readdir(baseDir);
	for (const basename of ["koishi.config", "koishi"]) {
		for (const ext of extensions) {
			if (files.includes(basename + ext)) {
				return {
					mime: writable[ext],
					filename: resolve(baseDir, basename + ext),
				};
			}
		}
	}
	throw new Error("config file not found");
}

/**
 * 从文件读取并解析配置：yaml 走 Bun 原生解析，json 按文本解析（不经过
 * 模块缓存，配置文件修改后重读生效），其余扩展名（脚本配置）以 require
 * 加载——Bun 的 require 可直接加载 ESM / TS，且模块会进入 require.cache，
 * hmr 插件据此识别"配置模块已加载只能整体重启"。
 */
export async function parseConfig(
	filename: string,
	mime: string | undefined,
): Promise<unknown> {
	if (mime === "application/yaml") {
		return Bun.YAML.parse(await Bun.file(filename).text());
	} else if (mime === "application/json") {
		return JSON.parse(await Bun.file(filename).text());
	}
	const module = require(filename);
	return module.default || module;
}

/**
 * 将配置序列化并原子写回：先写临时文件再改名，避免写一半被读到。
 */
export async function saveConfig(
	filename: string,
	config: Dict<unknown>,
	mime: string | undefined,
): Promise<void> {
	let content: string;
	if (mime === "application/yaml") {
		// 带缩进参数输出块级（多行）样式，与历史 js-yaml 产物形态一致
		content = Bun.YAML.stringify(config, null, 2);
	} else if (mime === "application/json") {
		content = JSON.stringify(config, null, 2);
	} else {
		// 理论上不可达：mime 只会来自 writable 表
		throw new Error(`unsupported config mime: ${mime}`);
	}
	await Bun.write(`${filename}.tmp`, content);
	await fs.rename(`${filename}.tmp`, filename);
}
