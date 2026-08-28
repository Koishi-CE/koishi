/**
 * Loader 抽象基类：Koishi 的配置文件驱动加载器（与运行环境无关的部分）。
 *
 * 核心职责：定位并读写配置文件（json/yaml）→ 解析环境变量插值 → 按配置表
 * 逐个加载插件（以 `键: 配置` 形式声明，`~` 前缀表示停用、`$` 前缀为元属性）→
 * 监听运行期配置变化并回写文件。子类（如 NodeLoader）只需提供插件的实际
 * 导入（import）与整进程重载（fullReload）能力。
 *
 * 拆分说明：类型与符号见 types.ts，工具函数见 utils.ts，配置文件格式层见
 * config-file.ts，内置 group 插件见 group.ts，应用装配见 wiring.ts。
 */

import {
	Context,
	type Dict,
	type EffectScope,
	type ForkScope,
	interpolate,
	isNullable,
	Logger,
	valueMap,
	version,
} from "@koishi-ce/core";
import { constants, promises as fs } from "fs";
import * as path from "path";
import {
	dumpConfig,
	extensions,
	parseConfig,
	resolveConfigFile,
} from "./config-file";
import { group } from "./group";
import { kRecord, kUpdate, type LoaderScope } from "./types";
import { separate, unwrapExports } from "./utils";
import { handleStartMessage, logPluginUpdate, wireAppEvents } from "./wiring";

/**
 * Loader 抽象基类：负责配置文件定位/读写、插件按配置加载与配置回写。
 * 平台相关的插件导入与整进程重载由子类实现（见 NodeLoader）。
 */
export abstract class Loader {
	/** 作用域上记录"插件引用 -> fork"映射的符号键（全局注册，跨 Realm 共享） */
	static readonly kRecord: typeof kRecord = kRecord;
	/** 请求父进程整进程重启所用的退出码 */
	static readonly exitCode = 51;
	/** 支持的配置文件扩展名集合 */
	static readonly extensions = extensions;

	// 进程相关状态
	/** 工作目录（配置文件所在目录） */
	public baseDir = process.cwd();
	/** 跨重启共享的数据（KOISHI_SHARED），含启动时间与可选的启动消息 */
	public envData = process.env["KOISHI_SHARED"]
		? JSON.parse(process.env["KOISHI_SHARED"])
		: { startTime: Date.now() };

	/** 配置插值可用的参数上下文（当前为进程环境变量） */
	public params = {
		env: process.env,
	};

	/** 应用根上下文（createApp 后可用） */
	public app!: Context;
	/** 配置文件内容（插值前的原始解析结果） */
	public config!: Context.Config;
	/** 根插件组对应的上下文 */
	public entry!: Context;
	/** 挂起标记：写文件期间置真，抑制配置文件监听器的回环触发 */
	public suspend = false;
	/** 配置文件是否可写 */
	public writable = false;
	/** 配置文件 MIME 类型 */
	public mime: string | undefined;
	/** 配置文件绝对路径 */
	public filename!: string;
	/** 环境变量文件（.env / .env.local）路径列表 */
	public envFiles!: string[];
	/** 迁移时已占用的插件标识集合，用于生成去重标识 */
	public names = new Set<string>();
	/** 插件名到解析结果的缓存 */
	public cache: Dict<string> = Object.create(null);
	/** 应用启动前的日志缓存（父进程重启后可回放） */
	public prolog: Logger.Record[] = [];

	/** 插件对象 -> 插件名的反查表（弱引用，不阻止插件被回收） */
	private store = new WeakMap<any, string>();

	/** 进行中的写文件任务（用于合并并发写入） */
	private _writeTask: Promise<void> | undefined;
	/** 本轮合并写入是否保持静默（不触发 config 事件） */
	private _writeSlient = true;

	/** 导入指定名称的插件模块（由子类实现具体解析策略） */
	abstract import(name: string): Promise<any>;
	/** 触发整进程重载（由子类实现进程退出/重启策略） */
	abstract fullReload(code?: number): void;

	constructor() {
		// 注册一个日志收集目标：缓存最近 1000 条日志供重启后回放
		Logger.targets.push({
			colors: 3,
			record: (record) => {
				this.prolog.push(record);
				this.prolog = this.prolog.slice(-1000);
			},
		});
	}

	/**
	 * 初始化：定位配置文件、检测可写性、确定 env 文件路径。
	 *
	 * @param filename 可选的配置文件路径或目录；
	 *                 指向文件则直接采用，指向目录或未提供则在目录内查找
	 */
	async init(filename?: string) {
		const resolved = await resolveConfigFile(this.baseDir, filename);
		this.baseDir = resolved.baseDir;
		this.filename = resolved.filename;
		this.mime = resolved.mime;
		// 检测配置文件是否可写（不可写则运行期不会回盘）
		if (this.mime) {
			try {
				await fs.access(this.filename, constants.W_OK);
				this.writable = true;
			} catch {}
		}
		this.envFiles = [
			path.resolve(this.baseDir, ".env"),
			path.resolve(this.baseDir, ".env.local"),
		];
	}

