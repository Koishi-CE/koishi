/**
 * 插件包元数据提供器（服务端共享实现）。
 *
 * 以 `packages` 数据服务的形式向浏览器端提供本机可用的插件包列表及
 * 各自的运行时信息（Config schema、用法文档、注入的服务依赖、fork
 * 状态等）。运行时信息通过解析插件模块的导出（parseExports）获得并
 * 缓存在 cache 中，监听 runtime/fork/status 等内部事件按需刷新。
 *
 * 抽象类只定义"运行时信息"这一半；列表如何收集（本机扫描还是市场
 * 数据）分别由 node / browser 两个运行环境的子类实现。
 */
import { DataService } from "@koishi-ce/console";
import {
	Context,
	type Dict,
	Logger,
	type MainScope,
	type Plugin,
	type Schema,
	type ScopeStatus,
} from "@koishi-ce/koishi";
import type { LoaderScope } from "@koishi-ce/loader";
import {} from "@koishi-ce/plugin-hmr";
import type {
	PackageJson,
	SearchObject,
	SearchResult,
} from "@koishi-ce/registry";

declare module "@koishi-ce/loader" {
	interface Loader {
		market: SearchResult;
	}
}

declare module "@koishi-ce/console" {
	interface Events {
		"config/request-runtime"(name: string): void;
	}
}

const logger = new Logger("config");

export abstract class PackageProvider extends DataService<
	Dict<PackageProvider.Data>
> {
	cache: Dict<PackageProvider.RuntimeData> = {};
	debouncedRefresh: () => void;

	override ctx: Context;

	/**
	 * @param ctx 应用上下文
	 */
	constructor(ctx: Context) {
		super(ctx, "packages", { authority: 4 });
		this.ctx = ctx;

		this.debouncedRefresh = ctx.debounce(() => this.refresh(false), 0);
		// 插件的加载 / fork / 状态变化都可能影响运行时信息，统一走 update
		ctx.on("internal/runtime", (scope) => this.update(scope.runtime.plugin));
		ctx.on("internal/fork", (scope) => this.update(scope.runtime.plugin));
		ctx.on("internal/status", (scope) => this.update(scope.runtime.plugin));
		ctx.on("hmr/reload", (reloads) => {
			for (const [plugin] of reloads) {
				this.update(plugin);
			}
		});

		// 前端按需请求：某插件缺少运行时信息时（如刚安装尚未解析），
		// 按短名解析其导出并立即推送
		ctx.console.addListener(
			"config/request-runtime",
			async (name) => {
				name = name.replace(/(koishi-|^@koishijs\/)plugin-/, "");
				this.cache[name] = await this.parseExports(name);
				this.refresh(false);
			},
			{ authority: 4 },
		);
	}

	/**
	 * 收集插件包列表。由运行环境子类实现：node 端本机扫描 node_modules，
	 * browser 端复用 loader 缓存的市场搜索结果。
	 *
	 * @param forced 是否强制重新收集（绕过缓存）
	 */
	abstract collect(forced: boolean): Promise<PackageProvider.Data[]>;

	/**
	 * 某插件的运行时状态发生变化时，重新解析其导出并去抖刷新服务。
	 *
	 * @param plugin 发生变化的插件对象
	 */
	async update(plugin: Plugin) {
		const name = this.ctx.loader.keyFor(plugin);
		if (!name || !this.cache[name]) return;
		this.cache[name] = await this.parseExports(name);
		this.debouncedRefresh();
	}

	/**
	 * 从插件主作用域提取 fork 运行状态，写入 result 的 id/forkable/forks 字段。
	 *
	 * @param state 插件的主作用域
	 * @param result 待填充的运行时数据（原地修改）
	 */
	parseRuntime(state: MainScope, result: PackageProvider.RuntimeData) {
		// 已销毁的 runtime(uid 为 null)不展示 id
		if (state.runtime.uid !== null) {
			result.id = state.runtime.uid;
		}
		result.forkable = state.runtime.isForkable;
		// fork 的 key 由 loader 写入(cordis 的 ForkScope 类型上没有该属性)
		const forks: Dict<{ status?: ScopeStatus }> = {};
		for (const fork of state.children) {
			const key = (fork as LoaderScope).key;
			if (!key) continue;
			forks[key] = { status: fork.status };
		}
		result.forks = forks;
	}

	/**
	 * 数据服务读取入口：收集包列表，合并缓存的运行时信息，
	 * 并在最前面附加一个 name 为空串的"应用全局设置"条目。
	 */
	override async get(forced = false) {
		const objects = (await this.collect(forced)).slice();
		for (const object of objects) {
			object.name = object.package?.name || "";
			const cached = this.cache[object.shortname];
			if (!cached) continue;
			object.runtime = cached;
		}

		// 附加应用全局设置（使用 Context.Config 作为 schema，name 为空串）
		objects.unshift({
			name: "",
			runtime: {
				schema: Context.Config,
			},
			package: { name: "" },
		} as any as PackageProvider.Data);
		return Object.fromEntries(objects.map((data) => [data.name, data]));
	}

	/**
	 * 解析插件模块的导出，提取配置 schema、用法文档、过滤器开关与
	 * 注入的服务依赖（required / optional），并附带运行时 fork 状态。
	 * 解析失败时返回 `{ failed: true }` 而不是抛错。
	 *
	 * @param name 插件短名（不含 koishi-plugin- 前缀）
	 * @returns 可序列化的运行时数据
	 */
	async parseExports(name: string) {
		try {
			const exports = await this.ctx.loader.resolve(name);
			const result: PackageProvider.RuntimeData = {};
			result.schema = exports?.Config || exports?.schema;
			result.usage = exports?.usage;
			result.filter = exports?.filter;
			// using 与 inject 是新旧两种声明注入服务的方式
			const inject = exports?.using || exports?.inject || [];
			if (Array.isArray(inject)) {
				result.required = inject;
				result.optional = [];
			} else {
				result.required = inject.required || [];
				result.optional = inject.optional || [];
			}

			// 确保 result 可以被 JSON 序列化（schema 中可能混入不可序列化的值）
			JSON.stringify(result);

			const runtime = this.ctx.registry.get(exports);
			if (runtime) this.parseRuntime(runtime, result);
			return result;
		} catch (error) {
			logger.warn("failed to load %c", name);
			logger.warn(error);
			return { failed: true };
		}
	}
}

