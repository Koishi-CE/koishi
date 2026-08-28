/**
 * market 域测试公用基建:最小 ctx mock、日志桩与临时目录工厂。
 *
 * 设计要点:
 * - ctx 以纯对象拼装,不加载 koishi 运行时(被测模块对 Context 的引用一律
 *   `import type`,类型兼容由 `as never` 断言桥接);
 * - `@koishi-ce/console` 的 DataService 可在 node 环境用真实基类实例化,
 *   仅需 ctx.effect/logger/baseDir 等少量成员(实验验证过);
 * - effect/on 注册的回调收集在 disposers/listeners 里,测试可手动模拟
 *   析构与事件派发(close()/trigger())。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Mock, vi } from "vitest";

/** 四级日志桩:断言告警/静默分支用。 */
export interface LoggerMock {
	debug: Mock;
	info: Mock;
	warn: Mock;
	error: Mock;
}

function createLoggerMock(): LoggerMock {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

/** market 域测试的最小 ctx 形态(按需扩展,不要提升为"全能"mock)。 */
export interface MockContext {
	baseDir: string;
	/** cordis Service 基类构造的接线面(provide/runtime/set)。 */
	provide: Mock;
	runtime: { name?: string };
	set: Mock;
	loader: {
		config: { plugins: Record<string, unknown> };
		writable: boolean;
		writeConfig: Mock;
		fullReload: Mock;
	};
	scope: { isActive: boolean };
	console: {
		clients: Record<string, unknown>;
		services: Record<string, unknown>;
		broadcast: Mock;
		refresh: Mock;
		addListener: Mock;
	};
	installer: {
		getRegistry: Mock;
		install: Mock;
		setPackage: Mock;
		isInstalling: boolean;
		probeDependenciesInBackground: Mock;
	};
	http: { extend: Mock; get: Mock };
	/** 转成被测模块接受的 Context(类型断言桥接,运行时仍是本对象)。 */
	asContext: <T = never>() => T;
	/** 触发 on 注册的事件监听器,返回各监听器的返回值数组。 */
	trigger: (event: string, ...args: unknown[]) => unknown[];
	/** 依次执行 effect 注册的 dispose 回调(模拟插件析构)。 */
	close: () => void;
	/** logger(name) 收集到的名字序列(断言日志域用)。 */
	loggerNames: string[];
	/** effect 注册的 dispose 回调队列。 */
	disposers: Array<() => void>;
	/** on 注册的监听器(按事件名分组)。 */
	listeners: Map<string, Array<(...args: unknown[]) => unknown>>;
	/** 四级日志桩(ctx.logger 的所有名字共享)。 */
	log: LoggerMock;
	logger: (name: string) => LoggerMock;
	effect: Mock;
	on: Mock;
	get: Mock;
	throttle: Mock;
}

export interface MockContextOptions {
	/** koishi.yml 的 plugins 配置(默认空对象)。 */
	plugins?: Record<string, unknown>;
	/** loader 是否可写(默认 true)。 */
	writable?: boolean;
	/** 数据目录(默认假路径;真实落盘测试请传临时目录)。 */
	baseDir?: string;
}

export function createMockContext(
	options: MockContextOptions = {},
): MockContext {
	const log = createLoggerMock();
	const loggerNames: string[] = [];
	const disposers: Array<() => void> = [];
	const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();

	const ctx: MockContext = {
		baseDir: options.baseDir ?? "/mock-base",
		provide: vi.fn(),
		runtime: {},
		set: vi.fn(),
		loader: {
			config: { plugins: options.plugins ?? {} },
			writable: options.writable ?? true,
			writeConfig: vi.fn(async () => {}),
			fullReload: vi.fn(),
		},
		scope: { isActive: true },
		console: {
			clients: {},
			services: {},
			broadcast: vi.fn(),
			refresh: vi.fn(),
			addListener: vi.fn(),
		},
		installer: {
			getRegistry: vi.fn(async () => ({})),
			install: vi.fn(async () => 0),
			setPackage: vi.fn(),
			isInstalling: false,
			probeDependenciesInBackground: vi.fn(async () => {}),
		},
		http: {
			extend: vi.fn(() =>
				vi.fn(async () => ({ status: 200, data: "", headers: {} })),
			),
			get: vi.fn(async () => ""),
		},
		asContext: () => ctx as never,
		trigger: (event, ...args) =>
			(listeners.get(event) ?? []).map((fn) => fn(...args)),
		close: () => {
			for (const dispose of disposers.splice(0)) dispose();
		},
		loggerNames,
		disposers,
		listeners,
		log,
		logger: (name: string) => {
			loggerNames.push(name);
			return log;
		},
		effect: vi.fn((factory: () => (() => void) | undefined) => {
			const dispose = factory() ?? (() => {});
			disposers.push(dispose);
			return () => dispose();
		}),
		on: vi.fn((event: string, callback: (...args: unknown[]) => unknown) => {
			const list = listeners.get(event) ?? [];
			list.push(callback);
			listeners.set(event, list);
			return () => {
				const remaining = (listeners.get(event) ?? []).filter(
					(fn) => fn !== callback,
				);
				listeners.set(event, remaining);
			};
		}),
		get: vi.fn((name: string) =>
			name === "console" ? ctx.console : undefined,
		),
		throttle: vi.fn((fn: unknown) => fn),
	};
	// cordis Service(即 @koishi-ce/console DataService)构造用 Context.is(ctx) 判定
	// 走哪条分支:挂上全局注册的 cordis.is symbol,让真实基类把本 mock 当作
	// Context 使用(ctx.provide/runtime/on 均为上面的桩),避免其另起真实 Context。
	(ctx as unknown as Record<symbol, unknown>)[Symbol.for("cordis.is")] = true;
	return ctx;
}

/** 真实落盘测试用的临时目录:data-store 写盘、atomic-write 等场景。 */
export async function createTempDir(): Promise<{
	dir: string;
	cleanup: () => Promise<void>;
}> {
	const dir = await mkdtemp(join(tmpdir(), "marketn-test-"));
	return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** data 目录路径拼接(与被测模块的 resolve(baseDir, "data", ...) 对齐)。 */
export function dataFilePath(baseDir: string, name: string): string {
	return join(baseDir, "data", name);
}
