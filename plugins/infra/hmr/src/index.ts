// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 插件热重载插件（hmr，以 watcher 服务挂载到 ctx.watcher）。
 *
 * 基于 @parcel/watcher 原生递归监听工作区文件变动（ignored 规则在
 * 原生层生效，node_modules 等目录不产生事件），对插件做模块级热替换：
 * 1. 入口文件（配置文件 / 环境文件）变动 → 热更新应用配置或整体重启；
 * 2. 框架自身依赖变动（不属于任何插件的模块）→ 只能整体重启；
 * 3. 插件源码变动 → 分析 require 依赖图，仅清理受影响插件的
 *    模块缓存并重载（TS 源码由 Bun 原生即时编译）。
 * 重载失败时回滚 require.cache 与插件状态，保证进程存活。
 */

import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import {
	type Context,
	coerce,
	type Dict,
	type ForkScope,
	type Logger,
	type MainScope,
	makeArray,
	type Plugin,
	Schema,
} from "@koishi-ce/koishi";
import {
	Loader,
	type LoaderScope,
	unwrapExports,
} from "@koishi-ce/loader";
import ParcelWatcher from "@parcel/watcher";
import zhCN from "../locales/zh-CN.yml";
import { handleError } from "./error.ts";

declare module "@koishi-ce/koishi" {
	interface Context {
		watcher: Watcher;
	}

	namespace Context {
		interface Config {
			watch?: Watcher.Config;
		}
	}

	interface Events {
		"hmr/reload"(reloads: Map<Plugin, Reload>): void;
	}
}

/**
 * 判断模块路径是否位于 node_modules 内。
 * win32 下 Bun 的 require.cache 键是反斜杠路径，字面量 includes
 * 从不命中，node_modules 模块会全量混入依赖图引发误重载
 * upstream: koishijs/koishi#1232
 */
export function isInNodeModules(filename: string): boolean {
	return filename.split(/[\\/]/).includes("node_modules");
}

/**
 * 收集某模块及其全部子依赖的文件路径
 * @param filename 入口模块的绝对路径
 * @param ignored 需要排除的文件路径集合
 * @returns 依赖文件路径集合（不含 node_modules 与 ignored 中的文件）
 */
function loadDependencies(
	filename: string,
	ignored: Set<string>,
) {
	const dependencies = new Set<string>();
	function traverse({ filename, children }: NodeJS.Module) {
		if (
			ignored.has(filename) ||
			dependencies.has(filename) ||
			isInNodeModules(filename)
		)
			return;
		dependencies.add(filename);
		children.forEach(traverse);
	}
	const module = require.cache[filename];
	if (module) traverse(module);
	return dependencies;
}

/** 单个待重载插件的记录：入口文件名 + 各 fork 状态到引用名的映射 */
interface Reload {
	filename: string;
	children: Map<ForkScope, string | undefined>;
}

/**
 * 文件监听器：实现插件级 HMR。
 *
 * 依赖 loader 服务，并以 `watcher` 服务名挂载到 ctx（ctx.watcher），
 * 区分“整体重启”（fullReload）与“局部重载”（triggerLocalReload）两种策略。
 */
class Watcher {
	static inject = ["loader"];

	// erasableSyntaxOnly 不允许 namespace 内运行时值,Config 移为类静态属性
	static Config: Schema<Watcher.Config> = Schema.object({
		base: Schema.string(),
		root: Schema.union([
			Schema.array(String).role("table"),
			Schema.transform(String, (value) => [value]),
		]).default(["."]),
		ignored: Schema.union([
			Schema.array(String).role("table"),
			Schema.transform(String, (value) => [value]),
		]).default([
			"**/node_modules/**",
			"**/.git/**",
			"**/logs/**",
		]),
		debounce: Schema.natural().role("ms").default(100),
	}).i18n({
		"zh-CN": zhCN,
	});

	private base: string;
	private subscriptions: ParcelWatcher.AsyncSubscription[] =
		[];
	private debouncedReload?: () => void;
	private require = createRequire(
		require.resolve("@koishi-ce/loader/package.json"),
	);

