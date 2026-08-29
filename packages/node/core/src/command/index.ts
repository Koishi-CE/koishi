/**
 * 命令模块出口：汇总导出 Command / Commander 及解析器子模块，
 * 并通过模块补充（module augmentation）向 Context 注入
 * `ctx.command()` / `ctx.$commander` 服务与命令相关事件声明。
 */

import type { Awaitable, Fragment } from "@satorijs/core";
import type { Channel, User } from "../database/index.ts";
import type { Session } from "../session/index.ts";
import type { Command } from "./command/command.ts";
import type { Commander } from "./commander/commander.ts";
import type { Argv } from "./parser/index.ts";

export * from "./command/command.ts";
export * from "./commander/commander.ts";
export { CommanderCore } from "./commander/core.ts";
export { CommanderRegister } from "./commander/register.ts";
export { CommanderResolve } from "./commander/resolve.ts";
export * from "./parser/index.ts";
export * from "./validate.ts";

// 增强目标写包根名而非相对路径，理由见 filter.ts 同款注释
declare module "@koishi-ce/core" {
	interface Context {
		/** 命令服务：全局唯一的命令注册表与解析入口 */
		$commander: Commander;
		/**
		 * 注册（或更新）一个命令。
		 * @param def 命令定义，形如 "foo.bar <arg> [opt:text]"，
		 *   路径部分支持 "." 与 "/" 两种分隔写法
		 * @param desc 命令描述（用于 help 与控制台展示）
		 * @param config 命令配置
		 * @returns 已注册的命令实例；同名重复注册会合并更新
		 */
		command<D extends string>(
			def: D,
			config?: Command.Config,
		): Command<never, never, Argv.ArgumentType<D>>;
		command<D extends string>(
			def: D,
			desc: string,
			config?: Command.Config,
		): Command<never, never, Argv.ArgumentType<D>>;
	}

	interface Events {
		/** 消息解析前触发；返回 Argv 可接管默认 tokenize 行为 */
		"before-parse"(content: string, session: Session): Argv | undefined;
		/** 新命令注册完成 */
		"command-added"(command: Command): void;
		/** 命令的别名 / 选项等定义发生变更 */
		"command-updated"(command: Command): void;
		/** 命令被销毁 */
		"command-removed"(command: Command): void;
		/** 命令执行抛出未被 handleError 接管的异常 */
		"command-error"(argv: Argv, error: unknown): void;
		/** 命令执行前的钩子（即内置的第一个 checker）；返回值可短路执行 */
		// biome-ignore lint/suspicious/noConfusingVoidType: 事件负载：void 表示不短路、Fragment 表示拦截输出，改为 undefined 会破坏 void 返回监听器的可赋值性
		"command/before-execute"(argv: Argv): Awaitable<void | Fragment>;
		/** 数据库频道字段观测收集（session.observeChannel 前触发） */
		"command/before-attach-channel"(
			argv: Argv,
			fields: Set<Channel.Field>,
		): void;
		/** 数据库用户字段观测收集（session.observeUser 前触发） */
		"command/before-attach-user"(argv: Argv, fields: Set<User.Field>): void;
	}
}
