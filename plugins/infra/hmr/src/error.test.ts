// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, describe, expect, it } from "bun:test";
/**
 * hmr 错误处理测试：验证 handleError 对四类输入的分流——
 * 普通异常与非法 AggregateError 原样告警；Bun 构建失败
 * （AggregateError + BuildMessage）按 position 渲染代码帧，
 * 无 position 的消息逐项字符串告警。
 */
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@koishi-ce/koishi";
import { handleError } from "./error.ts";

/** 收集 warn 调用参数的最小 Logger 桩 */
function createLogger() {
	const calls: unknown[] = [];
	const logger = {
		warn: (arg: unknown) => calls.push(arg),
	} as unknown as Logger;
	return { logger, calls };
}

/** Bun 的 code frame 输出携带 ANSI 高亮色码，断言前先剥离 */
function stripANSI(text: string) {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: 剥离 ANSI 色码必须匹配转义控制字符 ESC
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

const dir = mkdtempSync(join(tmpdir(), "hmr-error-"));
const filename = join(dir, "broken.ts");
writeFileSync(filename, "const a = 1\nconst b = 2\n");

afterAll(() =>
	rmSync(dir, { recursive: true, force: true }),
);

describe("handleError", () => {
	it("普通异常原样告警", () => {
		const { logger, calls } = createLogger();
		const error = new Error("boom");
		handleError(error, logger);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBe(error);
	});

	it("errors 元素缺 message 的 AggregateError 原样告警", () => {
		const { logger, calls } = createLogger();
		const error = new AggregateError([1, null]);
		handleError(error, logger);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBe(error);
	});

	it("带 position 的构建失败渲染代码帧", () => {
		const { logger, calls } = createLogger();
		const error = new AggregateError(
			[
				{
					message: 'Expected ";" but found "2"',
					position: { file: filename, line: 2, column: 11 },
				},
			],
			"1 error building",
		);
		handleError(error, logger);
		expect(calls).toHaveLength(1);
		const text = stripANSI(String(calls[0]));
		expect(text).toContain(`File: ${filename}:2:11`);
		// 代码帧带行号栏、出错行标记与指位符，且以编译错误消息收尾
		expect(text).toContain("  1 |");
		expect(text).toContain("> 2 |");
		expect(text).toContain("^");
		expect(text).toContain('Expected ";" but found "2"');
	});

	it("无 position 的构建失败逐项告警消息", () => {
		const { logger, calls } = createLogger();
		handleError(
			new AggregateError([
				{ message: "first" },
				{ message: "second", position: {} },
			]),
			logger,
		);
		expect(calls).toEqual(["first", "second"]);
	});

	it("position 指向的文件不可读时退回异常告警", () => {
		const { logger, calls } = createLogger();
		handleError(
			new AggregateError([
				{
					message: "gone",
					position: {
						file: join(dir, "missing.ts"),
						line: 1,
						column: 1,
					},
				},
			]),
			logger,
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBeInstanceOf(Error);
	});
});
