// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tarPack } from "./tar-pack.ts";

/**
 * start() 远程模板分支（--template）的端到端测试。
 *
 * 以 Bun.serve 起本地伪 registry（127.0.0.1 随机端口），按用例切换
 * 场景（正常 / 元数据 404 / dist-tag 缺失 / tarball 404 / tarball 损坏）；
 * tarball 由 __tests__/tar-pack.ts 的 tarPack 打包（ustar + gzip，与真实
 * npm tarball 同构），scaffoldRemote 的下载-解包-改写全链路真实执行
 * （解包走 giget，含超长名 pax 条目的端到端验证）。
 *
 * 覆盖率口径说明：bun 的覆盖率对同一路径的多个 query 实例只统计最后
 * 求值的那份，本文件是 koishi-create 全部测试中最后加载的实例，因此
 * 在此补齐 registry 探测纯函数、emptyDir 与 initGit（--git）等只在其它
 * 实例出现过的分支，保证 src/index.ts 的行覆盖完整。
 */

const workspaceRoot = mkdtempSync(join(tmpdir(), "ckc-run-remote-"));
const previousCwd = process.cwd();
const previousArgv = process.argv.slice();
const previousExit = process.exit;

/** 伪 registry 的场景开关 */
let scenario: "ok" | "meta-404" | "missing-ref" | "tarball-404" | "corrupt" =
	"ok";

/** 预先打包好的模板 tarball（package/ 前缀目录，strip:1 解包） */
let tarball: Uint8Array;

/** 超长文件名（>100 字节，触发 pax 扩展头），归档与落盘共用同一串 */
const longName = "deep".repeat(30);

// fetch 回调内引用 registry.port，显式标注返回类型以切断 initializer 的循环推断
const registry = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	// serve 的 fetch 允许同步或异步返回，显式标注以切断 registry 的循环推断
	fetch: (request): Response | Promise<Response> => {
		const url = new URL(request.url);
		if (url.pathname === "/fake-tpl") {
			if (scenario === "meta-404") {
				return new Response(null, { status: 404, statusText: "Not Found" });
			}
			if (scenario === "missing-ref") {
				return Response.json({
					"dist-tags": { latest: "1.0.0" },
					versions: { "1.0.0": {} },
				});
			}
			return Response.json({
				"dist-tags": { latest: "1.0.0", beta: "2.0.0" },
				versions: {
					"2.0.0": {
						dist: {
							tarball: `http://127.0.0.1:${registry.port}/fake-tpl/-/fake-tpl-2.0.0.tgz`,
						},
					},
				},
			});
		}
		if (url.pathname === "/fake-tpl/-/fake-tpl-2.0.0.tgz") {
			if (scenario === "tarball-404") {
				return new Response(null, { status: 404, statusText: "Not Found" });
			}
			if (scenario === "corrupt") {
				return new Response("definitely not a tarball", { status: 200 });
			}
			return new Response(tarball);
		}
		return new Response(null, { status: 404 });
	},
});

/** @clack/prompts mock：install 的 confirm 默认拒绝，可按用例入队覆盖 */
const confirmAnswers: boolean[] = [];

mock.module("@clack/prompts", () => ({
	text: async () => "",
	confirm: async () => confirmAnswers.shift() ?? false,
	isCancel: (value: unknown) => typeof value === "symbol",
	cancel: () => {},
}));

// erasableSyntaxOnly 禁用参数属性，改为显式字段声明
class ExitError extends Error {
	code: number;
	constructor(code: number) {
		super(`process.exit(${code})`);
		this.code = code;
	}
}

process.exit = ((code?: number) => {
	throw new ExitError(code ?? 0);
}) as typeof process.exit;

process.argv = [
	process.argv[0] ?? "bun",
	"create-koishi-ce",
	"myapp",
	"--template",
	"fake-tpl",
	"--registry",
	`http://127.0.0.1:${registry.port}`,
	"--ref",
	"beta",
	// 附带 --git 使 initGit 的 supports / gitConfig 分支也得到执行
	// （spawnSync 由 run-default 注册的 mock 拦截，无真实子进程）
	"--git",
];
process.chdir(workspaceRoot);
// query 强制独立实例（说明见 run-help.test.ts）
const specifier = "../index.ts?remote-run";
const { start, getLocalRegistry, readNpmrcRegistry } = (await import(
	specifier
)) as typeof import("../index.ts");
process.chdir(previousCwd);

const logs: string[] = [];
const originalLog = console.log;

