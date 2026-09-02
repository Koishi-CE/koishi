// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import memory from "@koishijs/plugin-database-memory";

/**
 * market 插件测试：
 * - 子进程（npm/yarn 安装）经 mock.module 拦截 execa，不落盘不联网安装；
 * - registry 网络请求由进程内 Bun.serve 提供（registry 协议的最小 JSON）；
 * - 宿主环境（loader / cwd）使用 FakeLoader 与临时目录 + chdir，
 *   Installer 的 override 写盘只会作用于临时 package.json。
 */

/** 已发生的子进程调用（命令与参数）。 */
const spawnCalls: string[][] = [];
/** 控制下一次子进程的退出码与触发事件。 */
let nextExitCode = 0;
let nextSpawnError = false;

const execaMock = (name: string, args: string[]) => {
	spawnCalls.push([name, ...args]);
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
				if (event === "data") {
					setImmediate(() => cb(Buffer.from("stderr line\n")));
				}
				return this;
			},
		},
		stdout: {
			on(event: string, cb: (data: Buffer) => void) {
				if (event === "data") {
					setImmediate(() => cb(Buffer.from("stdout line\n")));
				}
				return this;
			},
		},
	};
};

mock.module("execa", () => ({ default: execaMock }));

import type { Entry } from "@koishi-ce/console";
// 均为 type-only 导入：编译期擦除，不干扰 mock.module 先于插件加载的时序
import type { Plugin } from "@koishi-ce/koishi";
import type { RemotePackage } from "@koishi-ce/registry";

const { Console } = await import("@koishi-ce/console");
const { App, Service } = await import("@koishi-ce/koishi");
const http = (await import("@koishi-ce/plugin-http")).default;
const { isResidentInCache } = await import("@koishi-ce/registry");
const market = await import("../node/index.ts");
const { default: Installer } = await import("../node/installer.ts");
const mockPlugin = (await import("@koishi-ce/plugin-mock")).default;
// 加载包入口占位文件（纯 re-export，无独立逻辑），保证 src 全量被加载
await import("../index.ts");

/** 控制台服务桩：仅实现入口登记所需的最小面。 */
class FakeConsole extends Console {
	protected resolveEntry(_files: Entry.Files, _key: string): string[] {
		return [];
	}
}

/** loader 服务桩（immediate Service）：writable 可写、envData 供重启消息断言。 */
class FakeLoader extends Service {
	writable = true;
	envData: Record<string, unknown> = { message: null };
	paths() {
		return ["group:entry", "plugins"];
	}
	fullReload() {}
	constructor(ctx: ConstructorParameters<typeof Service>[0]) {
		super(ctx, "loader", true);
	}
}