	/**
	 * 迁移单个插件配置节点（默认仅处理 group）：
	 * 重建键的顺序并为缺少标识 / 标识冲突的插件生成随机标识。
	 * 子类可覆写以处理历史包名的重命名等场景。
	 */
	protected migrateEntry(name: string, config: any): any {
		if (name !== "group") return;
		const backup = { ...config };
		for (const key in backup) delete config[key];
		for (let key in backup) {
			// 元属性（$ 开头）原样保留
			if (key.startsWith("$")) {
				config[key] = backup[key];
				continue;
			}
			const [prefix = ""] = key.split(":", 1);
			const name = prefix.replace(/^~/, "");
			const value = this.migrateEntry(name, backup[key]) ?? backup[key];
			let ident = key.slice(prefix.length + 1);
			// 标识缺失或冲突时生成随机标识，保证引用唯一
			if (!ident || this.names.has(ident)) {
				ident = Math.random().toString(36).slice(2, 8);
				key = `${prefix}:${ident}`;
			}
			this.names.add(ident);
			config[key] = value;
		}
	}

	/** 对配置的插件表执行一次迁移（仅首次读取时调用） */
	async migrate() {
		this.migrateEntry("group", this.config.plugins);
	}

	/**
	 * 读取配置文件并解析为 Context.Config。
	 *
	 * @param initial 首次读取（执行迁移并回写规范化的配置）
	 */
	async readConfig(initial = false) {
		this.config = await parseConfig(this.filename, this.mime);

		if (initial) await this.migrate();
		if (this.writable) await this.writeConfig(true);
		return new Context.Config(this.interpolate(this.config));
	}

	/**
	 * 实际写文件实现：先写临时文件再原子改名，避免写一半被读到。
	 *
	 * @param silent 静默模式：写盘后不广播 config 事件
	 */
	private async _writeConfig(silent = false) {
		this.suspend = true;
		if (!this.writable) {
			throw new Error(`cannot overwrite readonly config`);
		}
		await fs.writeFile(
			this.filename + ".tmp",
			dumpConfig(this.config, this.mime),
		);
		await fs.rename(this.filename + ".tmp", this.filename);
		if (!silent) this.app.emit("config");
	}

	/**
	 * 写配置文件（合并同一轮微任务内的多次调用）。
	 * 任一调用要求非静默，则本次写盘为非静默（触发 config 事件）。
	 */
	writeConfig(silent = false) {
		this._writeSlient &&= silent;
		if (this._writeTask) return this._writeTask;
		return (this._writeTask = new Promise((resolve, reject) => {
			setTimeout(() => {
				this._writeSlient = true;
				this._writeTask = undefined;
				this._writeConfig(silent).then(resolve, reject);
			}, 0);
		}));
	}

	/**
	 * 递归插值：将字符串中的 `${{ expr }}` 替换为以 params 求值的结果。
	 */
	interpolate(source: any): any {
		if (typeof source === "string") {
			return interpolate(source, this.params, /\$\{\{(.+?)\}\}/g);
		} else if (!source || typeof source !== "object") {
			return source;
		} else if (Array.isArray(source)) {
			return source.map((item) => this.interpolate(item));
		} else {
			return valueMap(source, (item) => this.interpolate(item));
		}
	}

	/**
	 * 按名称导入插件并登记到反查表（供 keyFor 反查）。
	 */
	async resolve(name: string) {
		const plugin = unwrapExports(await this.import(name));
		if (plugin) this.store.set(this.app.registry.resolve(plugin), name);
		return plugin;
	}

	/**
	 * 由插件对象反查其短名（去掉 koishi- / plugin- 等包装前缀）。
	 */
	keyFor(plugin: any): string | undefined {
		const name = this.store.get(this.app.registry.resolve(plugin));
		if (name)
			return name.replace(/(koishi-|^@(?:koishijs|koishi-ce)\/)plugin-/, "");
		return undefined;
	}

	/**
	 * 当插件的引用对象发生替换时，把反查记录迁移到新对象。
	 */
	replace(oldKey: any, newKey: any) {
		oldKey = this.app.registry.resolve(oldKey);
		newKey = this.app.registry.resolve(newKey);
		const name = this.store.get(oldKey);
		if (!name) return;
		this.store.set(newKey, name);
		this.store.delete(oldKey);
	}

	/** 导入插件并把 fork 挂载到 parent（配置先做插值处理） */
	private async forkPlugin(name: string, config: any, parent: Context) {
		const plugin = await this.resolve(name);
		if (!plugin) return;

		return parent.plugin(plugin, this.interpolate(config));
	}

