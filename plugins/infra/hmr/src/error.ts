// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * hmr 错误处理辅助模块。
 *
 * 识别 esbuild 的构建失败（BuildFailure，通常来自 TS 源码的即时编译），
 * 为每个带位置信息的错误生成语法高亮的代码帧（code frame）并写入日志，
 * 便于在热重载失败时直接定位到源码的出错行。
 */

import { readFileSync } from "node:fs";
import { codeFrameColumns } from "@babel/code-frame";
import type { Logger } from "@koishi-ce/koishi";
import type { BuildFailure } from "esbuild";

/** 判断异常是否为 esbuild 构建失败（errors 数组且每项都带 text 字段） */
function isBuildFailure(e: unknown): e is BuildFailure {
	return (
		typeof e === "object" &&
		e !== null &&
		"errors" in e &&
		Array.isArray(e.errors) &&
		e.errors.every((error) => {
			return (
				typeof error === "object" &&
				error !== null &&
				"text" in error &&
				Boolean(error.text)
			);
		})
	);
}

/**
 * 记录热重载过程中的异常
 * @param e 捕获到的异常
 * @param logger 日志输出对象
 *
 * 普通异常直接告警；esbuild 构建失败则逐项输出带代码帧的位置信息
 */
export function handleError(e: unknown, logger: Logger) {
	if (!isBuildFailure(e)) {
		logger.warn(e);
		return;
	}

	for (const error of e.errors) {
		if (!error.location) {
			logger.warn(error.text);
			continue;
		}
		try {
			const { file, line, column } = error.location;
			const source = readFileSync(file, "utf8");
			const formatted = codeFrameColumns(
				source,
				{
					start: { line, column },
				},
				{
					highlightCode: true,
					message: error.text,
				},
			);
			logger.warn(
				`File: ${file}:${line}:${column}\n${formatted}`,
			);
		} catch (e) {
			logger.warn(e);
		}
	}
}