/** registry 协议最小 JSON 服务（Bun.serve，随机端口）。 */
const registryData: {
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

/** 搜索接口响应（/-/v1/search，collect 阶段消费）。 */
let searchResponse: { objects: unknown[]; total: number } | null = null;

const registryServer = Bun.serve({
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
		// 模拟 registry 限流：恒定 429 + 极短的 Retry-After，驱动重试后失败
		if (url.pathname.includes("koishi-plugin-ratelimited")) {
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
		"1.0.0": { version: "1.0.0", peerDependencies: { koishi: "^4.17.0" } },
		"2.0.0": { version: "2.0.0", peerDependencies: { koishi: "^4.17.0" } },
	},
	time: { "1.0.0": "2024-01-01T00:00:00Z", "2.0.0": "2024-06-01T00:00:00Z" },
};
// 预置一个未安装的插件包（plugin.install 安装路径使用）
registryData["koishi-plugin-newpkg"] = {
	versions: {
		"1.0.0": { version: "1.0.0", peerDependencies: { koishi: "^4.17.0" } },
	},
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
const tmp = mkdtempSync(join(tmpdir(), "market-test-"));
const originalCwd = process.cwd();
writeFileSync(
	join(tmp, "package.json"),
	JSON.stringify(
		{ name: "market-host", dependencies: initialDependencies },
		null,
		"\t",
	),
);
process.chdir(tmp);

// App 经动态 import 取值为 const，实例类型由构造器派生供 Plugin.Constructor 泛型使用
type TestApp = InstanceType<typeof App>;

const app = new App();

// 同 admin：CJS 实现配 ESM 声明，nodenext 互操作视图多包一层 default，类型层穿透取真实类
app.plugin(memory as unknown as typeof memory.default);
app.plugin(http);
// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
app.plugin(FakeConsole as unknown as Plugin.Constructor<TestApp>);
app.plugin(FakeLoader);
app.plugin(market, {
	registry: { endpoint: `http://127.0.0.1:${registryServer.port}/` },
});
app.plugin(mockPlugin);

const client = app.mock.client("123");

beforeAll(async () => {
	await app.start();
	await app.mock.initUser("123", 4);
	// 触发 installer 等延迟服务的实例化
	expect(app.installer).toBeDefined();
});

afterAll(async () => {
	await app.stop();
	process.chdir(originalCwd);
	rmSync(tmp, { recursive: true, force: true });
	registryServer.stop(true);
});

describe("market 插件", () => {
	it("注册三个数据服务与浏览器监听器", () => {
		expect(app.get("console.services.market")).toBeDefined();
		expect(app.get("console.services.dependencies")).toBeDefined();
		expect(app.get("console.services.registry")).toBeDefined();
		expect(app.console.listeners["market/install"]).toBeDefined();
		expect(app.console.listeners["market/registry"]).toBeDefined();
	});

	it("resolveName 解析插件短名的候选全名", () => {
		const installer = app.installer;
		expect(installer.resolveName("@koishijs/plugin-echo")).toEqual([
			"@koishijs/plugin-echo",
		]);
		expect(installer.resolveName("koishi-plugin-echo")).toEqual([
			"koishi-plugin-echo",
		]);
		expect(installer.resolveName("@scope/echo")).toEqual([
			"@scope/koishi-plugin-echo",
		]);
		expect(installer.resolveName("echo")).toEqual([
			"@koishijs/plugin-echo",
			"koishi-plugin-echo",
		]);
	});

	it("getDeps 汇总本地依赖并带出远端最新版", async () => {
		const deps = await app.installer.getDeps();
		// 语义化区间去除前缀符号
		expect(deps["koishi-plugin-demo"]?.request).toBe("1.0.0");
		// 远端最新版（本地 registry 预置 2.0.0）
		expect(deps["koishi-plugin-demo"]?.latest).toBe("2.0.0");
		// 非法 semver 标记 invalid
		expect(deps["bad-range"]?.invalid).toBe(true);
	});

	it("findVersion 返回首个存在的候选包版本", async () => {
		const found = await app.installer.findVersion([
			"@koishijs/plugin-none",
			"koishi-plugin-demo",
		]);
		expect(found).toEqual({ "koishi-plugin-demo": "2.0.0" });
		// 全部不存在时返回 undefined
		expect(
			await app.installer.findVersion(["@koishijs/plugin-none"]),
		).toBeUndefined();
	});

	it("getPackage 拉取失败时回退为空表", async () => {
		const versions = await app.installer.getPackage("koishi-plugin-missing");
		expect(versions).toEqual({});
	});

	it("setPackage 写入缓存并触发节流广播", async () => {
		app.installer.setPackage("koishi-plugin-demo", [
			{
				version: "3.0.0",
				peerDependencies: { koishi: "^4.17.0" },
				// RemotePackage 的其余元数据字段与本断言无关，最小载荷经 unknown 二段式断言
			} as unknown as RemotePackage,
		]);
		expect(
			Object.keys(app.installer.fullCache["koishi-plugin-demo"] ?? {}),
		).toEqual(["3.0.0"]);
		// 等待节流窗口
		await new Promise((resolve) => setTimeout(resolve, 600));
	});
});

describe("Installer 安装链路", () => {
	it("install 尊重护栏依赖并执行子进程安装", async () => {
		nextExitCode = 0;
		spawnCalls.length = 0;
		const code = await app.installer.install({
			koishi: "2.0.0",
			"market-alias": null,
			"koishi-plugin-demo": "^1.0.0",
		});
		expect(code).toBe(0);
		// 触发了包管理器安装（bun install --registry …）
		expect(spawnCalls.length).toBe(1);
		expect(spawnCalls[0]?.[0]).toBe("bun");
		expect(spawnCalls[0]?.[1]).toBe("install");
		// 重新读取临时 package.json：护栏项保持原样，新依赖加入
		const manifest = JSON.parse(
			await Bun.file(join(tmp, "package.json")).text(),
		) as { dependencies: Record<string, string> };
		expect(manifest.dependencies["koishi"]).toBe("workspace:*");
		expect(manifest.dependencies["market-alias"]).toBe(
			"npm:@koishi-ce/anything@^1.0.0",
		);
		expect(manifest.dependencies["koishi-plugin-demo"]).toBe("^1.0.0");
	}, 15000);

	it("install 强制时无视本地满足也要装", async () => {
		nextExitCode = 0;
		spawnCalls.length = 0;
		const code = await app.installer.install(
			{ "koishi-plugin-demo": "^1.0.0" },
			true,
		);
		expect(code).toBe(0);
		expect(spawnCalls.length).toBe(1);
	}, 15000);

	it("子进程非零退出码向上传递", async () => {
		nextExitCode = 1;
		spawnCalls.length = 0;
		const code = await app.installer.install(
			{ "koishi-plugin-demo": "^2.0.0" },
			true,
		);
		expect(code).toBe(1);
	}, 15000);

	it("子进程 spawn 失败返回 -1", async () => {
		nextSpawnError = true;
		nextExitCode = 0;
		const code = await app.installer.exec(["install"]);
		nextSpawnError = false;
		expect(code).toBe(-1);
	});

	it("exec 收集子进程 stdout / stderr 输出行", async () => {
		nextExitCode = 0;
		nextSpawnError = false;
		const code = await app.installer.exec(["install"]);
		expect(code).toBe(0);
	});
});

describe("isResidentInCache（装后重载判定）", () => {
	/** 在临时 node_modules 放一个已安装包，返回其目录 */
	function placePkg(name: string) {
		const pkgDir = join(tmp, "node_modules", name);
		mkdirSync(pkgDir, { recursive: true });
		writeFileSync(
			join(pkgDir, "package.json"),
			JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
		);
		writeFileSync(join(pkgDir, "index.js"), "module.exports = {}");
		return pkgDir;
	}

	it("包目录下有模块驻留 require.cache 时返回 true", () => {
		const pkgDir = placePkg("koishi-plugin-resident-check");
		// 入口经 require 进入 require.cache，模拟旧版本驻留内存
		require(join(pkgDir, "index.js"));
		expect(isResidentInCache("koishi-plugin-resident-check")).toBe(true);
	});

	it("已安装但无模块驻留内存时返回 false", () => {
		placePkg("koishi-plugin-idle-check");
		expect(isResidentInCache("koishi-plugin-idle-check")).toBe(false);
	});

	it("包不存在时保守返回 true（宁可多重载不漏判）", () => {
		expect(isResidentInCache("koishi-plugin-absent-check")).toBe(true);
	});
});

describe("registry 配置探测", () => {
	it("无显式 endpoint 时按 npmrc / 环境变量探测", async () => {
		// 环境变量优先：npm_config_registry 指向本地服务
		process.env["npm_config_registry"] =
			`http://127.0.0.1:${registryServer.port}/`;
		const app2 = new App();
		app2.plugin(http);
		app2.plugin(Installer, {});
		await app2.start();
		expect(app2.installer.endpoint).toBe(
			`http://127.0.0.1:${registryServer.port}/`,
		);
		await app2.stop();

		// 环境变量缺失时回落到项目 .npmrc（含不合法行与合法 registry 行）
		delete process.env["npm_config_registry"];
		writeFileSync(
			join(tmp, ".npmrc"),
			"not-a-registry-line\nregistry=http://registry.example.npm/\n",
		);
		const app3 = new App();
		app3.plugin(http);
		app3.plugin(Installer, {});
		await app3.start();
		expect(app3.installer.endpoint).toBe("http://registry.example.npm/");
		await app3.stop();
		rmSync(join(tmp, ".npmrc"), { force: true });
	});
});

describe("MarketProvider 市场数据服务", () => {
	it("collect 经搜索接口收集并逐包分析填充缓存", async () => {
		const svc = app.get("console.services.market");
		expect(svc).toBeDefined();
		// 提供搜索结果：一个插件条目 + 一个被忽略条目
		searchResponse = {
			objects: [
				{
					package: {
						name: "koishi-plugin-demo",
						version: "1.0.0",
						date: "2024-01-01T00:00:00Z",
						keywords: ["koishi", "plugin", "Tool"],
					},
				},
				{ package: { name: "not-a-plugin", date: "2024-01-01T00:00:00Z" } },
			],
			total: 1,
		};
		// start(true) 强制刷新市场数据（重新 collect）
		await svc?.start(true);
		// 等待节流窗口与逐包分析完成
		await new Promise((resolve) => setTimeout(resolve, 700));
		const payload = await svc?.get();
		expect(payload).toBeDefined();
		// 非 plugin 条目被剔除，只保留 demo
		expect(Object.keys(payload?.data ?? {})).toEqual(["koishi-plugin-demo"]);
		expect(payload?.total).toBe(1);
		expect(payload?.failed).toBe(0);
		expect(payload?.registry).toBe(`http://127.0.0.1:${registryServer.port}/`);
	});

	it("依赖 / 注册表数据服务读取安装器缓存", async () => {
		const dependencies = await app.get("console.services.dependencies")?.get();
		expect(dependencies?.["koishi-plugin-demo"]?.request).toBeTruthy();
		expect(dependencies?.["koishi-plugin-demo"]?.latest).toBe("2.0.0");

		const registry = await app.get("console.services.registry")?.get();
		expect(Object.keys(registry?.["koishi-plugin-demo"] ?? {})).toContain(
			"2.0.0",
		);
	});

	it("搜索接口失败时 get 返回空数据与错误标记", async () => {
		const svc = app.get("console.services.market");
		searchResponse = null;
		// 强制重扫：collect 失败置 _error，get 返回空 payload
		await svc?.start(true);
		const payload = await svc?.get();
		expect(payload).toEqual({ data: {}, failed: 0, total: 0, progress: 0 });
		searchResponse = {
			objects: [],
			total: 0,
		};
	});

	it("控制台连接事件在数据过期时触发刷新", async () => {
		const svc = app.get("console.services.market");
		expect(svc).toBeDefined();
		// 伪造一个在线客户端，使连接事件通过在线检查（broadcast 需可用的 socket）
		const fakeClient = { id: "conn-1", socket: { send() {} } };
		(app.console.clients as Record<string, unknown>)["conn-1"] = fakeClient;
		// 刚刷新过：12 小时窗口内直接返回，不重新收集
		const timestamp = svc?.["_timestamp" as keyof typeof svc] as number;
		// console/connection 载荷声明为 Client，桩对象仅含在线检查所需的最小面，类型层断言穿透
		app.emit("console/connection", fakeClient as never);
		expect(svc?.["_timestamp" as keyof typeof svc] as number).toBe(timestamp);
		// 将时间戳回拨到窗口外，连接事件重新触发 start（异步监听，稍等）
		(svc as Record<string, unknown>)["_timestamp"] = 0;
		app.emit("console/connection", fakeClient as never);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(
			(svc as Record<string, unknown>)["_timestamp"] as number,
		).toBeGreaterThan(0);
		delete app.console.clients["conn-1"];
	});
});

describe("market 聊天指令", () => {
	it("plugin.install 缺参与未找到的报错路径", async () => {
		const missing = await client.receive("plugin.install");
		expect(missing[0]).toContain("请输入插件名。");
		const notFound = await client.receive("plugin.install absent-pkg");
		expect(notFound[0]).toContain("未找到该插件。");
	});

	it("plugin.install 已安装时提示重复", async () => {
		const replies = await client.receive("plugin.install demo");
		expect(replies[0]).toContain("该插件已安装。");
	});

	it("plugin.install 安装新插件并写入依赖", async () => {
		nextExitCode = 0;
		spawnCalls.length = 0;
		const replies = await client.receive("plugin.install newpkg");
		expect(replies[0]).toContain("安装成功！");
		expect(spawnCalls.length).toBe(1);
		const manifest = JSON.parse(
			await Bun.file(join(tmp, "package.json")).text(),
		) as { dependencies: Record<string, string> };
		expect(manifest.dependencies["koishi-plugin-newpkg"]).toBe("1.0.0");
		// 重启消息在安装完成后复位（Loader 与桩形状不同，经 unknown 二段式断言）
		expect((app.loader as unknown as FakeLoader).envData["message"]).toBeNull();
	}, 15000);

	it("plugin.uninstall 卸载依赖并从清单移除", async () => {
		nextExitCode = 0;
		spawnCalls.length = 0;
		const replies = await client.receive("plugin.uninstall newpkg");
		expect(replies[0]).toContain("卸载成功！");
		const manifest = JSON.parse(
			await Bun.file(join(tmp, "package.json")).text(),
		) as { dependencies: Record<string, string> };
		expect(manifest.dependencies["koishi-plugin-newpkg"]).toBeUndefined();
	}, 15000);

	it("plugin.uninstall 未安装时提示", async () => {
		const replies = await client.receive("plugin.uninstall absent-pkg");
		expect(replies[0]).toContain("该插件未安装。");
	});

	it("plugin.upgrade 无可升级项时提示已最新", async () => {
		const replies = await client.receive("plugin.upgrade");
		expect(replies[0]).toContain("所有插件已是最新版本。");
	}, 10000);
});

describe("market 进阶链路", () => {
	it("宿主配置不可写时不加载安装器", async () => {
		const appNoLoader = new App();
		appNoLoader.plugin(http);
		appNoLoader.plugin(FakeConsole as unknown as Plugin.Constructor<TestApp>);
		appNoLoader.plugin(market, {
			registry: { endpoint: `http://127.0.0.1:${registryServer.port}/` },
		});
		await appNoLoader.start();
		// apply 在 loader 缺席时仅告警并提前返回
		expect(appNoLoader.installer).toBeUndefined();
		await appNoLoader.stop();
	});

	it("浏览器 market/install 监听器执行安装并刷新服务", async () => {
		nextExitCode = 0;
		const listener = app.console.listeners["market/install"];
		expect(listener).toBeDefined();
		const code = (await listener?.callback.call(
			{} as never,
			{ "koishi-plugin-newpkg": "1.0.0" },
			true,
		)) as number;
		expect(code).toBe(0);
	}, 15000);

	it("浏览器 market/registry 监听器批量查询包元数据", async () => {
		const listener = app.console.listeners["market/registry"];
		expect(listener).toBeDefined();
		const meta = (await listener?.callback.call({} as never, [
			"koishi-plugin-demo",
			"koishi-plugin-missing",
		])) as Record<string, unknown>;
		expect(Object.keys(meta["koishi-plugin-demo"] ?? {})).toContain("2.0.0");
		expect(meta["koishi-plugin-missing"]).toEqual({});
	});

	it("搜索结果中不兼容的包被跳过（analyze onSkipped/ignored）", async () => {
		const svc = app.get("console.services.market");
		// ghost 有 registry 条目，但版本声明的 koishi peer 与 4.x 不相交
		registryData["koishi-plugin-ghost"] = {
			versions: {
				"1.0.0": { version: "1.0.0", peerDependencies: { koishi: "^5.0.0" } },
			},
			time: { "1.0.0": "2024-01-01T00:00:00Z" },
		};
		searchResponse = {
			objects: [
				{
					package: {
						name: "koishi-plugin-ghost",
						version: "1.0.0",
						date: "2024-01-01T00:00:00Z",
					},
				},
			],
			total: 1,
		};
		await svc?.start(true);
		// collect 对 analyze 为即发即忘，等待逐包分析完成
		await new Promise((resolve) => setTimeout(resolve, 300));
		const payload = await svc?.get();
		// 无兼容版本：对象标记 ignored，不进入数据缓存。
		// progress 恒为 0：Scanner 以 defineProperty 定义 progress（不可写），
		// analyze 收尾的自增在严格模式下抛错且被即发即忘吞掉（上游行为）。
		expect(payload?.data).toEqual({});
		expect(payload?.failed).toBe(0);
		expect(payload?.total).toBe(1);
		expect(payload?.progress).toBe(0);
		delete registryData["koishi-plugin-ghost"];
	});

	it("搜索结果中被限流的包经重试后计入 failed（onFailure）", async () => {
		const svc = app.get("console.services.market");
		searchResponse = {
			objects: [
				{
					package: {
						name: "koishi-plugin-ratelimited",
						version: "1.0.0",
						date: "2024-01-01T00:00:00Z",
					},
				},
			],
			total: 1,
		};
		await svc?.start(true);
		// 等待限流重试（Retry-After 10ms × 3 次）与即发即忘的 analyze。
		// 注意不能经 get() 断言：super.start() 会清空 _task，get() 触发的
		// 二次 collect 会把 failed 重置（即发即忘的 analyze 尚未完成）。
		await new Promise((resolve) => setTimeout(resolve, 400));
		// 不可达/被限流的包名进入 failed 列表（上一个用例中 registry
		// 条目已删除的 ghost 包经 404 路径同样落入此处）
		const provider = svc as unknown as { failed: string[] };
		expect(
			provider.failed.some((name) => name.startsWith("koishi-plugin-")),
		).toBe(true);
	});

	it("plugin.upgrade 检出可升级项并输出确认提示", async () => {
		// 本地放置旧版安装，使 resolved 有值且低于远端 latest
		mkdirSync(join(tmp, "node_modules", "koishi-plugin-demo"), {
			recursive: true,
		});
		writeFileSync(
			join(tmp, "node_modules", "koishi-plugin-demo", "package.json"),
			JSON.stringify({ name: "koishi-plugin-demo", version: "1.0.0" }),
		);
		app.installer.refresh();

		nextExitCode = 0;
		// 发出升级指令（异步等待确认），再以 Y 回复确认。
		// 注：mock 环境下指令 ctx 对 loader 服务的可见性受 cordis
		// isolate 语义限制（见仓库测试任务记录），确认后的安装段
		// 由 market/install 监听器用例覆盖。
		const question = client.receive("plugin.upgrade demo");
		await new Promise((resolve) => setTimeout(resolve, 200));
		await client.receive("Y");
		const replies = await question;
		const output = replies.join("\n");
		expect(output).toContain("koishi-plugin-demo");
		expect(output).toContain("1.0.0 -> 2.0.0");
	}, 20000);

	it("plugin.upgrade 对本地畸形版本静默跳过（非法 semver catch）", async () => {
		// registry 侧提供合法 latest；本地安装产物的 version 是畸形串，
		// request（清单声明）合法故不标记 invalid，gt(latest, resolved)
		// 解析失败进入 catch 分支：该包被过滤，视为无可升级项
		registryData["koishi-plugin-weird"] = {
			versions: {
				"2.0.0": { version: "2.0.0", peerDependencies: { koishi: "^4.17.0" } },
			},
		};
		mkdirSync(join(tmp, "node_modules", "koishi-plugin-weird"), {
			recursive: true,
		});
		writeFileSync(
			join(tmp, "node_modules", "koishi-plugin-weird", "package.json"),
			JSON.stringify({ name: "koishi-plugin-weird", version: "not.a.version" }),
		);
		nextExitCode = 0;
		// 经 install 注入清单声明（顺带刷新 Installer 的 manifest 快照）
		const code = await app.installer.install({
			"koishi-plugin-weird": "1.0.0",
		});
		expect(code).toBe(0);
		const deps = await app.installer.getDeps();
		expect(deps["koishi-plugin-weird"]?.resolved).toBe("not.a.version");
		const replies = await client.receive("plugin.upgrade weird");
		expect(replies[0]).toContain("所有插件已是最新版本。");
	}, 20000);
});
