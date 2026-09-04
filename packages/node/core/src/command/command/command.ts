// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Command：面向使用者的完整命令类（执行引擎 + 配置 schema）。
 *
 * 继承链 CommandBase → CommandCore → CommandDefinition → Command，
 * 本文件补充最上层的执行与序列化能力：
 * - `execute`：checker 校验 + action 洋葱模型的执行管线与错误处理；
 * - `dispose`：级联销毁子命令并从注册表移除；
 * - `toJSON`：导出为 Universal.Command（供平台侧斜线指令同步）；
 * - `Command.Config` schema 与 Alias / Shortcut / Action 等类型声明。
 */

import { coerce } from "@koishi-ce/utils";
import {
	type Fragment,
	Logger,
	Schema,
	type Universal,
} from "@satorijs/core";
import {
	type Awaitable,
	type Dict,
	isNullable,
	remove,
} from "cosmokit";
import type {
	Channel,
	User,
} from "../../database/index.ts";
import type { Computed } from "../../filter.ts";
import {
	Next,
	SessionError,
} from "../../middleware/index.ts";
import type { Permissions } from "../../permission.ts";
import type { Session } from "../../session/index.ts";
import { normalizeCommand } from "../normalize.ts";
import type { Argv, CommandBase } from "../parser/index.ts";
import { CommandDefinition } from "./definition.ts";

const logger = new Logger("command");

/** 向选项类型 O 中并入键 K（值类型 T），用于 option() 的类型收窄 */
export type Extend<O extends {}, K extends string, T> = {
	[P in K | keyof O]?: (P extends keyof O
		? O[P]
		: unknown) &
		(P extends K ? T : unknown);
};

export class Command<
	U extends User.Field = never,
	G extends Channel.Field = never,
	A extends unknown[] = unknown[],
	O extends object = object,
> extends CommandDefinition<U, G, A, O> {
	/** 命令名归一化：小写 + 下划线转连字符 */
	static normalize(name: string) {
		return normalizeCommand(name);
	}

	// 值侧由类静态承载(erasableSyntaxOnly 不允许 namespace 内运行时值)
	/** 命令配置的 schema 定义（控制台配置面板使用） */
	static Config: Schema<Command.Config> = Schema.object({
		permissions: Schema.array(String)
			.role("perms")
			.default(["authority:1"])
			.description("权限继承。"),
		dependencies: Schema.array(String)
			.role("perms")
			.description("权限依赖。"),
		slash: Schema.boolean()
			.description("启用斜线指令功能。")
			.default(true),
		captureQuote: Schema.boolean()
			.description("是否捕获引用文本。")
			.default(true)
			.hidden(),
		checkUnknown: Schema.boolean()
			.description("是否检查未知选项。")
			.default(false)
			.hidden(),
		checkArgCount: Schema.boolean()
			.description("是否检查参数数量。")
			.default(false)
			.hidden(),
		showWarning: Schema.boolean()
			.description("是否显示命令警告。")
			.default(true)
			.hidden(),
		handleError: Schema.union([
			Schema.boolean(),
			Schema.function(),
		])
			.description("是否处理错误。")
			.default(true)
			.hidden(),
	});

	/**
	 * 执行命令：完整走一遍「校验 → action 链」管线。
	 *
	 * @param argv 已解析的参数上下文（command / args / options 就位）
	 * @param fallback action 链全部透传后兜底的 next 函数，默认直接返回空
	 *
	 * checker 返回非空值即中止；action 之间通过 argv.next 洋葱式传递。
	 * 异常处理顺序：SessionError 转为用户文案 → 记日志并广播 command-error
	 * → 交给 config.handleError（函数接管或返回通用错误提示）；
	 * 若异常发生在 fallback（index === length）则原样上抛不接管。
	 */
	async execute(
		argv: Argv<U, G, A, O>,
		fallback: Next = Next.compose,
	): Promise<Fragment> {
		argv.command ??= this;
		const args = (argv.args ??= [] as unknown as A);
		const options = (argv.options ??= {} as O);
		const { error } = argv;
		// 解析阶段已产生错误（如类型转换失败）：直接把错误文案作为回复
		if (error) return error;
		if (logger.level >= 3)
			logger.debug(
				(argv.source ||= this.stringify(args, options)),
			);

		// 前置校验：任一 checker 返回非空值即短路返回
		for (const validator of this._checkers) {
			// _checkers 存储为擦除签名（见 definition.ts 的 ErasedAction），
			// 以 apply + 数组断言还原当前命令的实参（与 .call 语义一致）
			const result = await validator.apply(this, [
				argv,
				...args,
			] as never);
			if (!isNullable(result)) return result as Fragment;
		}

		// FIXME: 空 action 列表会导致无限循环，此处提前返回规避
		if (!this._actions.length) return "";

		let index = 0;
		const queue: Next.Queue = this._actions.map(
			(action) => async () => {
				return await action.apply(this, [
					argv,
					...args,
				] as never);
			},
		);

		queue.push(fallback);
		const length = queue.length;
		argv.next = async (callback) => {
			if (callback !== undefined) {
				queue.push((next) => Next.compose(callback, next));
				if (queue.length > Next.MAX_DEPTH) {
					throw new Error(
						`middleware stack exceeded ${Next.MAX_DEPTH}`,
					);
				}
			}
			return queue[index++]?.(argv.next);
		};

		try {
			const result = await argv.next();
			if (!isNullable(result)) return result;
		} catch (err) {
			// 异常来自 fallback 本身（action 已全部执行完）：不接管，向上抛
			if (index === length) throw err;
			if (err instanceof SessionError) {
				return (
					argv.session?.text(err.path, err.param) ?? ""
				);
			}
			const stack = coerce(err);
			logger.warn(
				`${(argv.source ||= this.stringify(args, options))}\n${stack}`,
			);
			this.ctx.emit(
				argv.session,
				"command-error",
				argv,
				err,
			);
			if (typeof this.config.handleError === "function") {
				const result = await this.config.handleError(
					err as Error,
					argv,
				);
				if (!isNullable(result)) return result;
			} else if (this.config.handleError) {
				return (
					argv.session?.text(
						"internal.error-encountered",
					) ?? ""
				);
			}
		}

		return "";
	}

	/**
	 * 销毁命令：执行全部清理回调、广播 command-removed、
	 * 级联销毁子命令，并从命令列表与父命令中移除自身。
	 */
	dispose() {
		this._disposables
			.splice(0)
			.forEach((dispose) => dispose());
		this.ctx.emit("command-removed", this);
		for (const cmd of this.children.slice()) {
			cmd.dispose();
		}
		remove(this.ctx.$commander._commandList, this);
		this.parent = null;
	}

	/** 序列化为平台无关的命令描述（同步给 Telegram 等平台的斜线指令） */
	toJSON(): Universal.Command {
		return {
			name: this.name,
			description: this.ctx.i18n.get(
				`commands.${this.name}.description`,
			),
			arguments: this._arguments.map((arg) => ({
				name: arg.name ?? this.name,
				type: toStringType(arg.type ?? "string"),
				description: this.ctx.i18n.get(
					`commands.${this.name}.arguments.${arg.name}`,
				),
				required: arg.required ?? false,
			})),
			options: Object.entries(this._options).map(
				([name, option]) => ({
					name,
					type: toStringType(option.type ?? "string"),
					description: this.ctx.i18n.get(
						`commands.${this.name}.options.${name}`,
					),
					required: option.required ?? false,
				}),
			),
			children: this.children
				.filter((child) => child.name.includes("."))
				.map((child) => child.toJSON()),
		};
	}
}

