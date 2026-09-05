// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
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
import { basename, join } from "node:path";

/**
 * start() 默认（内置模板）主流程的端到端测试。
 *
 * 手段：把 process.argv 指为无位置参数 + --git，chdir 到临时目录后动态
 * 导入被测模块（其内部 cwd / argv 在模块顶层固化）；@clack/prompts 与
 * node:child_process 均 mock，分别提供可编程的问询答案与子进程记录，
 * process.exit 替换为可捕获的异常，从而覆盖全部交互分支。
 */

const workspaceRoot = mkdtempSync(
	join(tmpdir(), "ckc-run-default-"),
);
const previousCwd = process.cwd();
const previousArgv = process.argv.slice();
const previousExit = process.exit;
// 保持无 user-agent 的探测环境（detectAgent 走 bun 分支）
const userAgentKey = "npm_config_user_agent";
const hadUserAgent = userAgentKey in Bun.env;
const previousUserAgent = Bun.env[userAgentKey];
delete Bun.env[userAgentKey];

/** @clack/prompts 的可编程答案队列（按 prompt 类型分发） */
const nameAnswers: string[] = [];
const confirmAnswers: boolean[] = [];

mock.module("@clack/prompts", () => ({
	text: async () => nameAnswers.shift() ?? "",
	confirm: async () => confirmAnswers.shift() ?? false,
	isCancel: (value: unknown) => typeof value === "symbol",
	cancel: () => {},
}));

/** spawnSync 的调用记录与可编程行为 */
const spawnLog: Array<{
	cmd: string;
	args: string[];
	cwd?: string;
}> = [];
let installExit = 0;

// 本文件求值时 Bun.spawnSync 恒为真实实现（本仓测试中唯一的子进程 mock
// 注册点），持有真实引用供未知命令透传；mock 改写会波及其它测试文件经
// 全局命名空间发起的调用（如 setup 的 git init、release 的子进程测试），
// 透传保证它们拿到真实行为
const realSpawnSync = Bun.spawnSync;

/** 构造 SyncSubprocess 形态的假结果（补全 resourceUsage / pid 等必要字段） */
function fakeResult(exitCode: number, stdout = "") {
	return {
		exitCode,
		success: exitCode === 0,
		stdout,
		stderr: "",
	} as unknown as ReturnType<typeof Bun.spawnSync>;
}

/** Bun.spawnSync 调用选项中被本 mock 关心的子集（透传时原样保留） */
interface SpawnOptionsLike {
	cmd?: readonly string[];
	cwd?: string;
	stdout?: "ignore" | "inherit" | "pipe";
	stderr?: "ignore" | "inherit" | "pipe";
}

/**
 * 把 Bun.spawnSync 的两种调用形态归一为 { cmd, args, cwd, passthrough }。
 * invoke 为 unknown 数组（重载联合无法静态表达），内部运行时收窄。
 */
function normalize(invoke: readonly unknown[]): {
	cmd: string;
	args: string[];
	cwd?: string;
	passthrough: () => ReturnType<typeof Bun.spawnSync>;
} {
	const first = invoke[0];
	const options = (
		Array.isArray(first) ? (invoke[1] ?? {}) : first
	) as SpawnOptionsLike;
	const argv = (
		Array.isArray(first) ? first : (options.cmd ?? [])
	) as readonly string[];
	const cmd = argv[0] ?? "";
	const args = [...argv.slice(1)];
	return {
		cmd,
		args,
		...(options.cwd === undefined
			? {}
			: { cwd: options.cwd }),
		passthrough: () =>
			realSpawnSync({
				cmd: [cmd, ...args],
				...(options.stdout === undefined
					? {}
					: { stdout: options.stdout }),
				...(options.stderr === undefined
					? {}
					: { stderr: options.stderr }),
				...(options.cwd === undefined
					? {}
					: { cwd: options.cwd }),
			}),
	};
}

