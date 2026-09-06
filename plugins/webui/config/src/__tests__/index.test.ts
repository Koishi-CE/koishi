// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/plugin-config 的行为测试。
 *
 * 以 TestLoader（不落盘的 Loader 桩）装配真实应用：覆盖只读配置的跳过分支、
 * 三个数据服务的注册与读取（packages / services / config）、ConfigWriter 的
 * 全部 manager/* 事件（app-reload / reload / unload / remove / meta / teleport）
 * 与配置树的增删改、PackageProvider 的运行时解析缓存与按需刷新链路。
 */

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Client,
	Console,
	type Entry,
} from "@koishi-ce/console";
import {
	App,
	type Context,
	type Dict,
	Logger,
	type Plugin,
	type Universal,
} from "@koishi-ce/koishi";
import { Loader } from "@koishi-ce/loader";
import type { ConfigWriter } from "@koishi-ce/plugin-config";
import * as configPlugin from "@koishi-ce/plugin-config";

/** 出站消息形状 */
interface SentMessage {
	type: string;
	body: {
		id?: number;
		key?: string;
		value?: unknown;
		error?: string;
	};
}

/** 内存 WebSocket 桩 */
class FakeSocket {
	sent: string[] = [];
	// message 与 close 的监听器统一为同构签名（never 载荷），保证集合存取类型一致
	private messageHandlers = new Set<
		(event: never) => void
	>();
	private closeHandlers = new Set<(event: never) => void>();

	send(data: string) {
		this.sent.push(data);
	}

	addEventListener(
		type: string,
		listener: (event: never) => void,
	) {
		if (type === "message")
			this.messageHandlers.add(listener);
		if (type === "close") this.closeHandlers.add(listener);
	}

	removeEventListener(
		type: string,
		listener: (event: never) => void,
	) {
		if (type === "message")
			this.messageHandlers.delete(listener);
		if (type === "close")
			this.closeHandlers.delete(listener);
	}

	get socket(): Universal.WebSocket {
		return this as unknown as Universal.WebSocket;
	}
}

function fakeRequest() {
	return {
		headers: {},
		socket: { remoteAddress: "127.0.0.1" },
	} as unknown as IncomingMessage;
}

function tick(ms = 20) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 声明预期触发告警（失败路径正是被测行为）的用例：执行期间静默指定日志域。 */
const itQuiet = (
	domains: string[],
	name: string,
	fn: () => Promise<void> | void,
) =>
	it(name, async () => {
		const levels = Logger.levels as Record<string, number>;
		const saved = domains.map(
			(d) => [d, levels[d]] as const,
		);
		for (const d of domains) levels[d] = 0;
		try {
			await fn();
		} finally {
			for (const [d, v] of saved) {
				if (v === undefined) delete levels[d];
				else levels[d] = v;
			}
		}
	});

/** Console 抽象基类的最小实现 */
class TestConsole extends Console {
	resolveEntry(files: Entry.Files, key: string): string[] {
		const list =
			typeof files === "string" || Array.isArray(files)
				? files
				: files.prod;
		return [String(list), key];
	}

	acceptClient(
		socket: Universal.WebSocket,
		request: IncomingMessage,
	): Client {
		let accepted: Client | undefined;
		const dispose = this.ctx.on(
			"console/connection",
			(client) => {
				accepted = client;
			},
		);
		this.accept(socket, request);
		dispose();
		if (!accepted) throw new Error("client not accepted");
		return accepted;
	}
}

/** loader 测试桩：import 走内存注册表，saveConfig 只记录，fullReload 只计数 */
class TestLoader extends Loader {
	data: Dict<unknown> = Object.create(null);
	writes: { filename: string; config: unknown }[] = [];
	fullReloadCount = 0;
	/** 每个名字被 import 的次数（断言失败缓存不再重复解析） */
	importCounts: Dict<number> = Object.create(null);

