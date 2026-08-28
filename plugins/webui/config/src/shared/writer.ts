/**
 * 配置写入器（服务端共享实现）。
 *
 * 本模块是 config 插件的核心：以 `config` 数据服务的形式把 loader 中的
 * 应用配置（koishi.yml / koishi.json）推送到浏览器端控制台，并把前端
 * 发来的 `manager/*` 事件（重载、停用、移除、改名、拖拽移动等）落实为
 * 对内存中配置对象的修改，再由 loader.writeConfig() 持久化回配置文件。
 *
 * 由于 YAML/JSON 对象的键顺序即插件在配置文件中的书写顺序，本模块中的
 * 多个辅助函数（insertKey / rename / dropKey）都围绕"在保持键顺序的
 * 前提下增删改键"这一目标实现。
 */
import { DataService } from "@koishi-ce/console";
import { type Context, Logger, remove } from "@koishi-ce/koishi";
import { Loader, type LoaderScope } from "@koishi-ce/loader";

// 声明合并：浏览器端通过 WebSocket 发送的 manager/* 事件及其载荷类型。
// 服务端在构造函数中为每个事件注册监听器，见下方 ConfigWriter 构造函数。
declare module "@koishi-ce/console" {
	interface Events {
		"manager/app-reload"(config: any): void;
		"manager/teleport"(
			source: string,
			key: string,
			target: string,
			index: number,
		): void;
		"manager/reload"(parent: string, key: string, config: any): void;
		"manager/unload"(
			parent: string,
			key: string,
			config: any,
			index?: number,
		): void;
		"manager/remove"(parent: string, key: string): void;
		"manager/meta"(ident: string, config: any): void;
	}
}

const logger = new Logger("loader");

/**
 * 把 temp 中的键插入到 object 的开头（原有 rest 键依次后移），用于在
 * 不破坏其它键相对顺序的前提下完成"插入到指定位置"的配置操作。
 *
 * 实现方式是先把 rest 中的键全部搬到 temp 里，再用 Object.assign 合并回来。
 *
 * @param object 目标配置对象（会被原地修改）
 * @param temp 待插入的键值对
 * @param rest 需要让位的既有键名列表
 */
function insertKey(
	object: Record<string, any>,
	temp: Record<string, any>,
	rest: string[],
) {
	for (const key of rest) {
		temp[key] = object[key];
		delete object[key];
	}
	Object.assign(object, temp);
}

/**
 * 在对象中把键 old 重命名为 neo（并可顺带替换其值），且保持键原有的位置。
 *
 * @param object 目标配置对象
 * @param old 旧键名（可为 `"~" + name` 形式的停用态键）
 * @param neo 新键名
 * @param value 新键对应的值
 */
function rename(object: any, old: string, neo: string, value: any) {
	const keys = Object.keys(object);
	const index = keys.findIndex((key) => key === old || key === "~" + old);
	const rest = index < 0 ? [] : keys.slice(index + 1);
	const temp = { [neo]: value };
	delete object[old];
	delete object["~" + old];
	insertKey(object, temp, rest);
}

/**
 * 从 plugins 配置中摘除指定的键（兼容 `~` 前缀的停用态键），返回以该键
 * 为唯一成员的对象，便于随后通过 insertKey 插入到别处（teleport 场景）。
 *
 * @param plugins 插件配置对象
 * @param name 插件键名
 */
function dropKey(plugins: Record<string, any>, name: string) {
	if (!(name in plugins)) {
		name = "~" + name;
	}
	const value = plugins[name];
	delete plugins[name];
	return { [name]: value };
}

/**
 * 配置写入器服务。以 `config` 为服务名向控制台暴露当前应用配置，
 * 并接收前端 `manager/*` 事件来修改配置文件。所有事件均要求
 * authority 达到 4（管理员）。
 */
export class ConfigWriter extends DataService<Context.Config> {
	protected loader: Loader;

	constructor(ctx: Context) {
		super(ctx, "config", { authority: 4 });
		this.loader = ctx.loader;

		// 全局配置保存：整份替换 koishi 配置后触发应用全量重载
		ctx.console.addListener(
			"manager/app-reload",
			(config) => {
				return this.reloadApp(config);
			},
			{ authority: 4 },
		);

		// 其余五个事件签名各异，这里统一注册：转发到同名方法并统一错误处理
		for (const key of [
			"teleport",
			"reload",
			"unload",
			"remove",
			"meta",
		] as const) {
			ctx.console.addListener(
				`manager/${key}`,
				async (...args: any[]) => {
					try {
						// 五个方法签名各异,统一视为泛化调用目标后 apply
						const action = this[key] as (...args: unknown[]) => Promise<void>;
						await action.apply(this, args);
					} catch (error) {
						logger.error(error);
						throw new Error("failed");
					}
				},
				{ authority: 4 },
			);
		}

		ctx.on("config", () => this.refresh());
	}

