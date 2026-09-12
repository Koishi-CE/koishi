// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { expect, it, mock } from "bun:test";
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import memory from "@koishi-ce/plugin-database-memory";

/**
 * market 插件测试：
 * - 子进程（bun 安装）经 mock.module 拦截 installer/proc.ts（spawnBun 封装），不落盘不联网安装；
 * - registry 网络请求由进程内 Bun.serve 提供（registry 协议的最小 JSON）；
 * - 宿主环境（loader / cwd）使用 FakeLoader 与临时目录 + chdir，
 *   Installer 的 override 写盘只会作用于临时 package.json。
 */

/** 已发生的子进程调用（参数列表）。 */
export const spawnCalls: string[][] = [];
/** 控制下一次子进程的退出码与触发事件。 */
let nextExitCode = 0;
let nextSpawnError = false;

/** let 绑定无法跨模块直接赋值，用例经以下 setter 控制子进程桩。 */
export function setNextExitCode(code: number) {
	nextExitCode = code;
}

export function setNextSpawnError(flag: boolean) {
	nextSpawnError = flag;
}

const spawnBunMock = (_args: string[], _cwd: string) => {
	spawnCalls.push(_args);
	return {
		on(event: string, cb: (code?: number) => void) {
			if (nextSpawnError) {
				if (event === "error") setImmediate(() => cb());
			} else if (event === "exit") {
				setImmediate(() => cb(nextExitCode));
			}
			return this;
		},
		stderr: {
			on(event: string, cb: (data: Buffer) => void) {
				// 同步派发：异步派发会晚于用例的日志静默窗口，导致转发告警漏出刷屏
				if (event === "data")
					cb(Buffer.from("stderr line\n"));
				return this;
			},
		},
		stdout: {
			on(event: string, cb: (data: Buffer) => void) {
				if (event === "data")
					cb(Buffer.from("stdout line\n"));
				return this;
			},
		},
	};
};

// 注册须先于下方动态 import 被测模块；bun test --isolate 下各测试文件
// 独立实例化本模块，mock 随之按文件各自生效
mock.module("../node/installer/proc.ts", () => ({
	spawnBun: spawnBunMock,
}));

import type { Entry } from "@koishi-ce/console";
// 均为 type-only 导入：编译期擦除，不干扰 mock.module 先于插件加载的时序
import type { Plugin } from "@koishi-ce/koishi";

const { Console } = await import("@koishi-ce/console");
const { App, Logger, Service } = await import(
	"@koishi-ce/koishi"
);
const http = (await import("@koishi-ce/plugin-http"))
	.default;
const market = await import("../node/index.ts");
const mockPlugin = (await import("@koishi-ce/plugin-mock"))
	.default;
// 加载包入口占位文件（纯 re-export，无独立逻辑），保证 src 全量被加载
await import("../index.ts");

// 供各主题测试文件复用的共享构建块（App / http / Logger / market / memory）
export { App, http, Logger, market, memory };

/** 控制台服务桩：仅实现入口登记所需的最小面。 */
export class FakeConsole extends Console {
	protected resolveEntry(
		_files: Entry.Files,
		_key: string,
	): string[] {
		return [];
	}
}

/** loader 服务桩（immediate Service）：writable 可写、envData 供重启消息断言。 */
export class FakeLoader extends Service {
	writable = true;
	envData: Record<string, unknown> = { message: null };
	paths() {
		return ["group:entry", "plugins"];
	}
	fullReload() {}
	constructor(
		ctx: ConstructorParameters<typeof Service>[0],
	) {
		super(ctx, "loader", true);
	}
}

/** registry 协议最小 JSON 服务（Bun.serve，随机端口）。 */
export const registryData: {
	[key: string]: {
		versions: Record<
			string,
			{
				version: string;
				peerDependencies?: Record<string, string>;
				deprecated?: boolean;
			}
		>;
		time?: Record<string, string>;
	};
} = {};

/** 搜索接口响应（/-/v1/search，collect 阶段消费）。初始给空结果，避免启动期空转 404。 */
let searchResponse: {
	objects: unknown[];
	total: number;
} | null = {
	objects: [],
	total: 0,
};

/** 用例经本 setter 切换搜索接口响应（let 绑定无法跨模块直接赋值）。 */
export function setSearchResponse(
	value: typeof searchResponse,
) {
	searchResponse = value;
}

/** flaky-index 镜像索引桩：已发生的请求计数与计划内的 404 次数。 */
export let flakyIndexHits = 0;
let flakyIndexMisses = 0;
/** slow-index 慢响应桩：已发生的请求计数。 */
export let slowIndexHits = 0;

/** 计数导出为 live binding 供用例断言读取；写回仍须经以下 setter
 *  （let 绑定无法跨模块直接赋值）。 */
export function setFlakyIndexHits(hits: number) {
	flakyIndexHits = hits;
}

export function setFlakyIndexMisses(misses: number) {
	flakyIndexMisses = misses;
}

export function setSlowIndexHits(hits: number) {
	slowIndexHits = hits;
}

/** 声明预期触发 market 域告警（404 / 限流等桩失败路径）的用例：执行期间静默该域。 */
export const itQuiet = (
	name: string,
	fn: () => Promise<void> | void,
	timeout?: number,
) =>
	it(
		name,
		async () => {
			const levels = Logger.levels as Record<
				string,
				number
			>;
			levels["market"] = 0;
			try {
				await fn();
			} finally {
				delete levels["market"];
			}
		},
		timeout,
	);

