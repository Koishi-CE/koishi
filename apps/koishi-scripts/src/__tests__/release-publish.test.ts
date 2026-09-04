// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `koishi-scripts publish`（release/publish.ts）的主流程测试。
 *
 * mock 三层边界：cwd（重定向临时工作区）、run.ts（npm 子进程编程返回）、
 * globalThis.fetch（伪 registry 按用例分发 404 / 版本表 / 5xx 重试）；
 * discoverPackages / rewriteWorkspaceProtocol / topoSort 等纯逻辑走真实实现，
 * 因此可完整验证「registry 比对 → 所有权预检 → 拓扑序发布 → workspace:* 改写与恢复」。
 */

const workspaceRoot = mkdtempSync(
	join(tmpdir(), "koishi-publish-run-"),
);

mock.module("../index.ts", () => ({
	cwd: workspaceRoot,
	loadHostManifest: async () => null,
}));

/** runCommand 调用记录（附带调用瞬间的 package.json 快照，用于断言改写） */
interface RunCall {
	dir: string;
	cmd: string;
	args: readonly string[];
	manifest: Record<string, unknown>;
}

const runCalls: RunCall[] = [];
const captureCalls: string[] = [];
let runExitCode = 0;
/** 按包名指定退出码（优先于全局 runExitCode），用于「前包成功后包失败」的编排 */
const runExitCodes = new Map<string, number>();
const captureReplies = new Map<string, string | null>();

mock.module("../release/run.ts", () => ({
	runCommand: (
		dir: string,
		cmd: string,
		args: readonly string[],
	) => {
		const manifest = JSON.parse(
			readFileSync(join(dir, "package.json"), "utf8"),
		) as Record<string, unknown>;
		runCalls.push({ dir, cmd, args, manifest });
		return (
			runExitCodes.get(`${manifest["name"]}`) ?? runExitCode
		);
	},
	captureCommand: (
		_dir: string,
		cmd: string,
		args: readonly string[],
	): string | null => {
		const key = `${cmd} ${args.join(" ")}`;
		captureCalls.push(key);
		return captureReplies.get(key) ?? null;
	},
}));

const { default: runPublish } = await import(
	"../release/publish.ts"
);

// ---------------------------------------------------------------------------
// fetch 与定时器的可编程 mock（重试退避的 setTimeout 压缩到 1ms）
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const fetchedUrls: string[] = [];

let fetchImpl: (
	url: string,
) => Response | Promise<Response> = () =>
	new Response(null, { status: 404 });

// RequestInfo 在本工程 lib 环境非全局名，改从 fetch 签名取输入类型
globalThis.fetch = ((
	input: Parameters<typeof fetch>[0],
) => {
	const url = `${input}`;
	fetchedUrls.push(url);
	return Promise.resolve(fetchImpl(url));
}) as typeof fetch;

/** 将全局 setTimeout 的延时压到 1ms（透传其余行为），用完须 restoreTimers */
function capTimers(): void {
	globalThis.setTimeout = ((
		fn: (...args: unknown[]) => void,
		ms?: number,
		...rest: unknown[]
	) =>
		realSetTimeout(
			fn,
			Math.min(ms ?? 0, 1),
			...rest,
		)) as typeof setTimeout;
}

function restoreTimers(): void {
	globalThis.setTimeout = realSetTimeout;
}

/** 伪 registry 响应：版本表 → 200 JSON；无版本 → 404 */
function respondVersions(versions: string[]): Response {
	return new Response(
		JSON.stringify({
			versions: Object.fromEntries(
				versions.map((v) => [v, {}]),
			),
		}),
		{ status: 200 },
	);
}

const logs: string[] = [];
const originalLog = console.log;
// whoami 缺席等预期告警直通 stderr，捕获收敛避免刷屏（子进程均被 mock，无真实 stderr）
const stderrChunks: string[] = [];
const originalStderrWrite = process.stderr.write.bind(
	process.stderr,
);

beforeAll(() => {
	console.log = (...args: unknown[]) => {
		logs.push(args.map((arg) => `${arg}`).join(" "));
	};
	process.stderr.write = ((chunk: string | Uint8Array) => {
		stderrChunks.push(`${chunk}`);
		return true;
	}) as typeof process.stderr.write;
});