	constructor() {
		super();
		this.writable = true;
	}

	override async import(name: string) {
		this.importCounts[name] =
			(this.importCounts[name] ?? 0) + 1;
		if (name === "bad-plugin") {
			throw new Error("cannot resolve bad-plugin");
		}
		return (this.data[name] ||= {
			name,
			apply: (ctx: Context) => {
				ctx.accept();
			},
		});
	}

	override fullReload() {
		this.fullReloadCount += 1;
	}

	protected override locateConfig(): Promise<never> {
		throw new Error(
			"test loader does not touch the file system",
		);
	}

	protected override parseConfig(): Promise<never> {
		throw new Error(
			"test loader does not touch the file system",
		);
	}

	protected override async saveConfig(
		filename: string,
		config: Context.Config,
	): Promise<void> {
		this.writes.push({ filename, config });
	}
}

const loader = new TestLoader();

// loader 的 apply/reload/unload 与启动横幅是正常生命周期 info（且部分在下方顶层
// createApp 期间即产生），收敛为仅错误级；恢复见文件末 afterAll
const testLevels = Logger.levels as Record<string, number>;
testLevels["loader"] = 1;
testLevels["app"] = 1;

/**
 * Hermetic 应用根：本机包扫描（LocalScanner）与 workspace 路径键解析均以
 * loader.baseDir 为锚，固定到临时 fixture，避免断言依赖真实仓库 node_modules
 * 的链接状态（哪些 workspace 包被链入由包管理器布局决定，换环境即挂）。
 */
const fixtureRoot = mkdtempSync(
	join(tmpdir(), "koishi-config-pkg-"),
);
mkdirSync(
	join(
		fixtureRoot,
		"node_modules/@koishi-ce/plugin-fixture",
	),
	{
		recursive: true,
	},
);
writeFileSync(
	join(
		fixtureRoot,
		"node_modules/@koishi-ce/plugin-fixture/package.json",
	),
	JSON.stringify(
		{
			name: "@koishi-ce/plugin-fixture",
			version: "1.0.0",
			peerDependencies: { koishi: "^4.18.0" },
		},
		null,
		"\t",
	),
);
mkdirSync(join(fixtureRoot, "plugins/webui/auth"), {
	recursive: true,
});
writeFileSync(
	join(fixtureRoot, "plugins/webui/auth/package.json"),
	JSON.stringify({
		name: "@koishi-ce/plugin-auth",
		version: "1.0.0",
	}),
);
// 配置树里的路径键 ./missing-pkg 也应真实存在，否则包扫描每轮都刷 ENOENT 告警
mkdirSync(join(fixtureRoot, "missing-pkg"), {
	recursive: true,
});
writeFileSync(
	join(fixtureRoot, "missing-pkg/package.json"),
	JSON.stringify({
		name: "koishi-plugin-missing-pkg",
		version: "1.0.0",
	}),
);
// external/ 约定目录下的未启用插件（含一个非插件包与一个无清单目录，
// 均不应进列表）；有清单但包名不合插件命名的 lib-tool 也不收录
mkdirSync(join(fixtureRoot, "external/war-game"), {
	recursive: true,
});
writeFileSync(
	join(fixtureRoot, "external/war-game/package.json"),
	JSON.stringify({
		name: "koishi-plugin-war-game",
		version: "0.1.0",
	}),
);
mkdirSync(join(fixtureRoot, "external/plain-lib"), {
	recursive: true,
});
writeFileSync(
	join(fixtureRoot, "external/plain-lib/package.json"),
	JSON.stringify({
		name: "plain-lib",
		version: "1.0.0",
	}),
);
mkdirSync(join(fixtureRoot, "external/no-manifest"), {
	recursive: true,
});
// 嵌套 monorepo（新模板 workspaces 声明形态）：子包在二级深度可收录，
// monorepo 根（@scope/monorepo 命名）不进列表，node_modules 残留探针
// 被负向通配排除；plugins/ 一级的未启用包（盲区修复）同样可收录
writeFileSync(
	join(fixtureRoot, "package.json"),
	JSON.stringify({
		name: "fixture-host",
		private: true,
		workspaces: [
			"plugins/*",
			"external/**",
			"!external/**/node_modules/**",
		],
	}),
);
mkdirSync(
	join(fixtureRoot, "external/infra/packages/war-lib"),
	{ recursive: true },
);
writeFileSync(
	join(
		fixtureRoot,
		"external/infra/packages/war-lib/package.json",
	),
	JSON.stringify({
		name: "koishi-plugin-war-lib",
		version: "0.2.0",
	}),
);
writeFileSync(
	join(fixtureRoot, "external/infra/package.json"),
	JSON.stringify({
		name: "@infra/monorepo",
		version: "1.0.0",
		private: true,
	}),
);
mkdirSync(
	join(fixtureRoot, "external/infra/node_modules/zzz"),
	{ recursive: true },
);
writeFileSync(
	join(
		fixtureRoot,
		"external/infra/node_modules/zzz/package.json",
	),
	JSON.stringify({
		name: "koishi-plugin-zzz-pollution",
		version: "1.0.0",
	}),
);
mkdirSync(join(fixtureRoot, "plugins/local-tool"), {
	recursive: true,
});
writeFileSync(
	join(fixtureRoot, "plugins/local-tool/package.json"),
	JSON.stringify({
		name: "koishi-plugin-local-tool",
		version: "0.3.0",
	}),
);
loader.baseDir = fixtureRoot;