export const registryServer = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/-/v1/search")) {
			if (!searchResponse) {
				return new Response("not found", { status: 404 });
			}
			return Response.json(searchResponse);
		}
		// 模拟镜像索引的部署窗口：前 flakyIndexMisses 次 404，随后返回完整索引
		if (url.pathname === "/flaky-index") {
			if (flakyIndexHits++ < flakyIndexMisses) {
				return new Response("not found", { status: 404 });
			}
			return Response.json({
				version: "4",
				objects: [
					{
						package: {
							name: "koishi-plugin-demo",
							version: "2.0.0",
							date: "2024-06-01T00:00:00Z",
							keywords: ["koishi", "plugin"],
						},
					},
				],
			});
		}
		// 模拟镜像索引挂起：延迟超过用例配置的 timeout，驱动超时重试路径
		if (url.pathname === "/slow-index") {
			slowIndexHits++;
			await new Promise((resolve) =>
				setTimeout(resolve, 300),
			);
			return Response.json({ version: "4", objects: [] });
		}
		// 模拟 registry 限流：恒定 429 + 极短的 Retry-After，驱动重试后失败
		if (
			url.pathname.includes("koishi-plugin-ratelimited")
		) {
			return new Response("rate limited", {
				status: 429,
				headers: { "Retry-After": "0.01" },
			});
		}
		const name = decodeURIComponent(url.pathname.slice(1));
		const data = registryData[name];
		if (!data) {
			return new Response("not found", { status: 404 });
		}
		return Response.json(data);
	},
});

// 预置一个兼容插件包：最新版 2.0.0，旧版 1.0.0 均声明 koishi ^4 peer
registryData["koishi-plugin-demo"] = {
	versions: {
		"1.0.0": {
			version: "1.0.0",
			peerDependencies: { koishi: "^4.17.0" },
		},
		"2.0.0": {
			version: "2.0.0",
			peerDependencies: { koishi: "^4.17.0" },
		},
	},
	time: {
		"1.0.0": "2024-01-01T00:00:00Z",
		"2.0.0": "2024-06-01T00:00:00Z",
	},
};
// 预置一个未安装的插件包（plugin.install 安装路径使用）
registryData["koishi-plugin-newpkg"] = {
	versions: {
		"1.0.0": {
			version: "1.0.0",
			peerDependencies: { koishi: "^4.17.0" },
		},
	},
	time: { "1.0.0": "2024-01-01T00:00:00Z" },
};
// 预置初始清单里三个非插件依赖的远端条目：Installer.refresh() 每轮都会对全部
// 清单依赖发起 registry 查询，缺桩会让每个用例都刷 404 告警
registryData["koishi"] = {
	versions: { "4.18.0": { version: "4.18.0" } },
	time: { "4.18.0": "2024-01-01T00:00:00Z" },
};
registryData["market-alias"] = {
	versions: { "1.0.0": { version: "1.0.0" } },
	time: { "1.0.0": "2024-01-01T00:00:00Z" },
};
registryData["bad-range"] = {
	versions: { "1.0.0": { version: "1.0.0" } },
	time: { "1.0.0": "2024-01-01T00:00:00Z" },
};

/** 临时宿主目录（Installer 的 cwd 与 override 写盘目标）。 */
const initialDependencies = {
	// 护栏：workspace 声明不可被覆盖或删除
	koishi: "workspace:*",
	// 护栏：npm:@koishi-ce alias 同样受保护
	"market-alias": "npm:@koishi-ce/anything@^1.0.0",
	// 普通依赖：可解析远端最新版
	"koishi-plugin-demo": "^1.0.0",
	// 非法 semver 区间：应标记 invalid
	"bad-range": "not-a-version",
};
export const tmp = mkdtempSync(
	join(tmpdir(), "market-test-"),
);
const originalCwd = process.cwd();
writeFileSync(
	join(tmp, "package.json"),
	JSON.stringify(
		{
			name: "market-host",
			dependencies: initialDependencies,
		},
		null,
		"\t",
	),
);
process.chdir(tmp);

// App 经动态 import 取值为 const，实例类型由构造器派生供 Plugin.Constructor 泛型使用
export type TestApp = InstanceType<typeof App>;

export const app = new App();

app.plugin(memory);
app.plugin(http);
// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
app.plugin(
	FakeConsole as unknown as Plugin.Constructor<TestApp>,
);
app.plugin(FakeLoader);
app.plugin(market, {
	registry: {
		endpoint: `http://127.0.0.1:${registryServer.port}/`,
	},
});
app.plugin(mockPlugin);

export const client = app.mock.client("123");

/** 各主题测试文件的 beforeAll 钩子体：启动宿主并触发延迟服务实例化。 */
export async function startApp() {
	await app.start();
	await app.mock.initUser("123", 4);
	// 触发 installer 等延迟服务的实例化
	expect(app.installer).toBeDefined();
}

/** 各主题测试文件的 afterAll 钩子体：停机、还原 cwd、清理临时目录与 registry 桩。 */
export async function stopApp() {
	await app.stop();
	process.chdir(originalCwd);
	rmSync(tmp, { recursive: true, force: true });
	registryServer.stop(true);
}
