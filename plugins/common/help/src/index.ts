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
	h,
	Schema,
	type Session,
} from "@koishi-ce/koishi";
import enUS from "../locales/en-US.yml";
import zhCN from "../locales/zh-CN.yml";

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
		interface OptionConfig<T extends Argv.Type = Argv.Type> {
			/** 在帮助中隐藏此选项 */
			hidden?: Computed<boolean>;
			/** 本地化参数 */
			params?: object;
		}
	}
}

/** 帮助输出的行为选项 */
interface HelpOptions {
	/** 显示被 hidden 标记隐藏的指令与选项（对应 -H 选项） */
	showHidden?: boolean;
}

/** 配置项 */
export interface Config {
	/** 是否启用“帮助”快捷调用 */
	shortcut?: boolean;
	/** 是否为每个指令注入 `-h, --help` 选项 */
	options?: boolean;
}

export const Config: Schema<Config> = Schema.object({
	shortcut: Schema.boolean().default(true).description("是否启用快捷调用。"),
	options: Schema.boolean()
		.default(true)
		.description("是否为每个指令添加 `-h, --help` 选项。"),
});

/** 在当前会话中转执行 help 指令（供 -h 选项与无 action 的指令复用） */
function executeHelp(session: Session<never, never>, name: string) {
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
			params: Schema.any().description("帮助信息的本地化参数。").hidden(),
		}),
		900,
	);

	ctx.schema.extend(
		"command-option",
		Schema.object({
			hidden: Schema.computed(Schema.boolean())
				.description("在帮助菜单中隐藏选项。")
				.default(false),
			params: Schema.any().description("帮助信息的本地化参数。").hidden(),
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
		(argv: Argv<never, never, any[], { help?: boolean }>) => {
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
	function findCommand(target: string, session: Session<never, never>) {
		const command = $.resolve(target, session);
		if (command?.ctx.filter(session)) return command;

		// 指令名未命中：转为在各语言的指令快捷调用文本中检索
		const data = ctx.i18n
			.find("commands.(name).shortcuts.(variant)", target)
			.map((item) => ({ ...item, command: $.resolve(item.data.name, session) }))
			.filter((item) => item.command?.match(session));
		const perfect = data.filter((item) => item.similarity === 1);
		if (!perfect.length) return data;
		return perfect[0]?.command;
	}

	// 字段收集器：help 指令自身只用 authority，
	// 但被查询的目标指令可能声明了额外的 user / channel 观察字段
	const createCollector =
		<T extends "user" | "channel">(key: T): FieldCollector<T> =>
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
						{ ...argv, command: result, args: [], options: { help: true } },
						fields,
					);
				}
				return;
			}
			for (const { command } of result) {
				if (!command) continue;
				session.collect(
					key,
					{ ...argv, command, args: [], options: { help: true } },
					fields,
				);
			}
		};

	/** 推断用户输入对应的指令；仅有模糊命中时发起相似度建议（“您要找的是不是…”） */
	async function inferCommand(target: string, session: Session) {
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
				return ctx.permissions.test(`command:${command.name}`, session, cache);
			},
		});
		if (!name) return;
		return $.resolve(name, session);
	}

	// 主指令：无参数时列出全局指令清单，带参数时输出目标指令的详细帮助
	const cmd = ctx
		.command("help [command:string]", { authority: 0, ...config })
		.userFields(["authority"])
		.userFields(createCollector("user"))
		.channelFields(createCollector("channel"))
		.option("showHidden", "-H")
		.action(async ({ session, options }, target) => {
			if (!session || !options) return;
			if (!target) {
				const prefix =
					session.resolve(session.app.koishi.config.prefix)?.[0] ?? "";
				const commands = $._commandList.filter((cmd) => cmd.parent === null);
				const output = await formatCommands(
					".global-prolog",
					session,
					commands,
					options as HelpOptions,
				);
				const epilog = session.text(".global-epilog", [prefix]);
				if (epilog) output.push(epilog);
				return output.filter(Boolean).join("\n");
			}

			const command = await inferCommand(target, session);
			if (!command) return;
			if (!(await ctx.permissions.test(`command:${command.name}`, session))) {
				return session.text("internal.low-authority");
			}
			return showHelp(command, session, options as HelpOptions);
		});

	// 注册全局快捷调用“帮助”（具体文本由各语言的 i18n 文本提供）
	if (config.shortcut !== false)
		cmd.shortcut("help", { i18n: true, fuzzy: true });
}

/** 深度优先遍历指令树，产出当前会话可见（未被 hidden 过滤）的指令 */
function* getCommands(
	session: Session<"authority">,
	commands: Command[],
	showHidden = false,
): Generator<Command> {
	for (const command of commands) {
		if (!showHidden && session.resolve(command.config.hidden)) continue;
		// 自身可用则产出，否则下钻子指令（子指令可能单独可用）
		if (command.match(session) && Object.keys(command._aliases).length) {
			yield command;
		} else {
			yield* getCommands(session, command.children, showHidden);
		}
	}
}

