/**
 * CommandDefinition：命令的「定义层」——行为注册 API 的实现。
 *
 * 继承 CommandCore（身份 / 别名管理），补充命令的可编程能力：
 * - 数据库字段观测声明（userFields / channelFields）；
 * - 执行队列：checkers（前置校验）与 actions（业务处理）；
 * - 定义类 API：subcommand / option / usage / example / shortcut 等，
 *   以及字段收集器与预设参数转义辅助。
 * 最终的 Command 在此之上补齐执行引擎（execute）与序列化（toJSON）。
 */

import { camelize, remove } from "cosmokit";
import type { Channel, User } from "../../database";
import type { FieldCollector, Session } from "../../session";
import type { Command } from "./command";
import { CommandCore } from "./core";
import type { Argv } from "../parser";

export class CommandDefinition<
	U extends User.Field = never,
	G extends Channel.Field = never,
	A extends any[] = any[],
	O extends {} = {},
> extends CommandCore {
	/** help 展示的示例列表 */
	_examples: string[] = [];
	/** 命令用法说明（字符串或按会话生成的函数） */
	_usage?: Command.Usage<any, any>;

	/** 需要观测的用户字段收集器；默认收集 locales 供 i18n 使用 */
	_userFields: FieldCollector<"user", any, any, any>[] = [["locales"]];
	/** 需要观测的频道字段收集器；默认收集 locales */
	_channelFields: FieldCollector<"channel", any, any, any>[] = [["locales"]];
	/** action 队列：按注册顺序执行，构成洋葱模型 */
	_actions: Command.Action<any, any, any, any>[] = [];
	/** checker 队列：action 之前的校验钩子；首个为内置的 before-execute 事件 */
	_checkers: Command.Action<any, any, any, any>[] = [
		async (argv) => {
			return this.ctx.serial(argv.session, "command/before-execute", argv);
		},
	];

	/**
	 * 声明命令运行时需要观测的用户数据库字段。
	 * 类型层面通过泛型收窄 U，使 action 中 session.user 能访问对应字段。
	 */
	userFields<T extends User.Field>(
		fields: FieldCollector<"user", T, A, O>,
	): Command<U | T, G, A, O> {
		this._userFields.push(fields);
		return this as any;
	}

	/** 同 userFields，作用于频道（channel）字段 */
	channelFields<T extends Channel.Field>(
		fields: FieldCollector<"channel", T, A, O>,
	): Command<U, G | T, A, O> {
		this._channelFields.push(fields);
		return this as any;
	}

	/**
	 * 定义子命令：以当前命令名为前缀拼接后走 ctx.command 注册。
	 * def 以 "." 开头时直接视为相对名（如 ".c" → "父名.c"）。
	 */
	subcommand(def: string, ...args: any[]) {
		def = this.name + (def.charCodeAt(0) === 46 ? "" : "/") + def;
		const desc = typeof args[0] === "string" ? (args.shift() as string) : "";
		const config = (args[0] as Command.Config) || {};
		return (this as any).ctx.command(def, desc, config);
	}

	/** 设置命令用法说明（help 中展示） */
	usage(text: Command.Usage<U, G>) {
		this._usage = text;
		return this as any;
	}

	/** 追加一条使用示例（help 中展示） */
	example(example: string) {
		this._examples.push(example);
		return this as any;
	}

	/**
	 * 定义一个选项。
	 * @param name 选项名（camelCase，注册键）
	 * @param args [desc, config]：描述文本与选项配置
	 * 权限默认换算自 authority（未配置视为 0）；
	 * 注册行为绑定到当前 caller 作用域，销毁时自动注销该选项。
	 */
	option(name: string, ...args: any[]) {
		let desc = "";
		if (typeof args[0] === "string") {
			desc = args.shift() as string;
		}
		const config = { ...(args[0] as Argv.OptionConfig) };
		config.permissions ??= [`authority:${config.authority ?? 0}`];
		this._createOption(name, desc, config);
		this.caller.emit("command-updated", this as any);
		this.caller.collect("option", () => this.removeOption(name));
		return this as any;
	}

	/** 会话能否触发本命令：交由当前 filter 判定 */
	match(session: Session) {
		return (this as any).ctx.filter(session);
	}

	/** 注册前置校验（before 的别名）：返回非空值可中止命令执行 */
	check(callback: Command.Action<U, G, A, O>, append = false) {
		return this.before(callback, append);
	}

	/**
	 * 注册前置校验钩子。默认插队到队首（后注册先执行），
	 * append 为 true 时追加到队尾；随 caller 作用域自动清理。
	 */
	before(callback: Command.Action<U, G, A, O>, append = false) {
		if (append) {
			this._checkers.push(callback);
		} else {
			this._checkers.unshift(callback);
		}
		this.caller.scope.disposables?.push(() => remove(this._checkers, callback));
		return this as any;
	}

	/**
	 * 注册 action（命令的业务处理函数）。
	 * 多个 action 构成洋葱模型，通过 argv.next 传递控制权；
	 * 随 caller 作用域自动清理。
	 */
	action(callback: Command.Action<U, G, A, O>, prepend = false) {
		if (prepend) {
			this._actions.unshift(callback);
		} else {
			this._actions.push(callback);
		}
		this.caller.scope.disposables?.push(() => remove(this._actions, callback));
		return this as any;
	}

	/**
	 * 转义 shortcut 预设值中的 "$" 序列：
	 * "$$" 还原为字面量 "$"，"$1" 等转为 "{1}" 占位符
	 * （matcher 会在插值阶段将其替换为实际捕获内容）。
	 */
	_escape(source: any) {
		if (typeof source !== "string") return source;
		return source
			.replace(/\$\$/g, "@@__PLACEHOLDER__@@")
			.replace(/\$\d/g, (s) => `{${s[1]}}`)
			.replace(/@@__PLACEHOLDER__@@/g, "$");
	}

	/** @deprecated 请改用 `cmd.alias()` */
	shortcut(
		pattern: string | RegExp,
		config?: Command.Shortcut & { i18n?: false },
	): this;
	/** @deprecated 请改用 `cmd.alias()` */
	shortcut(pattern: string, config?: Command.Shortcut & { i18n: true }): this;
	/**
	 * 注册命令快捷方式：把一段消息模式（字符串 / 正则 / i18n 键）
	 * 映射为对本命令的调用。预设的 args / options 会拼进
	 * `<execute>` 指令文本；fuzzy 模式额外追加 "{1}" 捕获剩余内容。
	 */
	shortcut(pattern: string | RegExp, config: Command.Shortcut = {}) {
		let content = this.displayName ?? this.name;
		for (const [key, value] of Object.entries(config.options ?? {})) {
			content += ` --${camelize(key)}`;
			if (value !== true) {
				content += " " + this._escape(value);
			}
		}
		for (const arg of config.args || []) {
			content += " " + this._escape(arg);
		}
		if (config.fuzzy) content += " {1}";
		const regex = config.i18n;
		if (typeof pattern === "string") {
			// 字符串模式统一转为 i18n 键处理：
			// 显式 i18n 时按约定路径取文案，否则现场定义一个随机键
			if (config.i18n) {
				pattern = `commands.${this.name}.shortcuts.${pattern}`;
			} else {
				config.i18n = true;
				const key = `commands.${this.name}.shortcuts._${Math.random().toString(36).slice(2)}`;
				(this as any).ctx.i18n.define("", key, pattern);
				pattern = key;
			}
		}
		const dispose = (this as any).ctx.match(
			pattern,
			`<execute>${content}</execute>`,
			{
				appel: config.prefix ?? false,
				fuzzy: config.fuzzy ?? false,
				i18n: config.i18n as never,
				regex: regex ?? false,
			},
		);
		this._disposables.push(dispose);
		return this as any;
	}
}