	/**
	 * 外部文件集合 E：这些文件的变动始终触发整体重启
	 *
	 * - 即根 R -> 外部 E -> 不被任何插件 Q 依赖的模块
	 */
	private externals!: Set<string>;

	/**
	 * 需要重载的文件集合 X
	 *
	 * - 包含所有暂存文件 S
	 * - 某插件 P -> 文件 X ->（直接或间接依赖）某次变动 C
	 */
	private accepted!: Set<string>;

	/**
	 * 不需要重载的文件集合 X
	 *
	 * - 包含所有外部文件 E
	 * - 某次变动 C 与文件 X 之间不存在依赖路径（X 不依赖任何变动 D）
	 */
	private declined!: Set<string>;

	/** 暂存的变动文件（防抖窗口内累积，触发局部重载后清空） */
	private stashed = new Set<string>();

	private logger: Logger;

	private ctx: Context;
	private config: Watcher.Config;

	constructor(ctx: Context, config: Watcher.Config) {
		this.ctx = ctx;
		this.config = config;
		this.base = resolve(ctx.baseDir, config.base || "");
		this.logger = ctx.logger("hmr");
		ctx.provide("watcher", this);
		ctx.on("ready", () => this.start());
		ctx.on("dispose", () => this.stop());
	}

	/** 将绝对路径转换为相对监听根目录的展示路径 */
	relative(filename: string) {
		if (!this.base) return filename;
		return relative(this.base, filename);
	}

	/** 启动文件监听（root 列表相对 base 目录解析，逐条目建立原生订阅） */
	async start() {
		const { loader } = this.ctx;

		// 框架自身（koishi 入口）的依赖集合：这些文件不属于任何插件，变动时只能整体重启
		this.externals = loadDependencies(
			require.resolve("@koishi-ce/koishi"),
			new Set(Object.values(loader.cache)),
		);
		this.debouncedReload = this.ctx.debounce(
			() => this.triggerLocalReload(),
			this.config.debounce ?? 0,
		);
		this.subscriptions = (
			await Promise.all(
				makeArray(this.config.root ?? ["."]).map((entry) =>
					this.subscribe(resolve(this.base, entry)),
				),
			)
		).filter(
			(sub): sub is ParcelWatcher.AsyncSubscription =>
				sub !== null,
		);
	}

	/**
	 * 订阅单个监听根：目录直接订阅；文件条目订阅其所在目录并过滤到该文件
	 * @param subject 监听根的绝对路径
	 * @returns 原生订阅句柄；条目不存在时为 null（不视为错误）
	 */
	private async subscribe(subject: string) {
		let target = subject;
		let filter: ((path: string) => boolean) | undefined;
		try {
			if (statSync(subject).isFile()) {
				target = dirname(subject);
				filter = (path) => path === subject;
			}
		} catch {
			this.logger.debug(
				"watch subject not found:",
				subject,
			);
			return null;
		}
		return ParcelWatcher.subscribe(
			target,
			(err, events) => {
				if (err) {
					this.logger.warn(err);
					return;
				}
				// 仅内容变更进入重载流程（新建/删除文件不触发），
				// 与 chokidar 时代只监听 change 事件的行为对齐
				for (const { type, path } of events) {
					if (type !== "update") continue;
					if (filter && !filter(path)) continue;
					this.handleChange(path);
				}
			},
			{
				...this.config,
				ignore: makeArray(this.config.ignored),
			},
		);
	}

	/** 处理单条文件变动：入口文件 / 外部依赖 / 插件源码三类分派 */
	private async handleChange(path: string) {
		const { loader } = this.ctx;
		const filename = resolve(this.base, path);
		const isEntry =
			filename === loader.filename ||
			loader.envFiles.includes(filename);
		// loader 写回配置文件时置 suspend，跳过这一次自身触发的变动
		if (loader.suspend && isEntry) {
			loader.suspend = false;
			return;
		}

		this.logger.debug("change detected:", path);

		if (isEntry) {
			// 入口文件变动：配置模块已加载过只能整体重启；否则热更新应用配置
			if (require.cache[filename]) {
				this.ctx.loader.fullReload();
			} else {
				const config = await loader.readConfig();
				this.ctx.root.state.update(config);
				this.ctx.emit("config");
			}
		} else {
			// 普通文件变动：外部依赖只能整体重启，其余暂存后走防抖的局部重载
			if (this.externals.has(filename)) {
				this.ctx.loader.fullReload();
			} else if (require.cache[filename]) {
				this.stashed.add(filename);
				this.debouncedReload?.();
			}
		}
	}

