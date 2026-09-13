// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// upstream: koishijs/koishi plugins/common/help/src/index.ts（L174-L286 渲染层五函数，本仓拆分时抽离至本文件；上游为单文件，同步时以其整体 diff 对照本目录）

import type {
	Argv,
	Command,
	Session,
} from "@koishi-ce/koishi";
import { h } from "@koishi-ce/koishi";

/** 帮助输出的行为选项 */
export interface HelpOptions {
	/** 显示被 hidden 标记隐藏的指令与选项（对应 -H 选项） */
	showHidden?: boolean;
}

/** 深度优先遍历指令树，产出当前会话可见（未被 hidden 过滤）的指令 */
function* getCommands(
	session: Session<"authority">,
	commands: Command[],
	showHidden = false,
): Generator<Command> {
	for (const command of commands) {
		if (
			!showHidden &&
			session.resolve(command.config.hidden)
		)
			continue;
		// 自身可用则产出，否则下钻子指令（子指令可能单独可用）
		if (
			command.match(session) &&
			Object.keys(command._aliases).length
		) {
			yield command;
		} else {
			yield* getCommands(
				session,
				command.children,
				showHidden,
			);
		}
	}
}

/** 将一组指令格式化为帮助列表（标题行 + 每条指令一行的缩进展示） */
export async function formatCommands(
	path: string,
	session: Session<"authority">,
	children: Command[],
	options: HelpOptions,
) {
	const cache = new Map<string, Promise<boolean>>();
	// 第一步：按可见性过滤
	children = Array.from(
		getCommands(session, children, options.showHidden),
	);
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
	children.sort((a, b) =>
		a.displayName > b.displayName ? 1 : -1,
	);
	if (!children.length) return [];

	const prefix =
		session.resolve(
			session.app.koishi.config.prefix,
		)?.[0] ?? "";
	const output = children.map(
		({ name, displayName, config }) => {
			let output = `    ${prefix}${displayName.replace(/\./g, " ")}`;
			output += `  ${session.text([`commands.${name}.description`, ""], config.params)}`;
			return output;
		},
	);
	const hints: string[] = [];
	const hintText = hints.length
		? session.text("general.paren", [
				hints.join(session.text("general.comma")),
			])
		: "";
	output.unshift(session.text(path, [hintText]));
	return output;
}

/** 判断选项对当前会话是否可见（权限不足或被 hidden 标记隐藏时不可见） */
function getOptionVisibility(
	option: Argv.OptionConfig,
	session: Session<"authority">,
) {
	if (
		session.user &&
		(option.authority ?? 0) > session.user.authority
	) {
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
	if (command.config.hideOptions && !config.showHidden)
		return [];
	const options = config.showHidden
		? Object.values(command._options)
		: Object.values(command._options).filter((option) =>
				getOptionVisibility(option, session),
			);
	if (!options.length) return [];

	const output: string[] = [];
	Object.values(command._options).forEach((option) => {
		function pushOption(
			option: Argv.OptionVariant,
			name: string,
		) {
			if (
				!config.showHidden &&
				!getOptionVisibility(option, session)
			)
				return;
			let line = `${h.escape(option.syntax)}`;
			const description = session.text(
				option.descPath ?? [
					`commands.${command.name}.options.${name}`,
					"",
				],
				option.params,
			);
			if (description) line += `  ${description}`;
			line = command.ctx.chain(
				"help/option",
				line,
				option,
				command,
				session,
			);
			output.push(`    ${line}`);
		}

		// 无值选项直接输出；带值选项再逐个输出其语法变体
		if (!("value" in option))
			pushOption(option, option.name ?? "");
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
export async function showHelp(
	command: Command,
	session: Session<"authority">,
	config: HelpOptions,
) {
	const output = [
		session.text(".command-title", [
			command.displayName.replace(/\./g, " ") +
				command.declaration,
		]),
	];

	const description = session.text(
		[`commands.${command.name}.description`, ""],
		command.config.params,
	);
	if (description) output.push(description);

	// 有数据库时按目标指令的声明预取 user / channel 字段（usage 等钩子可能用到）
	if (session.app.database) {
		const argv: Argv = {
			command,
			args: [],
			options: { help: true },
		};
		const userFields = session.collect("user", argv);
		await session.observeUser(userFields);
		if (!session.isDirect) {
			const channelFields = session.collect(
				"channel",
				argv,
			);
			await session.observeChannel(channelFields);
		}
	}

	if (Object.keys(command._aliases).length > 1) {
		output.push(
			session.text(".command-aliases", [
				Array.from(
					Object.keys(command._aliases).slice(1),
				).join("，"),
			]),
		);
	}

	session.app.emit(
		session,
		"help/command",
		output,
		command,
		session,
	);

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
			...command._examples.map(
				(example) => `    ${example}`,
			),
		);
	} else {
		const text = session.text(
			[`commands.${command.name}.examples`, ""],
			command.config.params,
		);
		if (text)
			output.push(
				session.text(".command-examples"),
				...text.split("\n").map((line) => `    ${line}`),
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
