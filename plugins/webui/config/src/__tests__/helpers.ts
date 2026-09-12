// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/plugin-config 行为测试的公共装配与桩件。
 *
 * 以 TestLoader（不落盘的 Loader 桩）装配真实应用，供同目录 services /
 * package-provider / writer-events 三个主题测试文件复用，共同覆盖：只读配置
 * 的跳过分支、三个数据服务的注册与读取（packages / services / config）、
 * ConfigWriter 的全部 manager/* 事件（app-reload / reload / unload / remove /
 * meta / teleport）与配置树的增删改、PackageProvider 的运行时解析缓存与
 * 按需刷新链路。
 */

import { it } from "bun:test";
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
	type App,
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
export const itQuiet = (
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
export class TestConsole extends Console {
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

// loader 的 apply/reload/unload 与启动横幅是正常生命周期 info（且部分在下方
// createApp 期间即产生），收敛为仅错误级；恢复见 stopApp
const testLevels = Logger.levels as Record<string, number>;

export let loader: TestLoader;
export let app: Context;
export let socket: FakeSocket;
export let client: Client;
let fixtureRoot: string;

const service = () => app.console as TestConsole;
export const writer = () =>
	app.get("console.services.config") as ConfigWriter;

/** 读取客户端已收到的全部消息 */
export function readSent(): SentMessage[] {
	return socket.sent.map(
		(line) => JSON.parse(line) as SentMessage,
	);
}

/** 等待写盘队列（合并窗口 setTimeout 0）落定 */
export async function flushWrites() {
	await tick(10);
}

/**
 * Hermetic 应用根：本机包扫描（LocalScanner）与 workspace 路径键解析均以
 * loader.baseDir 为锚，固定到临时 fixture，避免断言依赖真实仓库 node_modules
 * 的链接状态（哪些 workspace 包被链入由包管理器布局决定，换环境即挂）。
 *
 * 裸跑（bun test 无 --isolate）时多测试文件共享本模块单例，stopApp 清理后
 * 由下一次 startApp 全量重建 fixture / loader / app，避免对已停机实例二次
 * start。
 */
async function rebuild() {
	loader = new TestLoader();
	fixtureRoot = mkdtempSync(
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

	app = await loader.createApp();
	// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
	app.plugin(
		TestConsole as unknown as Plugin.Constructor<App>,
	);
	app.plugin(configPlugin);
}

/** 各主题测试文件的 beforeAll 钩子体：重建宿主并建立登录前的客户端桩。 */
export async function startApp() {
	testLevels["loader"] = 1;
	testLevels["app"] = 1;
	await rebuild();
	await app.start();
	socket = new FakeSocket();
	client = service().acceptClient(
		socket.socket,
		fakeRequest(),
	);
	await tick();
	socket.sent.length = 0;
}

/**
 * 各主题测试文件的 afterAll 钩子体：停机、清理临时 fixture 目录并恢复
 * 域级阈值，避免同进程后续测试文件被连带静默。
 */
export async function stopApp() {
	for (const entry of Object.values(service().entries)) {
		entry.dispose();
	}
	await tick();
	await app.stop();
	rmSync(fixtureRoot, { recursive: true, force: true });
	delete testLevels["loader"];
	delete testLevels["app"];
}