/** 拦截 Bun.spawnSync：git 探测 / 配置读取走桩，其余记录或透传真实执行 */
spyOn(Bun, "spawnSync").mockImplementation(((
	...invoke: readonly unknown[]
) => {
	const { cmd, args, cwd, passthrough } = normalize(invoke);
	if (cmd === "git" && args[0] === "--version")
		return fakeResult(0);
	if (
		cmd === "git" &&
		args[0] === "config" &&
		args[1] === "--get"
	) {
		const key = args[2];
		const table: Record<string, string> = {
			"user.name": "Tester",
			"user.email": "t@e.st",
			"init.defaultBranch": "trunk",
		};
		const value =
			key !== undefined ? table[key] : undefined;
		return fakeResult(
			value === undefined ? 1 : 0,
			value === undefined ? "" : `${value}\n`,
		);
	}
	// exactOptionalPropertyTypes：cwd 未传时不落键，避免显式写入 undefined
	spawnLog.push({
		cmd,
		args,
		...(cwd === undefined ? {} : { cwd }),
	});
	// 依赖安装可编程；agent 启动不真实拉起
	if (args[0] === "install") return fakeResult(installExit);
	if (cmd === "bun" && args[0] === "run")
		return fakeResult(0);
	// 其余命令透传真实执行（副作用均在各自测试的临时目录内）
	return passthrough();
}) as never);

/** process.exit 替换为异常，供断言「直接退出」的分支 */
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
	"--git",
];
process.chdir(workspaceRoot);
// query 强制独立实例（说明与写法见 run-help.test.ts）
const specifier = "../index.ts?default-run";
const { start, getLocalRegistry, readNpmrcRegistry } =
	(await import(specifier)) as typeof import("../index.ts");
// cwd 已在被测模块内固化，立即切回，缩小对进程全局的影响窗口
process.chdir(previousCwd);

const logs: string[] = [];
const originalLog = console.log;

beforeAll(() => {
	console.log = (...args: unknown[]) => {
		logs.push(args.map((arg) => `${arg}`).join(" "));
	};
});

afterAll(() => {
	console.log = originalLog;
	process.exit = previousExit;
	process.argv = previousArgv;
	if (hadUserAgent) {
		Bun.env[userAgentKey] = previousUserAgent;
	} else {
		delete Bun.env[userAgentKey];
	}
	rmSync(workspaceRoot, { recursive: true, force: true });
});

/** 断言内置模板的静态文件齐备 */
function expectTemplateFiles(dir: string): void {
	for (const file of [
		"package.json",
		"koishi.yml",
		"tsconfig.json",
		".env",
		".gitignore",
		"README.md",
	]) {
		expect(existsSync(join(dir, file)), file).toBe(true);
	}
	const manifest = JSON.parse(
		readFileSync(join(dir, "package.json"), "utf8"),
	) as Record<string, unknown>;
	expect(manifest["private"]).toBe(true);
	expect(manifest["version"]).toBe("0.0.0");
	expect(manifest["workspaces"]).toEqual([
		"plugins/*",
		"external/*",
	]);
}

