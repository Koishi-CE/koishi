// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 帮助指令插件（help）。
 *
 * 提供 `help [command]` 指令（权限 0）与全局快捷调用“帮助”，
 * 并默认为所有指令注入 `-h, --help` 选项；输出指令的描述、别名、
 * 用法、选项、示例与子指令列表，支持按权限与 hidden 配置过滤。
 * 其他插件可通过 `help/command`、`help/option` 事件改写帮助输出，
 * 或通过指令 / 选项的 hidden、hideOptions、params 配置定制展示。
 * 配置项：shortcut（启用快捷调用）、options（注入 -h 选项）。
 */
import {
	type Argv,
	type Command,
	type Computed,
	Context,
	type FieldCollector,
	Schema,
	type Session,
} from "@koishi-ce/koishi";
import enUS from "../locales/en-US.yml";
import zhCN from "../locales/zh-CN.yml";
import type { HelpOptions } from "./render.ts";
import { formatCommands, showHelp } from "./render.ts";

declare module "@koishi-ce/koishi" {
	interface Events {
		"help/command"(
			output: string[],
			command: Command,
			session: Session<never, never>,
		): void;
		"help/option"(
			output: string,
			option: Argv.OptionVariant,
			command: Command,
			session: Session<never, never>,
		): string;
	}

	namespace Command {
		interface Config {
			/** 默认隐藏所有选项 */
			hideOptions?: boolean;
			/** 在帮助中隐藏此指令 */
			hidden?: Computed<boolean>;
			/** 本地化参数 */
			params?: object;
		}
	}

	namespace Argv {
		interface OptionConfig<
			T extends Argv.Type = Argv.Type,
		> {
			/** 在帮助中隐藏此选项 */
			hidden?: Computed<boolean>;
			/** 本地化参数 */
			params?: object;
		}
	}
}

/** 配置项 */
export interface Config {
	/** 是否启用“帮助”快捷调用 */
	shortcut?: boolean;
	/** 是否为每个指令注入 `-h, --help` 选项 */
	options?: boolean;
}

export const Config: Schema<Config> = Schema.object({
	shortcut: Schema.boolean()
		.default(true)
		.description("是否启用快捷调用。"),
	options: Schema.boolean()
		.default(true)
		.description("是否为每个指令添加 `-h, --help` 选项。"),
});

/** 在当前会话中转执行 help 指令（供 -h 选项与无 action 的指令复用） */
function executeHelp(
	session: Session<never, never>,
	name: string,
) {
	if (!session.app.$commander.get("help")) return;
	return session.execute({
		name: "help",
		args: [name],
	});
}

export const name = "help";