loader.config = {
	plugins: {
		$sfolded: true,
		"gone:xyz": { $if: false },
		"~disabled:q": { a: 1 },
		"keep:abc": { v: 1 },
		"pos:one": {},
		"group:g1": {
			"./plugins/webui/auth": {},
			"./missing-pkg": {},
			"inner:two": { t: 2 },
			"mov:me": { m: 1 },
		},
	},
} as unknown as Context.Config;

const app = await loader.createApp();
// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
app.plugin(
	TestConsole as unknown as Plugin.Constructor<App>,
);
app.plugin(configPlugin);

const service = () => app.console as TestConsole;
const writer = () =>
	app.get("console.services.config") as ConfigWriter;
let socket: FakeSocket;
let client: Client;

/** 读取客户端已收到的全部消息 */
function readSent(): SentMessage[] {
	return socket.sent.map(
		(line) => JSON.parse(line) as SentMessage,
	);
}

/** 等待写盘队列（合并窗口 setTimeout 0）落定 */
async function flushWrites() {
	await tick(10);
}

beforeAll(async () => {
	await app.start();
	socket = new FakeSocket();
	client = service().acceptClient(
		socket.socket,
		fakeRequest(),
	);
	await tick();
	socket.sent.length = 0;
});

afterAll(async () => {
	for (const entry of Object.values(service().entries)) {
		entry.dispose();
	}
	await tick();
	await app.stop();
	rmSync(fixtureRoot, { recursive: true, force: true });
	// 恢复域级阈值，避免同进程后续测试文件被连带静默
	delete testLevels["loader"];
	delete testLevels["app"];
});

