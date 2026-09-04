// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 权限系统（ctx.permissions / ctx.perms）。
 *
 * 权限用字符串名称标识，支持带参数的模板（如 `authority:2`、`command:foo`），
 * 模板通过 i18n 模块的 `createMatch` 机制做模式匹配与参数捕获。
 *
 * 核心概念：
 * - define/provide：注册一个权限的"判定函数"（check）；
 * - depends：权限的依赖闭包——要拥有该权限，必须先满足所有依赖；
 * - inherits：权限的继承闭包——满足任一上游权限即视为满足本权限；
 * - test：对一组权限名做完整校验（依赖 + 继承展开）。
 *
 * 框架内置了 `authority:(value)` 用户等级权限，以及两条兜底的 `(name)`
 * 判定（分别委托给适配器的 checkPermission 与本地会话/用户/频道授权列表）。
 */
import { Logger } from "@satorijs/core";
import {
	type Awaitable,
	defineProperty,
	remove,
} from "cosmokit";
import { Context } from "./context/index.ts";
import type { Channel, User } from "./database/index.ts";
import {
	createMatch,
	type MatchResult,
} from "./i18n/index.ts";
import type { Session } from "./session/index.ts";

const logger = new Logger("app");

// 增强目标写包根名而非相对路径，理由见 filter.ts 同款注释
declare module "@koishi-ce/core" {
	interface Context {
		/** 权限服务实例（别名 perms） */
		permissions: Permissions;
	}

	interface Events {
		/** 权限定义发生变化时触发（供控制台等刷新权限列表） */
		"internal/permission"(): void;
	}
}

export namespace Permissions {
	/**
	 * 权限关联（depends / inherits）的取值：
	 * 静态字符串数组，或根据匹配参数动态返回数组的函数。
	 */
	export type Links<P extends string> =
		| undefined
		| string[]
		| ((data: MatchResult<P>) => undefined | string[]);
	/** 权限判定函数：data 为模板匹配捕获的参数，返回是否通过。 */
	export type Check<P extends string> = (
		data: MatchResult<P>,
		session: Partial<Session>,
	) => Awaitable<boolean>;

	export interface Options<P extends string = string> {
		/** 列出该规则覆盖的具体权限名（用于控制台展示与补全） */
		list?: () => string[];
		/** 权限判定函数 */
		check?: Check<P>;
		/** 依赖的其它权限（须全部满足） */
		depends?: Links<P>;
		/** 继承的上游权限（满足其一即通过） */
		inherits?: Links<P>;
	}

	/** store 中的注册项：Options 加上由模板编译出的匹配函数。 */
	export interface Entry extends Options {
		/** 模板匹配函数：输入权限名，匹配失败返回 undefined，成功返回捕获组 */
		match: (string: string) => undefined | MatchResult;
	}

	/** 用户/频道维度的授权配置（通常存在数据库 user / channel 表上）。 */
	export interface Config {
		/** 用户等级（配合 authority:N 权限使用） */
		authority?: number;
		/** 显式授予的权限名列表 */
		permissions?: string[];
		/** 额外依赖的权限名列表 */
		dependencies?: string[];
	}
}

/** 权限服务：管理权限注册表并执行权限校验。 */
export class Permissions {
	/** 全部已注册的权限规则（随定义方插件销毁而自动移除） */
	public store: Permissions.Entry[] = [];
	public ctx: Context;

	constructor(ctx: Context) {
		this.ctx = ctx;
		// 标记当前活跃上下文，供 cordis 依赖注入系统识别服务归属
		defineProperty(this, Context.current, ctx);
		// perms 是 permissions 的别名服务名
		ctx.alias("permissions", ["perms"]);

		// 内置权限：authority:N —— 用户等级达到 N 即通过；
		// 未登录（无 user 记录）时同样放行，由调用方决定是否要求登录
		this.define("authority:(value)", {
			check: ({ value }, { user }: Partial<Session>) => {
				// 调用方只保证 user 是观察对象，预取字段集合由具体会话决定
				return (
					!user ||
					(user as User.Observed)["authority"] >= +value
				);
			},
			list: () =>
				Array(5)
					.fill(0)
					.map((_, i) => `authority:${i}`),
		});

		// 兜底判定 1：委托给适配器（session.bot.checkPermission），
		// 让 QQ 群管理员等平台侧权限也能纳入统一体系
		this.provide("(name)", async ({ name }, session) => {
			return (
				(await session.bot?.checkPermission(
					name,
					session,
				)) ?? false
			);
		});

		// 兜底判定 2：查本地授权列表——会话临时授权 > 用户表 > 频道表
		this.provide(
			"(name)",
			(
				{ name },
				{ permissions, user, channel }: Partial<Session>,
			) => {
				// user / channel 的预取字段由调用方决定，这里按完整表结构
				// 读取（未预取时值为 undefined，不影响判定结果）
				const u = user as User.Observed | undefined;
				const c = channel as Channel.Observed | undefined;
				return !!(
					permissions?.includes(name) ||
					u?.permissions?.includes(name) ||
					c?.permissions?.includes(name)
				);
			},
		);
	}

