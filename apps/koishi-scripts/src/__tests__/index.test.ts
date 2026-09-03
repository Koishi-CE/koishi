// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwd, loadHostManifest } from "../index.ts";
// run.ts 的真实进程执行测试放在本文件（文件名字典序最靠前，先于其余
// 会对 run.ts 注册 mock 的 release 测试加载，恒取真实实现）。
// 注意以值拷贝持有真实函数：后续文件的 mock.module 会改写已加载模块
// 的命名空间属性（活绑定），全量运行时静态 import 的绑定可能被替换
import * as runModule from "../release/run.ts";

const { runCommand, captureCommand } = runModule;

/**
 * 共享工具（index.ts）与进程执行工具（release/run.ts）的测试：
 * - cwd 捕获启动目录；loadHostManifest 成功读取仓库清单 / 失败兜底 null；
 * - runCommand / captureCommand 在 Windows 经 cmd.exe 执行并回传退出码与 stdout。
 */
describe("共享工具（index.ts）", () => {
	it("cwd 为模块加载时的工作目录", () => {
		expect(cwd).toBe(process.cwd());
	});

	it("loadHostManifest 成功读取宿主工作区清单", async () => {
		const manifest = await loadHostManifest();
		// bun test 自仓库根执行，根 package.json 必然存在且合法
		expect(manifest).not.toBeNull();
		expect(typeof manifest?.["name"]).toBe("string");
	});

	it("清单读取失败（无清单 / 非 JSON）时返回 null", async () => {
		// 临时替换 Bun.file 使其抛错，验证 catch 兜底；用完立即恢复
		const originalFile = Bun.file;
		try {
			Bun.file = () => {
				throw new Error("boom");
			};
			await expect(loadHostManifest()).resolves.toBeNull();
		} finally {
			Bun.file = originalFile;
		}
	});
});

describe("进程执行工具（release/run.ts）", () => {
	const workdir = mkdtempSync(join(tmpdir(), "koishi-scripts-run-"));

	it("runCommand 返回子进程退出码", () => {
		expect(runCommand(workdir, process.execPath, ["-e", "0"])).toBe(0);
		expect(
			runCommand(workdir, process.execPath, ["-e", "process.exit(3)"]),
		).toBe(3);
	});

	it("runCommand 在无效 cwd 下启动失败返回 1", () => {
		const missing = join(workdir, "definitely-missing-dir");
		expect(existsSync(missing)).toBe(false);
		// 启动失败的警告直通 stderr：捕获后转为断言，避免预期告警刷屏
		const chunks: string[] = [];
		const originalWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((chunk: string | Uint8Array) => {
			chunks.push(`${chunk}`);
			return true;
		}) as typeof process.stderr.write;
		try {
			expect(runCommand(missing, "echo", ["hi"])).toBe(1);
		} finally {
			process.stderr.write = originalWrite;
		}
		expect(chunks.join("")).toContain("无法启动 echo");
	});

	it("captureCommand 捕获 stdout，失败时返回 null", () => {
		expect(
			captureCommand(workdir, process.execPath, ["-e", "console.log('hi')"]),
		).toBe("hi");
		expect(
			captureCommand(workdir, process.execPath, ["-e", "process.exit(4)"]),
		).toBeNull();
		const missing = join(workdir, "definitely-missing-dir");
		expect(captureCommand(missing, "echo", ["hi"])).toBeNull();
	});

	it("临时目录清理", () => {
		rmSync(workdir, { recursive: true, force: true });
		expect(existsSync(workdir)).toBe(false);
	});
});