beforeAll(async () => {
	console.log = (...args: unknown[]) => {
		logs.push(args.map((arg) => `${arg}`).join(" "));
	};
	// 造模板载荷并打包：package/package.json + package/index.js + 超长名文件
	const encoder = new TextEncoder();
	tarball = await tarPack([
		{
			path: "package/package.json",
			data: encoder.encode(
				JSON.stringify({
					name: "fake-tpl",
					version: "2.0.0",
					private: false,
					workspaces: ["src/*"],
					scripts: { start: "node index.js" },
				}),
			),
		},
		{
			path: "package/index.js",
			data: encoder.encode("console.log('tpl');\n"),
		},
		{
			// 124 字符 > ustar 的 100 字节 name 上限：tarPack 前置 pax
			// 扩展头，giget（tar 库）经 pax 还原后同样能正确落盘
			path: `package/${longName}.txt`,
			data: encoder.encode("pax"),
		},
	]);
});

afterAll(() => {
	console.log = originalLog;
	process.exit = previousExit;
	process.argv = previousArgv;
	void registry.stop(true);
	rmSync(workspaceRoot, { recursive: true, force: true });
});

/** 每个场景前移除上一场景的产物，prepare 走「新建目录」分支 */
function reset(sc: typeof scenario): void {
	scenario = sc;
	logs.length = 0;
	rmSync(join(workspaceRoot, "myapp"), { recursive: true, force: true });
	// giget 把 tarball 缓存到系统临时目录（win32 为 tmpdir()/giget，不受
	// XDG_CACHE_HOME 影响）；逐用例清理，避免上一场景的缓存（tarball-404
	// 的缺失或 corrupt 的损坏归档）被 giget 的「下载失败回退缓存」吞掉
	rmSync(join(tmpdir(), "giget"), { recursive: true, force: true });
}

describe("create-koishi-ce 远程模板", () => {
	it("正常链路：元数据 → tarball → 解包 → package.json 改写", async () => {
		reset("ok");
		await start();
		const dir = join(workspaceRoot, "myapp");
		expect(existsSync(join(dir, "index.js"))).toBe(true);
		// 超长名文件经 pax 扩展头正常落盘（tarPack 打包 → giget 解包全链路）
		expect(readFileSync(join(dir, `${longName}.txt`), "utf8")).toBe("pax");
		const manifest = JSON.parse(
			readFileSync(join(dir, "package.json"), "utf8"),
		) as Record<string, unknown>;
		// writePackageJson：替换项目名、标记 private、版本归零；模板其余字段保留
		expect(manifest["name"]).toBe("myapp");
		expect(manifest["private"]).toBe(true);
		expect(manifest["version"]).toBe("0.0.0");
		expect(manifest["workspaces"]).toEqual(["src/*"]);
		expect(logs.join("\n")).toContain("使用 registry");
	});

	it("模板包元数据 404：HttpError 提示后以码 1 退出", async () => {
		reset("meta-404");
		await expect(start()).rejects.toThrow("process.exit(1)");
		expect(logs.join("\n")).toContain("请求失败：HTTP 404");
	});

	it("dist-tag 引用不存在：以码 1 退出", async () => {
		reset("missing-ref");
		await expect(start()).rejects.toThrow("process.exit(1)");
		expect(logs.join("\n")).toContain("模板 fake-tpl@beta 不存在");
	});

	it("tarball 下载 404：以码 1 退出", async () => {
		reset("tarball-404");
		await expect(start()).rejects.toThrow("process.exit(1)");
		expect(logs.join("\n")).toContain("请求失败：HTTP 404");
	});

	it("tarball 内容损坏：解包错误原样抛出（非 HttpError 不吞）", async () => {
		reset("corrupt");
		await expect(start()).rejects.toThrow();
		// 非 HttpError 路径不打印友好提示、不调用 process.exit
		expect(logs.join("\n")).not.toContain("请求失败");
	});

	it("非空目录确认清空：emptyDir 后重新解包（覆盖 prepare 清空分支）", async () => {
		scenario = "ok";
		logs.length = 0;
		const dir = join(workspaceRoot, "myapp");
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "occupier.txt"), "占位");
		confirmAnswers.push(true);
		await start();
		expect(existsSync(join(dir, "occupier.txt"))).toBe(false);
		expect(existsSync(join(dir, "index.js"))).toBe(true);
	});

	it("registry 探测纯函数（补本实例的行覆盖）", () => {
		const npmrc = join(workspaceRoot, ".npmrc");
		writeFileSync(npmrc, "registry=https://registry.example.com/\n");
		expect(readNpmrcRegistry(npmrc)).toBe("https://registry.example.com/");
		expect(
			readNpmrcRegistry(join(workspaceRoot, "absent.npmrc")),
		).toBeUndefined();
		expect(getLocalRegistry(workspaceRoot, workspaceRoot)).toBe(
			"https://registry.example.com/",
		);
		rmSync(npmrc, { force: true });
		expect(getLocalRegistry(workspaceRoot, workspaceRoot)).toBeUndefined();
		// 临时目录内容核对后由 afterAll 统一清理
		expect(readdirSync(workspaceRoot).length).toBeGreaterThan(0);
	});
});