/** PackageProvider 相关的数据类型定义。 */
export namespace PackageProvider {
	/**
	 * 下发给前端的插件包条目：市场/本机元数据 + 运行时信息。
	 * name 为空串的条目特指应用全局设置。
	 */
	export interface Data
		extends Pick<
			SearchObject,
			"shortname" | "workspace" | "manifest" | "portable"
		> {
		/** 完整包名 */
		name?: string;
		/** 运行时信息（schema、依赖、fork 状态等） */
		runtime?: RuntimeData;
		package: Pick<
			PackageJson,
			"name" | "version" | "peerDependencies" | "peerDependenciesMeta"
		>;
	}

	/** 从插件模块导出解析出的运行时数据。 */
	export interface RuntimeData {
		/** 插件主作用域 uid（未加载时缺失） */
		id?: number;
		/** 是否暴露 filter（过滤器设置） */
		filter?: boolean;
		/** 是否可重用（允许同时存在多份配置） */
		forkable?: boolean;
		/** 插件的配置 schema */
		schema?: Schema;
		/** 用法说明（Markdown 文档） */
		usage?: string;
		/** 必需注入的服务列表 */
		required?: string[];
		/** 可选注入的服务列表 */
		optional?: string[];
		/** 模块解析失败标记 */
		failed?: boolean;
		/** 各 fork 配置的运行状态，键为配置路径 */
		forks?: Dict<{
			status?: ScopeStatus;
		}>;
	}
}