	/**
	 * 判断元属性表达式是否为真值（用于 $if 条件加载）。
	 * 表达式缺省时视为真。
	 */
	isTruthyLike(expr: any) {
		if (isNullable(expr)) return true;
		return !!this.interpolate(`\${{ ${expr} }}`);
	}

	/** 记录一条插件生命周期日志（apply / unload / reload） */
	private logUpdate(type: string, _parent: Context, key: string) {
		logPluginUpdate(this.app, type, key);
	}

	/**
	 * 按引用键加载或更新插件（loader 的核心方法）。
	 *
	 * 引用键格式为 `name:ident`（ident 可省略），`name` 为插件名或 `group`。
	 * 已存在则走更新路径（$if 为假则卸载）；不存在则新建 fork 并挂载，
	 * 随后应用 $filter 元属性生成会话过滤器。
	 *
	 * @param parent 挂载父上下文
	 * @param key 插件引用键
	 * @param source 插件配置源（含 `$` 元属性）
	 */
	async reload(parent: Context, key: string, source: any) {
		const record = ((parent.scope as LoaderScope)[kRecord] ??=
			Object.create(null));
		let fork: ForkScope | undefined = record[key];
		const [name = ""] = key.split(":", 1);
		const [config, meta] = separate(source, name === "group");
		if (fork) {
			if (!this.isTruthyLike(meta.$if)) {
				this.unload(parent, key);
				return;
			}
			// 标记本次更新来自 loader，避免 internal/before-update 回环写盘
			(fork as LoaderScope)[kUpdate] = true;
			fork.update(config);
		} else {
			if (!this.isTruthyLike(meta.$if)) return;
			this.logUpdate("apply", parent, key);
			const ctx = parent.extend();
			if (name === "group") {
				fork = ctx.plugin(group, config);
			} else {
				fork = await this.forkPlugin(name, config, ctx);
			}
			if (!fork) return;
			(fork as LoaderScope).key = key.slice(name.length + 1);
			record[key] = fork;
		}
		const filter = this.interpolate(meta.$filter);
		// 将 $filter 与父级过滤器复合为本 fork 的会话过滤器
		fork.parent.filter = (session) => {
			return (
				parent.filter(session) &&
				(isNullable(filter) || session.resolve(filter))
			);
		};
		return fork;
	}

	/**
	 * 卸载指定引用键对应的插件 fork。
	 */
	unload(ctx: Context, key: string) {
		const fork = (ctx.scope as LoaderScope)[kRecord]?.[key];
		if (fork) fork.dispose();
	}

	/**
	 * 反查某个 fork 在其父作用域记录中的引用键。
	 */
	getRefName(fork: ForkScope): string | undefined {
		const record = (fork.parent.scope as LoaderScope)[kRecord];
		if (!record) return undefined;
		for (const name in record) {
			if (record[name] !== fork) continue;
			return name;
		}
		return undefined;
	}

	/** @deprecated 请改用 resolve() */
	resolvePlugin(name: string) {
		return this.resolve(name);
	}

	/** @deprecated 请改用 reload() */
	reloadPlugin(ctx: Context, key: string, source: any) {
		return this.reload(ctx, key, source);
	}

	/** @deprecated 请改用 unload() */
	unloadPlugin(ctx: Context, key: string) {
		return this.unload(ctx, key);
	}

	/**
	 * 计算某作用域的插件路径（从根到该作用域的 key 序列），
	 * 用于控制台前端定位入口对应的插件位置。
	 */
	paths(scope: EffectScope): string[] {
		// 根作用域：路径为空
		if (scope === scope.parent.scope) return [];

		// 运行时作用域：聚合其全部子 fork 的路径
		if (scope.runtime === scope) {
			return ([] as string[]).concat(
				...scope.runtime.children.map((child) => this.paths(child)),
			);
		}

		const key = (scope as LoaderScope).key;
		if (key) return [key];
		return this.paths(scope.parent.scope);
	}

	/**
	 * 创建应用根上下文并完成全部装配：
	 * 注册 loader 服务、以根组（group:entry）挂载插件表，
	 * 具体的事件订阅与启动消息处理见 wiring.ts。
	 */
	async createApp() {
		new Logger("app").info("%C", `Koishi/${version}`);
		const app = (this.app = new Context(this.interpolate(this.config)));
		app.provide("loader", this, true);
		app.provide("baseDir", this.baseDir, true);
		(app.scope as LoaderScope)[kRecord] = Object.create(null);
		// 整个插件表作为一个根组挂载，entry 即根组上下文
		const fork = await this.reload(app, "group:entry", this.config.plugins);
		if (fork) this.entry = fork.ctx;

		app.accept((config) => {
			app.koishi.config = config;
		});

		// 订阅配置变更与插件生命周期事件以维护配置文件
		wireAppEvents(this, app);

		// 处理 envData 中携带的启动消息
		handleStartMessage(this, app);

		return app;
	}
}
export default Loader;
