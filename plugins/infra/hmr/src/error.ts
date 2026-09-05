// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * hmr 错误处理辅助模块。
 *
 * 识别 Bun 即时编译 TS 源码的构建失败（require 坏 TS 抛 AggregateError，
 * errors 数组为 BuildMessage 实例，位置信息在 position.{file,line,column}，
 * 与上游 esbuild 时代的 { text, location } 形态不同），为每个带位置的
 * 错误生成语法高亮的代码帧（code frame）并写入日志，便于在热重载失败
 * 时直接定位到源码的出错行。
 */

import { readFileSync } from "node:fs";
import { codeFrameColumns } from "@babel/code-frame";
import type { Logger } from "@koishi-ce/koishi";

/** Bun 构建错误消息的位置信息形态（BuildMessage.position，行列均从 1 起） */
interface BuildPosition {
	file?: string;
	line?: number;
	column?: number;
}

/** Bun 构建错误消息形态（BuildMessage：message 是原型上的 getter） */
interface BuildMessage {
	message: string;
	position?: BuildPosition;
}

/** Bun 构建失败的聚合异常形态（将 errors 自 unknown[] 收窄为 BuildMessage[]） */
interface BuildAggregateError extends AggregateError {
	errors: BuildMessage[];
}

/** 判断异常是否为 Bun 构建失败（AggregateError 且 errors 各项均带非空字符串 message） */
function isBuildFailure(
	e: unknown,
): e is BuildAggregateError {
	return (
		e instanceof AggregateError &&
		e.errors.length > 0 &&
		e.errors.every(
			(error) =>
				typeof error === "object" &&
				error !== null &&
				typeof (error as BuildMessage).message ===
					"string" &&
				(error as BuildMessage).message.length > 0,
		)
	);
}

/**
 * 记录热重载过程中的异常
 * @param e 捕获到的异常
 * @param logger 日志输出对象
 *
 * 普通异常直接告警；Bun 构建失败则逐项输出带代码帧的位置信息
 */
export function handleError(e: unknown, logger: Logger) {
	if (!isBuildFailure(e)) {
		logger.warn(e);
		return;
	}

	for (const error of e.errors) {
		const { file, line, column } = error.position ?? {};
		if (!file || !line || !column) {
			logger.warn(error.message);
			continue;
		}
		try {
			const source = readFileSync(file, "utf8");
			const formatted = codeFrameColumns(
				source,
				{
					start: { line, column },
				},
				{
					highlightCode: true,
					message: error.message,
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