afterAll(() => {
	console.log = originalLog;
	process.stderr.write = originalStderrWrite;
	globalThis.fetch = realFetch;
	restoreTimers();
	rmSync(workspaceRoot, { recursive: true, force: true });
});

/** 在 external/ 下造一个可发现的包 */
function seedPackage(
	dirName: string,
	name: string,
	version: string,
	dependencies: Record<string, string> = {},
): string {
	const dir = join(workspaceRoot, "external", dirName);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name, version, dependencies }),
	);
	return dir;
}

function readPkg(dir: string): Record<string, unknown> {
	return JSON.parse(
		readFileSync(join(dir, "package.json"), "utf8"),
	) as Record<string, unknown>;
}

beforeEach(() => {
	runCalls.length = 0;
	captureCalls.length = 0;
	runExitCode = 0;
	runExitCodes.clear();
	captureReplies.clear();
	fetchedUrls.length = 0;
	logs.length = 0;
	fetchImpl = () => new Response(null, { status: 404 });
	rmSync(join(workspaceRoot, "external"), {
		recursive: true,
		force: true,
	});
	mkdirSync(join(workspaceRoot, "external"), {
		recursive: true,
	});
});

describe("runPublish", () => {
	it("未发现任何可发布包时返回 0", async () => {
		mkdirSync(
			join(workspaceRoot, "external", "no-manifest"),
			{
				recursive: true,
			},
		);
		expect(await runPublish([])).toBe(0);
		expect(logs.join("\n")).toContain("未发现任何可发布包");
	});

	it("首次发布：拓扑序逐包 publish，workspace:* 改写为真实版本且事后恢复", async () => {
		const dirA = seedPackage(
			"a",
			"koishi-plugin-a",
			"1.0.0",
			{
				"koishi-plugin-b": "workspace:*",
			},
		);
		seedPackage("b", "koishi-plugin-b", "1.1.0");
		// registry 全 404（首发免预检），whoami 可得
		captureReplies.set("npm whoami", "me");

		expect(await runPublish([])).toBe(0);
		// 被依赖者 b 在前
		expect(runCalls.map((c) => c.manifest["name"])).toEqual(
			["koishi-plugin-b", "koishi-plugin-a"],
		);
		for (const call of runCalls) {
			expect(call.cmd).toBe("npm");
			expect(call.args).toEqual([
				"publish",
				"--access",
				"public",
			]);
		}
		// 发布瞬间 a 的 workspace:* 已改写为 b 的真实版本
		const depsA = runCalls[1]?.manifest[
			"dependencies"
		] as Record<string, string>;
		expect(depsA["koishi-plugin-b"]).toBe("^1.1.0");
		// 结束后恢复原样（幂等兜底）
		expect(readPkg(dirA)["dependencies"]).toEqual({
			"koishi-plugin-b": "workspace:*",
		});
		expect(logs.join("\n")).toContain(
			"workspace:* → 真实版本",
		);
		expect(logs.join("\n")).toContain(
			"已恢复 koishi-plugin-a/package.json",
		);
	});

	it("版本已存在于 registry 的包被跳过", async () => {
		seedPackage("solo", "koishi-plugin-solo", "1.0.0");
		fetchImpl = () => respondVersions(["1.0.0"]);
		expect(await runPublish([])).toBe(0);
		expect(runCalls).toHaveLength(0);
		expect(logs.join("\n")).toContain(
			"版本 1.0.0 已在 registry",
		);
	});

	it("本地版本低于 registry 已发布版本时跳过并警告", async () => {
		seedPackage("solo", "koishi-plugin-solo", "0.5.0");
		fetchImpl = () => respondVersions(["1.0.0"]);
		expect(await runPublish([])).toBe(0);
		expect(runCalls).toHaveLength(0);
		expect(logs.join("\n")).toContain("本地源码落后");
	});

	it("所有权预检：非 owner 的包跳过，owner 匹配的照常发布", async () => {
		seedPackage("solo", "koishi-plugin-solo", "2.0.0");
		fetchImpl = () => respondVersions(["1.0.0"]);
		captureReplies.set("npm whoami", "me");
		captureReplies.set(
			"npm owner ls --json koishi-plugin-solo",
			'[{"name":"someone-else"}]',
		);
		expect(await runPublish([])).toBe(0);
		expect(runCalls).toHaveLength(0);
		expect(logs.join("\n")).toContain("疑似他人插件");

		// owner 匹配 → 正常发布
		captureReplies.set(
			"npm owner ls --json koishi-plugin-solo",
			'[{"name":"me"}]',
		);
		expect(await runPublish([])).toBe(0);
		expect(runCalls).toHaveLength(1);
	});

	it("owner ls 输出非法 JSON 或非数组时均视为空集（预检不过 → 跳过）", async () => {
		seedPackage("solo", "koishi-plugin-solo", "2.0.0");
		fetchImpl = () => respondVersions(["1.0.0"]);
		captureReplies.set("npm whoami", "me");
		captureReplies.set(
			"npm owner ls --json koishi-plugin-solo",
			"not-a-json",
		);
		expect(await runPublish([])).toBe(0);
		expect(runCalls).toHaveLength(0);
		expect(logs.join("\n")).toContain("owner: 未知");

		// 合法 JSON 但非数组（如对象形态）同样视为空集
		captureReplies.set(
			"npm owner ls --json koishi-plugin-solo",
			'{"name":"me"}',
		);
		await runPublish([]);
		expect(runCalls).toHaveLength(0);
	});

	it("whoami 不可得时跳过预检直接发布", async () => {
		seedPackage("solo", "koishi-plugin-solo", "1.0.0");
		// 不设置 npm whoami → captureCommand 返回 null
		expect(await runPublish([])).toBe(0);
		expect(runCalls).toHaveLength(1);
	});

	it("dry-run：携带 --dry-run 且不查询登录身份", async () => {
		seedPackage("solo", "koishi-plugin-solo", "1.0.0");
		expect(await runPublish(["--dry-run"])).toBe(0);
		expect(runCalls[0]?.args).toEqual([
			"publish",
			"--access",
			"public",
			"--dry-run",
		]);
		// dry-run 跳过所有权预检，不应发起 npm whoami 查询
		expect(captureCalls).not.toContain("npm whoami");
		expect(logs.join("\n")).toContain("dry-run");
	});

	it("registry 查询非 200 时退避重试，第三次成功后继续发布（scoped 名 URL 编码）", async () => {
		const dir = join(workspaceRoot, "external", "scoped");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				name: "@scope/koishi-plugin-x",
				version: "1.0.0",
			}),
		);
		let attempt = 0;
		fetchImpl = () => {
			attempt += 1;
			return attempt < 3
				? new Response(null, { status: 500 })
				: respondVersions(["0.9.0"]);
		};
		capTimers();
		try {
			expect(await runPublish([])).toBe(0);
		} finally {
			restoreTimers();
		}
		expect(attempt).toBe(3);
		// scoped 包名的 / 被编码为 %2F
		expect(
			fetchedUrls.some((url) => url.includes("%2F")),
		).toBe(true);
		expect(runCalls).toHaveLength(1);
	});

	it("registry 查询连续失败三次后抛错", async () => {
		seedPackage("solo", "koishi-plugin-solo", "1.0.0");
		fetchImpl = () => new Response(null, { status: 500 });
		capTimers();
		try {
			await expect(runPublish([])).rejects.toThrow(
				"重试 3 次",
			);
		} finally {
			restoreTimers();
		}
	});

	it("发布失败即中断并透传退出码，manifest 仍被恢复", async () => {
		const dirA = seedPackage(
			"a",
			"koishi-plugin-a",
			"1.0.0",
			{
				"koishi-plugin-b": "workspace:*",
			},
		);
		seedPackage("b", "koishi-plugin-b", "1.1.0");
		// b（首个发布）成功，a（依赖方）失败 → 中断
		runExitCodes.set("koishi-plugin-a", 4);

		expect(await runPublish([])).toBe(4);
		expect(runCalls.map((c) => c.manifest["name"])).toEqual(
			["koishi-plugin-b", "koishi-plugin-a"],
		);
		// a 发布失败后 finally 恢复了 workspace:* 原样
		expect(readPkg(dirA)["dependencies"]).toEqual({
			"koishi-plugin-b": "workspace:*",
		});
		expect(logs.join("\n")).toContain("已中断");
		expect(logs.join("\n")).toContain(
			"已恢复 koishi-plugin-a/package.json",
		);
	});
});
