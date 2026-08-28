/**
 * 命令模块出口：汇总导出 Command / Commander 及解析器子模块，
 * 并通过模块补充（module augmentation）向 Context 注入
 * `ctx.command()` / `ctx.$commander` 服务与命令相关事件声明。
 */

import type { Awaitable, Fragment } from "@satorijs/core";
import type { Channel, User } from "../database";
import type { Session } from "../session";
import type { Command } from "./command";
import type { Commander } from "./commander";
import type { Argv } from "./parser";

export * from "./command";
export * from "./commander";
export { CommanderCore } from "./commander-core";
export { CommanderRegister } from "./commander-register";
export { CommanderResolve } from "./commander-resolve";
export * from "./parser";
export * from "./validate";

declare module "../context" {
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
		"command-error"(argv: Argv, error: any): void;
		/** 命令执行前的钩子（即内置的第一个 checker）；返回值可短路执行 */
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