/** 将一组指令格式化为帮助列表（标题行 + 每条指令一行的缩进展示） */
async function formatCommands(
	path: string,
	session: Session<"authority">,
	children: Command[],
	options: HelpOptions,
) {
	const cache = new Map<string, Promise<boolean>>();
	// 第一步：按可见性过滤
	children = Array.from(getCommands(session, children, options.showHidden));
	// 第二步：按权限过滤（并行检测并缓存结果）
	children = (
		await Promise.all(
			children.map(async (command) => {
				return [
					command,
					await session.app.permissions.test(
						`command:${command.name}`,
						session,
						cache,
					),
				] as const;
			}),
		)
	)
		.filter(([, result]) => result)
		.map(([command]) => command);
	// 第三步：按显示名排序
	children.sort((a, b) => (a.displayName > b.displayName ? 1 : -1));
	if (!children.length) return [];

	const prefix = session.resolve(session.app.koishi.config.prefix)?.[0] ?? "";
	const output = children.map(({ name, displayName, config }) => {
		let output = "    " + prefix + displayName.replace(/\./g, " ");
		output +=
			"  " + session.text([`commands.${name}.description`, ""], config.params);
		return output;
	});
	const hints: string[] = [];
	const hintText = hints.length
		? session.text("general.paren", [hints.join(session.text("general.comma"))])
		: "";
	output.unshift(session.text(path, [hintText]));
	return output;
}

/** 判断选项对当前会话是否可见（权限不足或被 hidden 标记隐藏时不可见） */
function getOptionVisibility(
	option: Argv.OptionConfig,
	session: Session<"authority">,
) {
	if (session.user && (option.authority ?? 0) > session.user.authority) {
		return false;
	}
	return !session.resolve(option.hidden);
}

/** 生成指令的选项帮助段落（考虑 hideOptions、权限与 hidden 过滤） */
function getOptions(
	command: Command,
	session: Session<"authority">,
	config: HelpOptions,
) {
	if (command.config.hideOptions && !config.showHidden) return [];
	const options = config.showHidden
		? Object.values(command._options)
		: Object.values(command._options).filter((option) =>
				getOptionVisibility(option, session),
			);
	if (!options.length) return [];

	const output: string[] = [];
	Object.values(command._options).forEach((option) => {
		function pushOption(option: Argv.OptionVariant, name: string) {
			if (!config.showHidden && !getOptionVisibility(option, session)) return;
			let line = `${h.escape(option.syntax)}`;
			const description = session.text(
				option.descPath ?? [`commands.${command.name}.options.${name}`, ""],
				option.params,
			);
			if (description) line += "  " + description;
			line = command.ctx.chain("help/option", line, option, command, session);
			output.push("    " + line);
		}

		// 无值选项直接输出；带值选项再逐个输出其语法变体
		if (!("value" in option)) pushOption(option, option.name ?? "");
		for (const value in option.variants) {
			const variant = option.variants[value];
			if (!variant) continue;
			pushOption(variant, `${option.name}.${value}`);
		}
	});

	if (!output.length) return [];
	output.unshift(session.text(".available-options"));
	return output;
}

/** 生成单个指令的完整帮助文本（标题、描述、别名、用法、选项、示例、子指令） */
async function showHelp(
	command: Command,
	session: Session<"authority">,
	config: HelpOptions,
) {
	const output = [
		session.text(".command-title", [
			command.displayName.replace(/\./g, " ") + command.declaration,
		]),
	];

	const description = session.text(
		[`commands.${command.name}.description`, ""],
		command.config.params,
	);
	if (description) output.push(description);

	// 有数据库时按目标指令的声明预取 user / channel 字段（usage 等钩子可能用到）
	if (session.app.database) {
		const argv: Argv = { command, args: [], options: { help: true } };
		const userFields = session.collect("user", argv);
		await session.observeUser(userFields);
		if (!session.isDirect) {
			const channelFields = session.collect("channel", argv);
			await session.observeChannel(channelFields);
		}
	}

	if (Object.keys(command._aliases).length > 1) {
		output.push(
			session.text(".command-aliases", [
				Array.from(Object.keys(command._aliases).slice(1)).join("，"),
			]),
		);
	}

	session.app.emit(session, "help/command", output, command, session);

	if (command._usage) {
		output.push(
			typeof command._usage === "string"
				? command._usage
				: // _usage 存储为擦除签名（见 core 的 CommandDefinition），此处还原实参
					await command._usage(session as never),
		);
	} else {
		const text = session.text(
			[`commands.${command.name}.usage`, ""],
			command.config.params,
		);
		if (text) output.push(text);
	}

	output.push(...getOptions(command, session, config));

	if (command._examples.length) {
		output.push(
			session.text(".command-examples"),
			...command._examples.map((example) => "    " + example),
		);
	} else {
		const text = session.text(
			[`commands.${command.name}.examples`, ""],
			command.config.params,
		);
		if (text)
			output.push(
				session.text(".command-examples"),
				...text.split("\n").map((line) => "    " + line),
			);
	}

	output.push(
		...(await formatCommands(
			".subcommand-prolog",
			session,
			command.children,
			config,
		)),
	);

	return output.filter(Boolean).join("\n");
}
