// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, beforeAll, expect, it } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `--docker` 的端到端生成：内置模板 + 四个容器化文件。
 *
 * 与 run-default.test.ts 同款手法：argv / cwd 在模块顶层固化，故在动态
 * 导入前改写 process.argv 并 chdir，并以 query 强制独立实例。-y 跳过
 * 依赖安装，因此不会触发任何子进程。
 */

const workspaceRoot = mkdtempSync(
	join(tmpdir(), "ckc-run-docker-"),
);
const previousCwd = process.cwd();
const previousArgv = process.argv.slice();

const logs: string[] = [];
const originalLog = console.log;

beforeAll(() => {
	console.log = (...args: unknown[]) => {
		logs.push(args.map((arg) => `${arg}`).join(" "));
	};
});

process.argv = [
	process.argv[0] ?? "bun",
	"create-koishi-ce",
	"app-docker",
	"--docker",
	"--prod",
	"-y",
];
process.chdir(workspaceRoot);
const specifier = "../index.ts?docker-run";
const { start } = (await import(
	specifier
)) as typeof import("../index.ts");
process.chdir(previousCwd);

afterAll(() => {
	console.log = originalLog;
	process.argv = previousArgv;
	rmSync(workspaceRoot, { recursive: true, force: true });
});

it("--docker 在内置模板之上生成容器化文件", async () => {
	await start();
	const dir = join(workspaceRoot, "app-docker");
	// 基础模板仍在
	expect(existsSync(join(dir, "koishi.yml"))).toBe(true);
	expect(existsSync(join(dir, "package.json"))).toBe(true);
	// 四个容器化文件（.dockerignore 为点前缀）
	for (const file of [
		"Dockerfile",
		"docker-entrypoint.sh",
		"compose.yaml",
		".dockerignore",
	]) {
		expect(existsSync(join(dir, file)), file).toBe(true);
	}
	// 内容落地正确（不是空文件）
	const dockerfile = readFileSync(
		join(dir, "Dockerfile"),
		"utf8",
	);
	expect(dockerfile).toContain("KOISHI_HOST=0.0.0.0");
	expect(dockerfile).toContain("--frozen-lockfile");
	const compose = readFileSync(
		join(dir, "compose.yaml"),
		"utf8",
	);
	expect(compose).toContain("init: true");
	expect(compose).toContain(".:/app");
	// 生成提示落在标准输出（脚手架的用户可见反馈）
	expect(logs.join("\n")).toContain(
		"docker compose up -d --build",
	);
	// prod 模式：devDependencies 已移除，但不影响容器化文件
	const manifest = JSON.parse(
		readFileSync(join(dir, "package.json"), "utf8"),
	) as Record<string, unknown>;
	expect("devDependencies" in manifest).toBe(false);
});

it("不带 --docker 时不生成容器化文件（默认模板保持干净）", async () => {
	process.argv = [
		process.argv[0] ?? "bun",
		"create-koishi-ce",
		"app-plain",
		"-y",
	];
	process.chdir(workspaceRoot);
	const plainSpecifier = "../index.ts?docker-plain";
	const plain = (await import(
		plainSpecifier
	)) as typeof import("../index.ts");
	process.chdir(previousCwd);
	await plain.start();
	const dir = join(workspaceRoot, "app-plain");
	expect(existsSync(join(dir, "koishi.yml"))).toBe(true);
	expect(existsSync(join(dir, "Dockerfile"))).toBe(false);
	expect(existsSync(join(dir, "compose.yaml"))).toBe(false);
});