	async stop() {
		await Promise.all(
			this.subscriptions.map((sub) => sub.unsubscribe()),
		);
		this.subscriptions = [];
	}

	/** 沿 require 依赖图自底向上传播：任一子模块 accepted 则本模块 accepted，全部 declined 才 declined */
	private analyzeChanges() {
		/** 尚未定论的待分类文件 */
		const pending: string[] = [];

		this.accepted = new Set(this.stashed);
		this.declined = new Set(this.externals);

		this.stashed.forEach((filename) => {
			const module = require.cache[filename];
			if (!module) return;
			const { children } = module;
			for (const { filename } of children) {
				if (
					this.accepted.has(filename) ||
					this.declined.has(filename) ||
					isInNodeModules(filename)
				)
					continue;
				pending.push(filename);
			}
		});

		while (pending.length) {
			let index = 0,
				hasUpdate = false;
			while (index < pending.length) {
				const filename = pending[index];
				if (filename === undefined) {
					index++;
					continue;
				}
				const module = require.cache[filename];
				if (!module) {
					index++;
					continue;
				}
				const { children } = module;
				let isDeclined = true,
					isAccepted = false;
				for (const { filename } of children) {
					// 忽略已判定为 declined 的子模块
					if (
						this.declined.has(filename) ||
						isInNodeModules(filename)
					)
						continue;
					if (this.accepted.has(filename)) {
						// 任一子模块 accepted，则本模块也 accepted
						isAccepted = true;
						break;
					} else {
						// 子模块既非 accepted 也非 declined，需要继续向下分析
						isDeclined = false;
						if (!pending.includes(filename)) {
							hasUpdate = true;
							pending.push(filename);
						}
					}
				}
				if (isAccepted || isDeclined) {
					hasUpdate = true;
					pending.splice(index, 1);
					if (isAccepted) {
						this.accepted.add(filename);
					} else {
						// 全部子模块 declined，则本模块也 declined
						this.declined.add(filename);
					}
				} else {
					index++;
				}
			}
			// 一轮下来毫无进展则退出，避免死循环
			if (!hasUpdate) break;
		}

		// 循环结束后仍未定论的文件（如循环依赖）一律视为 declined
		for (const filename of pending) {
			this.declined.add(filename);
		}
	}

