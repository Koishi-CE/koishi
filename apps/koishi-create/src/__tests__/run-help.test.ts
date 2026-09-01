// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

/**
 * start() 的 --help 分支：打印用法后直接返回（不产生任何写盘）。
 * argv 在模块顶层解析，故在动态导入前改写 process.argv。
 */

const logs: string[] = [];
const originalLog = console.log;

process.argv = [process.argv[0] ?? "bun", "create-koishi-ce", "--help"];

// 以 query 强制独立实例：index.ts 顶层固化 argv / cwd，而 bun test 的
// 模块注册表跨测试文件共享（不带 query 会拿到既有测试文件已加载的
// 实例，其 argv / cwd 均为测试进程默认值）。query 须以相对说明符的
// 形式交给运行时（file URL 形式的 query 不参与缓存键；TS 亦不解析
// 带 query 的说明符），故经变量动态构造，类型以 typeof import() 收紧
const specifier = "../index.ts?help";
const { start } = (await import(specifier)) as typeof import("../index.ts");

beforeAll(() => {
	console.log = (...args: unknown[]) => {
		logs.push(args.map((arg) => `${arg}`).join(" "));
	};
});

afterAll(() => {
	console.log = originalLog;
});

describe("create-koishi-ce --help", () => {
	it("打印用法说明后即返回", async () => {
		await start();
		const output = logs.join("\n");
		expect(output).toContain("用法：create-koishi-ce [名称] [选项]");
		expect(output).toContain("--template");
		expect(output).toContain("--prod");
		// 帮助分支不应询问项目名（无 "项目名：" 提示输出）
		expect(output).not.toContain("项目名：");
	});
});