	/**
	 * 递归过滤并整理某层上下文的插件配置，得到可安全下发给前端的副本。
	 *
	 * - 过滤掉内部保留键（`$` 开头，如 `$folded`）；
	 * - 剔除 `$if` 条件不成立的插件项（停用插件以 `~` 前缀 + `$if-disabled`
	 *   表示，`isTruthyLike` 为假说明该项已不被加载）；
	 * - 对 `group:xxx` 分组键递归处理其子插件。
	 *
	 * @param plugins 某层上下文的 plugins 配置对象
	 * @param ctx 该层对应的运行时上下文（用于查找 fork 记录）
	 */
	getGroup(plugins: any, ctx: Context) {
		const result = { ...plugins };
		for (const key in plugins) {
			if (key.startsWith("$")) continue;
			const value = plugins[key];
			const name = (key.split(":", 1)[0] ?? "").replace(/^~/, "");

			if (!this.loader.isTruthyLike(value?.$if)) {
				// $if-disabled 的插件不应显示在配置树中
				// https://github.com/koishijs/webui/issues/249
				delete result[key];
				continue;
			}

			// 处理插件分组：分组本身是个子上下文，需要递归
			const fork = (ctx.scope as LoaderScope)[Loader.kRecord]?.[key];
			if (!fork) continue;
			if (name === "group") {
				result[key] = this.getGroup(value, fork.ctx);
			}
		}
		return result;
	}

	/** 数据服务读取入口：返回去除敏感内部键后的整份应用配置。 */
	override async get() {
		const result: Context.Config = { ...this.loader.config };
		result.plugins = this.getGroup(result.plugins, this.loader.entry);
		return result;
	}

	/**
	 * 保存全局设置：用前端提交的整份配置替换当前配置（保留原有的 plugins
	 * 部分），写回配置文件后执行全量重载（进程内重启全部插件）。
	 *
	 * @param config 前端提交的应用级配置（不含 plugins）
	 */
	async reloadApp(config: any) {
		delete config.$paths;
		const plugins = this.loader.config.plugins;
		this.loader.config = config;
		// exactOptionalPropertyTypes 禁止向可选属性显式赋 undefined,
		// 用 Object.assign 保持"以旧 plugins(含 undefined)整体覆盖"的原语义
		Object.assign(this.loader.config, { plugins });
		await this.loader.writeConfig();
		this.loader.fullReload();
	}

	/**
	 * 根据路径标识查找对应的 fork 作用域。
	 *
	 * 前端用"分组路径"（如 `group:abc` 的 `abc`）标识每个上下文：空串代表
	 * 根作用域，否则在所有已注册插件的子作用域中按 fork.key 匹配。
	 *
	 * @param ident 分组路径（空串表示根）
	 * @returns 对应的 ForkScope，找不到时返回 undefined
	 */
	private resolveFork(ident: string) {
		if (!ident) return this.loader.entry.scope;
		for (const main of this.ctx.registry.values()) {
			for (const fork of main.children) {
				// fork 的 key 由 loader 写入(ForkScope 类型上没有该属性)
				if ((fork as LoaderScope).key === ident) return fork;
			}
		}
		return;
	}

	/**
	 * 在配置文件中按路径标识递归定位插件条目。
	 *
	 * @param ident 插件的路径标识（键去掉 `name:` 前缀后的部分）
	 * @param config 当前层级的 plugins 配置（递归时传入分组内部）
	 * @returns [所在配置对象, 完整键名] 二元组
	 * @throws 找不到时抛出 "plugin not found"
	 */
	private resolveConfig(
		ident: string,
		config = this.loader.config.plugins,
	): [any, string] {
		for (const key in config) {
			const name = key.split(":", 1)[0] ?? "";
			if (key.slice(name.length + 1) === ident) return [config, key];
			if (name === "group" || name === "~group") {
				try {
					return this.resolveConfig(ident, config[key]);
				} catch {}
			}
		}
		throw new Error("plugin not found");
	}