describe("create-koishi-ce 默认模板主流程", () => {
	// 补齐本实例下纯函数分支的行覆盖（registry 既有测试走的是共享实例）
	it("registry 探测纯函数在本实例同样可用", () => {
		const npmrc = join(workspaceRoot, ".npmrc");
		writeFileSync(
			npmrc,
			"registry=https://registry.example.com/\n",
		);
		expect(readNpmrcRegistry(npmrc)).toBe(
			"https://registry.example.com/",
		);
		expect(
			readNpmrcRegistry(join(workspaceRoot, "absent")),
		).toBeUndefined();
		expect(
			getLocalRegistry(workspaceRoot, workspaceRoot),
		).toBe("https://registry.example.com/");
		expect(
			getLocalRegistry(workspaceRoot, workspaceRoot),
		).toBeDefined();
		rmSync(npmrc, { force: true });
	});

	it("项目名指向当前目录（rootDir === cwd）：直接在原地生成，不打印 cd 提示", async () => {
		// workspaceRoot 此刻为空目录：prepare 直接通过，无需清空确认
		nameAnswers.push(".");
		confirmAnswers.push(false);
		await start();
		expectTemplateFiles(workspaceRoot);
		expect(
			(
				JSON.parse(
					readFileSync(
						join(workspaceRoot, "package.json"),
						"utf8",
					),
				) as Record<string, unknown>
			)["name"],
		).toBe(basename(workspaceRoot));
		// rootDir 与 cwd 相同 → 稍后启动提示里没有 cd 行
		expect(logs.join("\n")).not.toContain("cd ");
		logs.length = 0;
	});

	it("常规新目录：内置模板 + git init（分支名取 init.defaultBranch）+ 安装并启动", async () => {
		nameAnswers.push("app-a");
		confirmAnswers.push(true);
		installExit = 0;
		await start();
		expectTemplateFiles(join(workspaceRoot, "app-a"));
		expect(
			(
				JSON.parse(
					readFileSync(
						join(workspaceRoot, "app-a", "package.json"),
						"utf8",
					),
				) as Record<string, unknown>
			)["name"],
		).toBe("app-a");
		// git init 使用 git config 探测到的分支名
		expect(spawnLog).toContainEqual({
			cmd: "git",
			args: ["init", "-b", "trunk"],
			cwd: join(workspaceRoot, "app-a"),
		});
		// install 确认后：agent install → agent run start（bun-first 探测）
		expect(spawnLog).toContainEqual({
			cmd: "bun",
			args: ["install"],
			cwd: join(workspaceRoot, "app-a"),
		});
		expect(spawnLog).toContainEqual({
			cmd: "bun",
			args: ["run", "start"],
			cwd: join(workspaceRoot, "app-a"),
		});
		logs.length = 0;
	});

	it("目标目录非空且用户拒绝清空：直接退出且不改动现有文件", async () => {
		const dir = join(workspaceRoot, "app-b");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "occupier.txt"), "保留我");
		nameAnswers.push("app-b");
		confirmAnswers.push(false);
		await expect(start()).rejects.toThrow(
			"process.exit(0)",
		);
		expect(
			readFileSync(join(dir, "occupier.txt"), "utf8"),
		).toBe("保留我");
	});

	it("用户确认清空：emptyDir 后重建模板", async () => {
		const dir = join(workspaceRoot, "app-b");
		nameAnswers.push("app-b");
		confirmAnswers.push(true);
		await start();
		expect(existsSync(join(dir, "occupier.txt"))).toBe(
			false,
		);
		expectTemplateFiles(dir);
		logs.length = 0;
	});

	it("项目名问询被取消（空白输入）：直接退出", async () => {
		nameAnswers.push("   ");
		await expect(start()).rejects.toThrow(
			"process.exit(0)",
		);
	});

	it("依赖安装失败：提示后不再尝试启动", async () => {
		nameAnswers.push("app-f");
		confirmAnswers.push(true);
		installExit = 1;
		spawnLog.length = 0;
		await start();
		const commands = spawnLog.map(
			(call) => `${call.cmd} ${call.args.join(" ")}`,
		);
		expect(commands).toContain("bun install");
		expect(commands).not.toContain("bun run start");
		expect(logs.join("\n")).toContain("依赖安装失败");
		logs.length = 0;
	});

	it("拒绝立即安装：打印后续手动命令（含相对路径 cd 提示）", async () => {
		nameAnswers.push("sub/app-c");
		confirmAnswers.push(false);
		await start();
		const output = logs.join("\n");
		expect(output).toContain("cd");
		expect(output).toContain("bun install");
		expect(output).toContain("bun run start");
		expect(
			existsSync(
				join(workspaceRoot, "sub", "app-c", "koishi.yml"),
			),
		).toBe(true);
		expect(
			readdirSync(join(workspaceRoot, "sub", "app-c"))
				.length,
		).toBeGreaterThan(0);
	});
});