export function apply(ctx: Context, config: Config) {
	ctx.i18n.define("zh-CN", zhCN);
	ctx.i18n.define("en-US", enUS);

	// 为指令注入隐藏的 -h, --help 选项（不展示、不计入用法）
	function enableHelp(command: Command) {
		command[Context.current] = ctx;
		command.option("help", "-h", {
			hidden: true,
			// @ts-expect-error
			notUsage: true,
			descPath: "commands.help.options.help",
		});
	}

	ctx.schema.extend(
		"command",
		Schema.object({
			hideOptions: Schema.boolean()
				.description("是否隐藏所有选项。")
				.default(false)
				.hidden(),
			hidden: Schema.computed(Schema.boolean())
				.description("在帮助菜单中隐藏指令。")
				.default(false),
			params: Schema.any()
				.description("帮助信息的本地化参数。")
				.hidden(),
		}),
		900,
	);

	ctx.schema.extend(
		"command-option",
		Schema.object({
			hidden: Schema.computed(Schema.boolean())
				.description("在帮助菜单中隐藏选项。")
				.default(false),
			params: Schema.any()
				.description("帮助信息的本地化参数。")
				.hidden(),
		}),
		900,
	);

	if (config.options !== false) {
		// 已注册的指令立即注入，之后新增的指令通过事件注入
		ctx.$commander._commandList.forEach(enableHelp);
		ctx.on("command-added", enableHelp);
	}

	// 指令执行前的拦截：带 -h 或指令本身没有 action 时，转而输出帮助
	ctx.before(
		"command/execute",
		(
			argv: Argv<
				never,
				never,
				unknown[],
				{ help?: boolean }
			>,
		) => {
			const { command, options, session } = argv;
			if (!command || !session || !options) return;
			if (options["help"] && command._options["help"]) {
				return executeHelp(session, command.name);
			}

			if (command["_actions"].length) return;
			return executeHelp(session, command.name);
		},
	);

	const $ = ctx.$commander;

	/**
	 * 按名称解析目标指令；未命中时再按 i18n 快捷调用匹配
	 * @param target 用户输入的指令名或快捷调用文本
	 * @returns 指令对象；仅有模糊命中时返回候选列表
	 */
	function findCommand(
		target: string,
		session: Session<never, never>,
	) {
		const command = $.resolve(target, session);
		if (command?.ctx.filter(session)) return command;

		// 指令名未命中：转为在各语言的指令快捷调用文本中检索
		const data = ctx.i18n
			.find("commands.(name).shortcuts.(variant)", target)
			.map((item) => ({
				...item,
				command: $.resolve(item.data.name, session),
			}))
			.filter((item) => item.command?.match(session));
		const perfect = data.filter(
			(item) => item.similarity === 1,
		);
		if (!perfect.length) return data;
		return perfect[0]?.command;
	}

	// 字段收集器：help 指令自身只用 authority，
	// 但被查询的目标指令可能声明了额外的 user / channel 观察字段
	const createCollector =
		<T extends "user" | "channel">(
			key: T,
		): FieldCollector<T> =>
		(argv, fields) => {
			const { args, session } = argv;
			const [target] = args ?? [];
			if (!session) return;
			// target 是消息中的指令名；FieldCollector 擦除后 args 为 unknown[]
			const result = findCommand(target as string, session);
			if (!Array.isArray(result)) {
				if (result) {
					session.collect(
						key,
						{
							...argv,
							command: result,
							args: [],
							options: { help: true },
						},
						fields,
					);
				}
				return;
			}
			for (const { command } of result) {
				if (!command) continue;
				session.collect(
					key,
					{
						...argv,
						command,
						args: [],
						options: { help: true },
					},
					fields,
				);
			}
		};

	/** 推断用户输入对应的指令；仅有模糊命中时发起相似度建议（“您要找的是不是…”） */
	async function inferCommand(
		target: string,
		session: Session,
	) {
		const result = findCommand(target, session);
		if (!Array.isArray(result)) return result;

		// 候选 = 当前会话可见的相似指令名 + 快捷调用命中的指令名
		const expect = $.available(session).filter((name) => {
			return name && session.app.i18n.compare(name, target);
		});
		for (const item of result) {
			if (expect.includes(item.data.name)) continue;
			expect.push(item.data.name);
		}
		const cache = new Map<string, Promise<boolean>>();
		const name = await session.suggest({
			expect,
			prefix: session.text(".not-found"),
			suffix: session.text("internal.suggest-command"),
			filter: (name) => {
				const command = $.resolve(name, session);
				if (!command) return false;
				return ctx.permissions.test(
					`command:${command.name}`,
					session,
					cache,
				);
			},
		});
		if (!name) return;
		return $.resolve(name, session);
	}

	// 主指令：无参数时列出全局指令清单，带参数时输出目标指令的详细帮助
	const cmd = ctx
		.command("help [command:string]", {
			authority: 0,
			...config,
		})
		.userFields(["authority"])
		.userFields(createCollector("user"))
		.channelFields(createCollector("channel"))
		.option("showHidden", "-H")
		.action(async ({ session, options }, target) => {
			if (!session || !options) return;
			if (!target) {
				const prefix =
					session.resolve(
						session.app.koishi.config.prefix,
					)?.[0] ?? "";
				const commands = $._commandList.filter(
					(cmd) => cmd.parent === null,
				);
				const output = await formatCommands(
					".global-prolog",
					session,
					commands,
					options as HelpOptions,
				);
				const epilog = session.text(".global-epilog", [
					prefix,
				]);
				if (epilog) output.push(epilog);
				return output.filter(Boolean).join("\n");
			}

			const command = await inferCommand(target, session);
			if (!command) return;
			if (
				!(await ctx.permissions.test(
					`command:${command.name}`,
					session,
				))
			) {
				return session.text("internal.low-authority");
			}
			return showHelp(
				command,
				session,
				options as HelpOptions,
			);
		});

	// 注册全局快捷调用“帮助”（具体文本由各语言的 i18n 文本提供）
	if (config.shortcut !== false)
		cmd.shortcut("help", { i18n: true, fuzzy: true });
}