	/**
	 * 更新插件的元数据键（`$` 开头的内部控制字段，如 `$label`、`$collapsed`）。
	 *
	 * config 中值为 null 的键表示删除；其余键覆盖写入并置于该插件配置的
	 * 开头位置。仅写盘（writeConfig(true) 触发静默刷新），不重载插件。
	 *
	 * @param ident 插件路径标识
	 * @param config 待合并的元数据键值对
	 */
	async meta(ident: string, config: any) {
		const [parent, key] = this.resolveConfig(ident);
		const target = parent[key];
		for (const key of Object.keys(config)) {
			delete target[key];
			if (config[key] === null) {
				delete config[key];
			}
		}
		insertKey(target, config, Object.keys(target));
		await this.loader.writeConfig(true);
	}

	/**
	 * （重新）加载插件：用提交的配置替换内存中的插件配置，先热重载再写盘。
	 *
	 * @param parent 所属分组的路径标识（空串为根）
	 * @param key 插件键名（形如 `name:ident`）
	 * @param config 新的插件配置
	 */
	async reload(parent: string, key: string, config: any) {
		const scope = this.resolveFork(parent);
		if (!scope) throw new Error("plugin not found");
		await this.loader.reload(scope.ctx, key, config);
		rename(scope.config, key, key, config);
		await this.loader.writeConfig();
	}

	/**
	 * 停用插件：卸载运行时并把配置键改写为 `~` 前缀（保留配置以便再启用）。
	 *
	 * 传入 index 时（克隆配置场景）把停用键插入到指定位置而非原位重命名。
	 *
	 * @param parent 所属分组的路径标识
	 * @param key 插件键名
	 * @param config 停用时保留的插件配置
	 * @param index 可选的目标插入位置（在父配置的键序列中的序号）
	 */
	async unload(parent: string, key: string, config = {}, index?: number) {
		const scope = this.resolveFork(parent);
		if (!scope) throw new Error("plugin not found");
		this.loader.unload(scope.ctx, key);
		if (index) {
			const rest = Object.keys(scope.config).slice(index);
			insertKey(scope.config, { ["~" + key]: config }, rest);
		} else {
			rename(scope.config, key, "~" + key, config);
		}
		await this.loader.writeConfig();
	}

	/**
	 * 移除插件：卸载运行时并从配置文件中彻底删除对应键（含 `~` 停用态）。
	 *
	 * @param parent 所属分组的路径标识
	 * @param key 插件键名
	 */
	async remove(parent: string, key: string) {
		const scope = this.resolveFork(parent);
		if (!scope) throw new Error("plugin not found");
		this.loader.unload(scope.ctx, key);
		const config = scope.config as Record<string, any>;
		delete config[key];
		delete config["~" + key];
		await this.loader.writeConfig();
	}

	/**
	 * 拖拽移动插件：把插件从 source 分组搬到 target 分组的 index 位置。
	 *
	 * 分两步：
	 * 1. 迁移运行时 fork（改挂父作用域、迁移 disposables、修正原型链，
	 *    若注入的服务在两个分组中取值不同则重启该 fork）；
	 * 2. 迁移配置键（dropKey 摘出后 insertKey 插入目标位置）。
	 *
	 * @param source 源分组的路径标识（空串为根）
	 * @param key 被移动的插件键名
	 * @param target 目标分组的路径标识
	 * @param index 目标插入位置（目标分组键序列中的序号）
	 */
	async teleport(source: string, key: string, target: string, index: number) {
		const parentS = this.resolveFork(source);
		const parentT = this.resolveFork(target);
		if (!parentS || !parentT) throw new Error("plugin not found");

		// 第一步：迁移运行时 fork（仅在跨分组时需要）
		const fork = (parentS as LoaderScope)[Loader.kRecord]?.[key];
		if (fork && parentS !== parentT) {
			const sourceRecord = ((parentS as LoaderScope)[Loader.kRecord] ??=
				Object.create(null));
			delete sourceRecord[key];
			const targetRecord = ((parentT as LoaderScope)[Loader.kRecord] ??=
				Object.create(null));
			targetRecord[key] = fork;
			remove(parentS.disposables, fork.dispose);
			parentT.disposables.push(fork.dispose);
			fork.parent = parentT.ctx;
			Object.setPrototypeOf(fork.ctx, parentT.ctx);
			fork.ctx.emit("internal/fork", fork);
			// scope 实例是转发到 config 的 Proxy,用 Reflect.get 保持原读取语义
			if (
				Object.keys(fork.runtime.inject).some(
					(name) => Reflect.get(parentS, name) !== Reflect.get(parentT, name),
				)
			) {
				fork.restart();
			}
		}

		// 第二步：迁移配置键，把摘出的键插入目标分组对应位置后写盘
		const temp = dropKey(parentS.config, key);
		const rest = Object.keys(parentT.config).slice(index);
		insertKey(parentT.config, temp, rest);
		await this.loader.writeConfig();
	}
}