describe("@koishi-ce/plugin-config", () => {
	itQuiet(
		["app"],
		"无可写 loader 时仅告警并跳过装配",
		async () => {
			const bare = new App();
			bare.plugin(
				TestConsole as unknown as Plugin.Constructor<App>,
			);
			bare.plugin(configPlugin);
			await bare.start();
			expect(
				bare.get("console.services.config"),
			).toBeUndefined();
			expect(
				bare.get("console.services.packages"),
			).toBeUndefined();
			expect(
				bare.get("console.services.services"),
			).toBeUndefined();
			await bare.stop();
		},
	);

	it("挂载 packages / services / config 三个数据服务", () => {
		expect(
			app.get("console.services.packages"),
		).toBeTruthy();
		expect(
			app.get("console.services.services"),
		).toBeTruthy();
		expect(app.get("console.services.config")).toBeTruthy();
	});

	describe("ConfigWriter.get()", () => {
		it("过滤未加载项，分组递归展开，$ 与 ~ 键原样保留", async () => {
			const result = await writer().get();
			const plugins = result.plugins as Record<
				string,
				unknown
			>;
			// $if 为假的键不出现；$ 内部键与 ~ 停用键保留
			expect("gone:xyz" in plugins).toBe(false);
			expect(plugins["$sfolded"]).toBe(true);
			expect(plugins["~disabled:q"]).toEqual({ a: 1 });
			expect(plugins["keep:abc"]).toEqual({ v: 1 });
			expect(plugins["group:g1"]).toEqual({
				"./plugins/webui/auth": {},
				"./missing-pkg": {},
				"inner:two": { t: 2 },
				"mov:me": { m: 1 },
			});
		});
	});

	describe("PackageProvider", () => {
		it("收集本机包与 workspace 源码包并附全局设置条目", async () => {
			const provider = app.get(
				"console.services.packages",
			) as unknown as {
				get(): Promise<Dict<Record<string, unknown>>>;
			};
			const data = await provider.get();
			// 全局设置条目（name 为空串）排在最前
			expect(data[""]).toBeTruthy();
			// workspace 路径键引用的源码包：带 paths 与运行时缓存
			const auth = data["@koishi-ce/plugin-auth"];
			expect(auth?.["paths"]).toEqual([
				"./plugins/webui/auth",
			]);
			expect(auth?.["runtime"]).toBeTruthy();
			// 本机 node_modules 扫描出的已装插件包（fixture 预置，见文件头说明）
			expect(
				data["@koishi-ce/plugin-fixture"],
			).toBeTruthy();
		});

		it("扫描 external/ 约定目录收录未启用的 workspace 插件", async () => {
			const provider = app.get(
				"console.services.packages",
			) as unknown as {
				get(): Promise<Dict<Record<string, unknown>>>;
				pathKeys: Dict<string>;
				cache: Dict<Record<string, unknown>>;
			};
			const data = await provider.get();
			// 命名合规的插件包：收录并标注相对路径键
			const war = data["koishi-plugin-war-game"];
			expect(war?.["workspace"]).toBe(true);
			expect(war?.["paths"]).toEqual([
				"./external/war-game",
			]);
			// 未启用包不预热运行时缓存（require 会提前求值模块）
			expect(war?.["runtime"]).toBeUndefined();
			// 「包名 → 配置键」反查已登记，request-runtime 按需解析可用
			expect(
				provider.pathKeys["koishi-plugin-war-game"],
			).toBe("./external/war-game");
			expect(
				provider.cache["./external/war-game"],
			).toBeUndefined();
			// 非插件命名与无清单目录不进列表
			expect(data["plain-lib"]).toBeUndefined();
			expect(data["no-manifest"]).toBeUndefined();
		});

		it("workspaces 声明驱动收录嵌套 monorepo 子包与 plugins/ 未启用包", async () => {
			const provider = app.get(
				"console.services.packages",
			) as unknown as {
				get(): Promise<Dict<Record<string, unknown>>>;
			};
			const data = await provider.get();
			// 嵌套子包（external/** 任意深度）：收录并以深路径为键
			const lib = data["koishi-plugin-war-lib"];
			expect(lib?.["workspace"]).toBe(true);
			expect(lib?.["paths"]).toEqual([
				"./external/infra/packages/war-lib",
			]);
			expect(lib?.["runtime"]).toBeUndefined();
			// plugins/ 一级的未启用包同样可收录（此前的可见性盲区）
			expect(
				data["koishi-plugin-local-tool"]?.["paths"],
			).toEqual(["./plugins/local-tool"]);
			// monorepo 根（@scope/monorepo 命名）不进列表
			expect(data["@infra/monorepo"]).toBeUndefined();
			// node_modules 残留探针被负向通配排除（即使命名合规）
			expect(
				data["koishi-plugin-zzz-pollution"],
			).toBeUndefined();
		});

		it("readWorkspacePatterns：无清单 / 非数组 / 空数组时回退约定", async () => {
			const { readWorkspacePatterns } = await import(
				"../node/packages.ts"
			);
			const empty = mkdtempSync(
				join(tmpdir(), "koishi-config-ws-"),
			);
			try {
				// 无 package.json → 兜底约定
				expect(readWorkspacePatterns(empty)).toEqual([
					"plugins/*",
					"external/*",
				]);
				// 非数组（yarn no-hoist 对象形态）与空数组同理
				writeFileSync(
					join(empty, "package.json"),
					JSON.stringify({
						workspaces: { packages: ["external/*"] },
					}),
				);
				expect(readWorkspacePatterns(empty)).toEqual([
					"plugins/*",
					"external/*",
				]);
				writeFileSync(
					join(empty, "package.json"),
					JSON.stringify({ workspaces: [] }),
				);
				expect(readWorkspacePatterns(empty)).toEqual([
					"plugins/*",
					"external/*",
				]);
				// 合法声明原样透传（负向模式保留 ! 前缀）
				writeFileSync(
					join(empty, "package.json"),
					JSON.stringify({
						workspaces: [
							"external/**",
							"!external/**/node_modules/**",
						],
					}),
				);
				expect(readWorkspacePatterns(empty)).toEqual([
					"external/**",
					"!external/**/node_modules/**",
				]);
			} finally {
				rmSync(empty, { recursive: true, force: true });
			}
		});

		itQuiet(
			["config"],
			"request-runtime 按路径键 / 短名解析并刷新，失败结果同样缓存",
			async () => {
				const listener =
					app.console.listeners["config/request-runtime"];
				expect(listener).toBeTruthy();
				const provider = app.get(
					"console.services.packages",
				) as unknown as {
					cache: Dict<{ failed?: boolean }>;
					pathKeys: Dict<string>;
				};
				// 失败路径：stub 的 bad-plugin 抛错，{ failed: true } 入缓存并
				// 随数据下发——前端据以展示失败提示并停止重发请求
				await listener?.callback.call(
					client as never,
					"bad-plugin",
				);
				await flushWrites();
				expect(provider.cache["bad-plugin"]).toEqual({
					failed: true,
				});
				// 重复请求命中失败缓存，不再触发 loader.import（防活锁刷屏）
				const importsAfterFirst =
					loader.importCounts["bad-plugin"] ?? 0;
				expect(importsAfterFirst).toBeGreaterThan(0);
				await listener?.callback.call(
					client as never,
					"bad-plugin",
				);
				await flushWrites();
				expect(loader.importCounts["bad-plugin"] ?? 0).toBe(
					importsAfterFirst,
				);
				// 成功路径：workspace 包名命中 pathKeys
				await listener?.callback.call(
					client as never,
					"@koishi-ce/plugin-auth",
				);
				await flushWrites();
				expect(
					provider.pathKeys["@koishi-ce/plugin-auth"],
				).toBe("./plugins/webui/auth");
				expect(
					provider.cache["./plugins/webui/auth"],
				).toBeTruthy();
				expect(
					provider.cache["./plugins/webui/auth"]?.failed,
				).toBeUndefined();
			},
		);

		it("internal/runtime / fork / status 与 hmr/reload 触发运行时更新", async () => {
			const dummy = loader.data["keep"] as Plugin;
			const runtime = app.registry.get(dummy);
			expect(runtime).toBeTruthy();
			// keyFor 命中缓存：重新解析并去抖刷新
			app.emit("internal/runtime", runtime as never);
			// 未登记的插件：直接返回
			app.emit("internal/runtime", {
				runtime: { plugin: TestConsole },
			} as never);
			const fork = runtime?.children[0];
			expect(fork).toBeTruthy();
			app.emit("internal/fork", fork as never);
			// internal/status 签名为 (scope, oldValue) 双参，仓库内监听者均不消费第二参，
			// 补 undefined 占位满足调用形状且不改变运行时行为
			app.emit(
				"internal/status",
				fork as never,
				undefined as never,
			);
			app.emit("hmr/reload", [[dummy]] as never);
			await tick(30);
			expect(true).toBe(true);
		});
	});

	describe("ServiceProvider", () => {
		it("上报各服务的提供者上下文并在服务变动时刷新", async () => {
			const provider = app.get(
				"console.services.services",
			) as unknown as {
				get(): Promise<Dict<number>>;
			};
			const data = await provider.get();
			expect(data["console"]).toBeGreaterThanOrEqual(0);
			// 服务注册（set 会广播 internal/service）→ refresh → 客户端收到 services 数据
			socket.sent.length = 0;
			app.set(
				"probe.svc" as never,
				{ marker: true } as never,
			);
			await tick(30);
			const messages = readSent().filter(
				(msg) =>
					msg.type === "data" &&
					msg.body.key === "services",
			);
			expect(messages.length).toBeGreaterThan(0);
		});

		it("provide() 注册的服务同样上报（loader / watcher 形态）", async () => {
			const provider = app.get(
				"console.services.services",
			) as unknown as {
				get(): Promise<Dict<number>>;
			};
			// cordis 3.18 的 ctx.provide() 不给值定义自有 "ctx" 属性
			// （只有 tracker 符号，经 traceable 代理的属性访问可达），
			// descriptor 查询落空时须以属性访问兜底，否则配置页
			// 恒显示「必需服务未加载」
			app.provide("probe.plain", { marker: 1 });
			const data = await provider.get();
			expect(data["probe.plain"]).toBeGreaterThanOrEqual(0);
		});
	});

	describe("ConfigWriter 事件", () => {
		it("manager/meta 更新元数据键（含 null 删除）", async () => {
			const listener =
				app.console.listeners["manager/meta"];
			await listener?.callback.call(
				client as never,
				"abc",
				{
					$label: "L",
					$collapsed: null,
				},
			);
			await flushWrites();
			const plugins = loader.config.plugins as Record<
				string,
				Record<string, unknown>
			>;
			expect(plugins["keep:abc"]?.["$label"]).toBe("L");
			expect(
				"$collapsed" in (plugins["keep:abc"] ?? {}),
			).toBe(false);
			// 元数据键置于配置开头
			expect(
				Object.keys(plugins["keep:abc"] ?? {})[0],
			).toBe("$label");
			// 分组内插件的 meta（按 ident 递归定位）
			await listener?.callback.call(
				client as never,
				"two",
				{
					$label: "G",
				},
			);
			await flushWrites();
			const group = plugins["group:g1"] as Record<
				string,
				Record<string, unknown>
			>;
			expect(group["inner:two"]?.["$label"]).toBe("G");
		});

		it("manager/reload 更新插件配置并保持键位置", async () => {
			const listener =
				app.console.listeners["manager/reload"];
			await listener?.callback.call(
				client as never,
				"",
				"keep:abc",
				{
					v: 2,
				},
			);
			await flushWrites();
			const plugins = loader.config.plugins as Record<
				string,
				unknown
			>;
			expect(plugins["keep:abc"]).toEqual({ v: 2 });
			const dummy = loader.data["keep"] as Plugin;
			expect(app.registry.get(dummy)?.config).toEqual({
				v: 2,
			});
			// 运行期更新触发回写
			expect(loader.writes.length).toBeGreaterThan(0);
		});

		it("manager/unload 停用插件（原位改 ~ 与按位置插入）", async () => {
			const listener =
				app.console.listeners["manager/unload"];
			// 原位重命名
			await listener?.callback.call(
				client as never,
				"",
				"keep:abc",
				{
					v: 3,
				},
			);
			await flushWrites();
			const plugins = loader.config.plugins as Record<
				string,
				unknown
			>;
			expect("keep:abc" in plugins).toBe(false);
			expect(plugins["~keep:abc"]).toEqual({ v: 3 });
			const dummy = loader.data["keep"] as Plugin;
			expect(app.registry.get(dummy)).toBeUndefined();

			// 先补一个可停用键，再按 index 插入到指定位置
			const reload =
				app.console.listeners["manager/reload"];
			await reload?.callback.call(
				client as never,
				"",
				"back:two",
				{
					b: 1,
				},
			);
			await flushWrites();
			await listener?.callback.call(
				client as never,
				"",
				"back:two",
				{},
				1,
			);
			await flushWrites();
			const keys = Object.keys(
				loader.config.plugins as object,
			);
			expect(keys.indexOf("~back:two")).toBe(1);
		});

		it("manager/remove 彻底移除插件（含 ~ 停用态键）", async () => {
			const listener =
				app.console.listeners["manager/remove"];
			await listener?.callback.call(
				client as never,
				"",
				"~keep:abc",
			);
			await flushWrites();
			const plugins = loader.config.plugins as Record<
				string,
				unknown
			>;
			expect("keep:abc" in plugins).toBe(false);
			expect("~keep:abc" in plugins).toBe(false);
			await listener?.callback.call(
				client as never,
				"",
				"pos:one",
			);
			await flushWrites();
			expect("pos:one" in plugins).toBe(false);
		});

		it("manager/teleport 跨分组迁移与同分组重排", async () => {
			const listener =
				app.console.listeners["manager/teleport"];
			const plugins = loader.config.plugins as Record<
				string,
				unknown
			>;
			// 跨分组：group:g1 → 根（index 0）
			await listener?.callback.call(
				client as never,
				"g1",
				"mov:me",
				"",
				0,
			);
			await flushWrites();
			expect(plugins["mov:me"]).toEqual({ m: 1 });
			const group = plugins["group:g1"] as Record<
				string,
				unknown
			>;
			expect("mov:me" in group).toBe(false);
			// 运行时 fork 已改挂根作用域
			const dummy = loader.data["mov"] as Plugin;
			const fork = app.registry.get(dummy)?.children[0];
			expect(fork?.parent.scope.uid).toBe(
				loader.entry.scope.uid,
			);

			// 同分组：仅重排键位置
			await listener?.callback.call(
				client as never,
				"",
				"mov:me",
				"",
				0,
			);
			await flushWrites();
			expect(Object.keys(plugins)[0]).toBe("mov:me");
		});

		itQuiet(
			["loader"],
			"manager/* 失败统一回执 failed",
			async () => {
				const listener =
					app.console.listeners["manager/teleport"];
				await expect(
					listener?.callback.call(
						client as never,
						"no-such-group",
						"k",
						"",
						0,
					),
				).rejects.toThrow("failed");
			},
		);

		it("manager/app-reload 替换全局配置并整进程重载", async () => {
			const listener =
				app.console.listeners["manager/app-reload"];
			const writesBefore = loader.writes.length;
			await listener?.callback.call(client as never, {
				prefix: ["."],
			});
			await flushWrites();
			expect(loader.config.prefix).toEqual(["."]);
			// plugins 部分被保留
			expect(loader.config.plugins).toBeTruthy();
			expect(loader.writes.length).toBeGreaterThan(
				writesBefore,
			);
			expect(loader.fullReloadCount).toBe(1);
			// 非静默写盘触发 config 事件 → config 服务刷新推送
			const messages = readSent().filter(
				(msg) =>
					msg.type === "data" && msg.body.key === "config",
			);
			expect(messages.length).toBeGreaterThan(0);
		});
	});
});