	/**
	 * 注册一条权限规则。
	 *
	 * @param pattern 权限名模板，`(...)` 为捕获组（如 `authority:(value)`）
	 * @param options 判定与关联配置
	 * @returns 清理函数：随定义方上下文销毁自动注销该规则
	 */
	define<P extends string>(
		pattern: P,
		options: Permissions.Options<P>,
	) {
		const entry: Permissions.Entry = {
			...options,
			match: createMatch(pattern),
		};
		// 无捕获组的字面量权限名，默认在权限列表中展示自身
		if (!pattern.includes("("))
			entry.list ||= () => [pattern];
		return this.ctx.effect(() => {
			this.store.push(entry);
			return () => remove(this.store, entry);
		});
	}

	/** 注册权限判定函数的快捷方式（等价于 define(pattern, { check })）。 */
	provide<P extends string>(
		pattern: P,
		check: Permissions.Check<P>,
	) {
		return this.define(pattern, { check });
	}

	/** 声明权限的继承关系（满足任一上游权限即视为拥有本权限）。 */
	inherit<P extends string>(
		pattern: P,
		inherits: Permissions.Links<P>,
	) {
		return this.define(pattern, { inherits });
	}

	/** 声明权限的依赖关系（须先满足全部依赖才可能拥有本权限）。 */
	depend<P extends string>(
		pattern: P,
		depends: Permissions.Links<P>,
	) {
		return this.define(pattern, { depends });
	}

	/**
	 * 汇总所有规则的 list() 输出，得到全部可用的权限名。
	 *
	 * @param result 提供初始集合（用于多次合并）
	 */
	list(result = new Set<string>()) {
		for (const { list } of this.store) {
			if (!list) continue;
			for (const name of list()) {
				result.add(name);
			}
		}
		return [...result];
	}

	/**
	 * 校验单个权限名（不含依赖/继承展开）。
	 *
	 * 遍历所有规则，凡模板能匹配该名称且 check 通过即视为通过；
	 * check 抛错只记日志并按不通过处理，不中断其它规则。
	 */
	async check(name: string, session: Partial<Session>) {
		const results = await Promise.all(
			this.store.map(async ({ match, check }) => {
				if (!check) return false;
				const data = match(name);
				if (!data) return false;
				try {
					return await check(data, session);
				} catch (error) {
					logger.warn(error);
					return false;
				}
			}),
		);
		return results.some(Boolean);
	}

	/**
	 * 沿 depends 或 inherits 关系做 BFS，求权限名的传递闭包。
	 *
	 * @param type 展开方向：inherits（向上游）或 depends（向依赖）
	 * @param parents 起始权限名集合
	 * @param result 输出集合（传入可复用已有结果）
	 */
	subgraph(
		type: "inherits" | "depends",
		parents: Iterable<string>,
		result = new Set<string>(),
	): Set<string> {
		let name: string | undefined;
		const queue = [...parents];
		while ((name = queue.shift())) {
			if (result.has(name)) continue;
			result.add(name);
			for (const entry of this.store) {
				const data = entry.match(name);
				if (!data) continue;
				let links = entry[type];
				if (typeof links === "function")
					links = links(data);
				if (Array.isArray(links)) queue.push(...links);
			}
		}
		return result;
	}

	/**
	 * 校验一组权限名是否全部满足（权限校验的完整入口）。
	 *
	 * 算法：对每个权限先展开 depends 闭包得到全部前置依赖；
	 * 每个依赖再展开 inherits 闭包得到等价权限集合，其中任意一个
	 * 通过 check 即认为该依赖满足；任一依赖不满足则整体失败。
	 *
	 * @param names 要求的权限名（单个字符串或集合）
	 * @param session 执行校验的会话（可为空对象，做无会话静态判定）
	 * @param cache check 结果缓存，同一批校验中避免重复求值
	 */
	async test(
		names: Iterable<string>,
		session: Partial<Session> = {},
		cache: Map<string, Promise<boolean>> = new Map(),
	) {
		// 若传入的是 shadow 会话（see session.ts 的 Context.shadow），
		// 还原为原始会话再校验，避免代理层干扰
		session =
			((session as unknown as Record<symbol, unknown>)[
				Context.shadow
			] as Partial<Session>) || session;
		if (typeof names === "string") names = [names];
		for (const name of this.subgraph("depends", names)) {
			const parents = [
				...this.subgraph("inherits", [name]),
			];
			const results = await Promise.all(
				parents.map((parent) => {
					// 缓存的是 Promise 而非结果值：并发场景下防重复发起异步判定
					let result = cache.get(parent);
					if (!result) {
						result = this.check(parent, session);
						cache.set(parent, result);
					}
					return result;
				}),
			);
			if (results.some((result) => result)) continue;
			return false;
		}
		return true;
	}
}