	/** 执行局部重载：分析依赖、锁定受影响插件、重建模块缓存并重载插件 */
	private triggerLocalReload() {
		this.analyzeChanges();

		/** 待分类的插件 */
		const pending = new Map<
			string,
			[Plugin, MainScope | undefined]
		>();

		/** 需要重载的插件 */
		const reloads = new Map<Plugin, Reload>();

		// 假设插件入口文件是“原子”的，即重载它不会连带引发其他插件的重载
		for (const filename of Object.values(
			this.ctx.loader.cache,
		)) {
			const module = require.cache[filename];
			if (!module) continue;
			// loader 的 unwrapExports 返回 unknown（导出形态动态），此处收窄为插件
			const plugin = unwrapExports(module.exports) as
				| Plugin
				| undefined;
			if (!plugin || this.declined.has(filename)) continue;
			const runtime = this.ctx.registry.get(plugin);
			pending.set(filename, [plugin, runtime]);
			this.declined.add(filename);
		}

		for (const [filename, [plugin, runtime]] of pending) {
			// 检查该插件是否（直接或间接）依赖了变动的文件
			this.declined.delete(filename);
			const dependencies = [
				...loadDependencies(filename, this.declined),
			];
			this.declined.add(filename);

			// 只在插件级别判定重载：任一依赖被 accepted 即重载整个插件
			if (
				!dependencies.some((dep) => this.accepted.has(dep))
			)
				continue;
			dependencies.forEach((dep) => this.accepted.add(dep));

			// 准备重载：遍历插件的 fork 子树，记录各 fork 的状态与引用名
			if (runtime) {
				let isMarked = false;
				const visited = new Set<MainScope>();
				const queued = [runtime];
				while (queued.length) {
					const runtime = queued.shift();
					if (!runtime) continue;
					if (visited.has(runtime)) continue;
					visited.add(runtime);
					if (reloads.has(plugin)) {
						isMarked = true;
						break;
					}
					for (const state of runtime.children) {
						queued.push(state.runtime);
					}
				}
				if (!isMarked) {
					const children = new Map<
						ForkScope,
						string | undefined
					>();
					reloads.set(plugin, { filename, children });
					for (const state of runtime.children) {
						children.set(
							state,
							this.ctx.loader.getRefName(state),
						);
					}
				}
			} else {
				reloads.set(plugin, {
					filename,
					children: new Map(),
				});
			}
		}

		// 备份 require.cache 以便回滚；重新 require 前先删除模块缓存
		const backup: Dict<NodeJS.Module> = {};
		for (const filename of this.accepted) {
			const module = require.cache[filename];
			if (module) backup[filename] = module;
			delete require.cache[filename];
		}

		/** 回滚 require.cache */
		function rollback() {
			for (const filename in backup) {
				require.cache[filename] = backup[filename];
			}
		}

		// 重新加载各插件入口的产物缓存（TS 源码此时由 Bun 原生即时编译）；
		// 刚 require 出的模块形态由运行时决定，断言为 Plugin 交由后续流程校验
		const attempts: Dict<Plugin> = {};
		try {
			for (const [, { filename }] of reloads) {
				attempts[filename] = unwrapExports(
					this.require(filename),
				) as Plugin;
			}
		} catch (e) {
			handleError(e, this.logger);
			return rollback();
		}

		// 在替换 loader 缓存前发出 hmr/reload 事件，供其他插件同步状态
		this.ctx.emit("hmr/reload", reloads);

		try {
			for (const [
				plugin,
				{ filename, children },
			] of reloads) {
				const path = this.relative(filename);

				try {
					this.ctx.registry.delete(plugin);
				} catch (err) {
					this.logger.warn(
						`failed to dispose plugin at %c\n${coerce(err)}`,
						path,
					);
				}

				// 替换 loader 缓存，保证 keyFor 等方法取到新插件
				// （attempts 的键集与 reloads 完全一致，上方循环保证已写入，断言安全）
				this.ctx.loader.replace(
					plugin,
					attempts[filename] as Plugin,
				);

				try {
					for (const [state, name] of children) {
						const fork = state.parent.plugin(
							attempts[filename] as Plugin,
							state.config,
						);
						const key = (state as LoaderScope).key;
						if (key !== undefined)
							(fork as LoaderScope).key = key;
						if (name) {
							const record = ((
								state.parent.scope as LoaderScope
							)[Loader.kRecord] ??= Object.create(null));
							record[name] = fork;
						}
					}
					this.logger.info("reload plugin at %c", path);
				} catch (err) {
					this.logger.warn(
						`failed to reload plugin at %c\n${coerce(err)}`,
						path,
					);
					throw err;
				}
			}
		} catch {
			// 重载中途失败：回滚 require.cache，并用旧插件对象逐一恢复各 fork 状态
			rollback();
			for (const [
				plugin,
				{ filename, children },
			] of reloads) {
				try {
					this.ctx.registry.delete(
						attempts[filename] as Plugin,
					);
					for (const [state, name] of children) {
						const fork = state.parent.plugin(
							plugin,
							state.config,
						);
						const key = (state as LoaderScope).key;
						if (key !== undefined)
							(fork as LoaderScope).key = key;
						if (name) {
							const record = ((
								state.parent.scope as LoaderScope
							)[Loader.kRecord] ??= Object.create(null));
							record[name] = fork;
						}
					}
				} catch (err) {
					this.logger.warn(err);
				}
			}
			return;
		}

		// 重载全部成功，清空暂存文件
		this.stashed = new Set();
	}
}

// erasableSyntaxOnly:纯类型 namespace(运行时值 Config 由类静态属性承载)
namespace Watcher {
	export interface Config extends ParcelWatcher.Options {
		base?: string;
		root?: string[];
		debounce?: number;
		ignored?: string[];
	}
}

export default Watcher;