/** 非字符串类型（正则 / 枚举 / 函数等）在序列化时统一降级为 "string" */
function toStringType(type: Argv.Type) {
	return typeof type === "string" ? type : "string";
}

export namespace Command {
	/**
	 * 命令别名的附加配置：通过 `cmd.alias(name, options)` 注册时
	 * 可为该别名预设触发参数与可见性过滤。
	 */
	export interface Alias {
		/** 该别名触发时预设的选项 */
		options?: Dict;
		/** 该别名触发时预设的参数 */
		args?: string[];
		/** 会话可见性过滤（Computed），如限定频道 / 用户 */
		filter?: Computed<boolean>;
	}

	/** @deprecated 快捷方式配置（请改用 alias + Command.Alias） */
	export interface Shortcut {
		/** 模式是否按 i18n 键解释 */
		i18n?: boolean;
		name?: string | RegExp;
		command?: Command;
		/** 是否要求消息带称呼（@机器人 或前缀） */
		prefix?: boolean;
		/** 是否模糊匹配：把消息剩余部分作为参数传入 */
		fuzzy?: boolean;
		args?: string[];
		options?: Dict;
	}

	/** 命令 action / checker 的统一签名：接收 argv 与解构后的 args */
	export type Action<
		U extends User.Field = never,
		G extends Channel.Field = never,
		A extends unknown[] = unknown[],
		O extends object = object,
		// biome-ignore lint/suspicious/noConfusingVoidType: 公共 API：action 返回 void 表示透传给后续 checker，改为 undefined 会破坏 void 返回回调的可赋值性
	> = (
		argv: Argv<U, G, A, O>,
		...args: A
	) => Awaitable<void | Fragment>;

	/** 用法说明：静态字符串或按会话动态生成的函数 */
	export type Usage<
		U extends User.Field = never,
		G extends Channel.Field = never,
	> =
		| string
		| ((session: Session<U, G>) => Awaitable<string>);

	export interface Config
		extends CommandBase.Config,
			Permissions.Config {
		/** 根消息带引用时，把引用内容追加为最后一个参数 */
		captureQuote?: boolean;
		/** 拒绝未注册的选项（返回错误提示） */
		checkUnknown?: boolean;
		/** 校验参数个数（不足时交互式追问，多余时报错） */
		checkArgCount?: boolean;
		/** 是否显示命令警告（权限不足等提示） */
		showWarning?: boolean;
		/** 错误处理策略：true 返回通用提示，false 上抛，函数自定义 */
		handleError?:
			| boolean
			// biome-ignore lint/suspicious/noConfusingVoidType: 公共 API：返回 void 表示无自定义输出，改为 undefined 会破坏 void 返回回调的可赋值性
			| ((
					error: Error,
					argv: Argv,
			  ) => Awaitable<void | Fragment>);
		/** 是否向平台注册斜线指令 */
		slash?: boolean;
	}
}
