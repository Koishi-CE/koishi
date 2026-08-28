/**
 * 命令解析核心算法：把 token 流装配为 args / options。
 *
 * 主循环逐个消费 token，按优先级判定其身份：
 * 贪婪参数（吞掉剩余全部）→ 符号选项 → 普通参数 → 选项（含连写短选项、
 * `--no-` 取反、`=` 赋值、值跨 token 等）。解析失败不抛异常，
 * 而是把用户可读的错误文案写入 argv.error，由执行链统一处理。
 */

import { camelCase, type Dict } from "cosmokit";
import type { Command } from "../command/command";
import { Argv } from "./argv";
import type { CommandBase } from "./base";

/** CommandBase.parse 的算法实现（纯函数化，便于与选项注册逻辑分离） */
export function parseCommand(
	cmd: CommandBase,
	argv: string | Argv,
	terminator?: string,
): Argv {
	if (typeof argv === "string") {
		argv = Argv.parse(argv, terminator);
	}
	// 复制一份避免污染调用方传入的 argv（alias 注入的预设值也一并带过来）
	const args = [...(argv.args || [])];
	const options: Dict<unknown> = { ...argv.options };

	if (!argv.source && argv.tokens) {
		argv.source = cmd.name + " " + Argv.stringify(argv);
	}

	// 变长参数越过声明末位后，继续沿用最后一条有效声明做类型转换
	let lastArgDecl: Argv.Declaration | undefined;

	while (!argv.error && argv.tokens?.length) {
		const token = argv.tokens[0];
		if (!token) break;
		let { content, quoted } = token;

		// 变长参数：取当前位置对应的声明；越界后沿用 lastArgDecl
		const argDecl: Argv.Declaration =
			cmd._arguments[args.length] || lastArgDecl || {};
		if (args.length === cmd._arguments.length - 1 && argDecl.variadic) {
			lastArgDecl = argDecl;
		}

		// 贪婪参数（text / el 等）：把剩余原始文本整体作为一个值，解析即结束。
		// 注意 "-" 开头的 token 不走贪婪（避免把 "--foo" 吃进文本参数）
		if (
			content[0] !== "-" &&
			cmd.ctx.$commander.resolveDomain(argDecl.type).greedy
		) {
			args.push(
				cmd.ctx.$commander.parseValue(
					Argv.stringify(argv),
					"argument",
					argv,
					argDecl,
				),
			);
			break;
		}

		// 消费掉本 token，进入身份判定
		argv.tokens.shift();
		let option: Argv.OptionDeclaration | undefined;
		let names: string | string[];
		let param = "";
		// 符号选项（如 "#1" 的 "#"）：未被引号包裹且命中符号表
		if (!quoted && (option = cmd._symbolicOptions[content])) {
			names = [camelCase(option.name ?? "")];
		} else {
			// 普通参数判定：不以 "-" 开头、被引号包裹，
			// 或者是数值类型参数且 content 是合法数字（兼容 "-1" 这样的负数）
			if (
				content[0] !== "-" ||
				quoted ||
				(+content * 0 === 0 &&
					cmd.ctx.$commander.resolveDomain(argDecl.type).numeric)
			) {
				args.push(
					cmd.ctx.$commander.parseValue(content, "argument", argv, argDecl),
				);
				continue;
			}

			// 统计前导连字符个数：1 个为短选项（可连写），>=2 为长选项
			let i = 0;
			for (; i < content.length; ++i) {
				if (content.charCodeAt(i) !== 45) break;
			}

			// 定位 "=" 分隔的显式赋值（如 --key=value、-k=v）
			let j = i + 1;
			for (; j < content.length; j++) {
				if (content.charCodeAt(j) === 61) break;
			}
			const name = content.slice(i, j);
			// 短选项（单个 "-"）按字符拆分以支持连写（-ab → a、b）；长选项整体一个名字
			names = i > 1 ? [name] : name;
			// 严格选项模式：未注册的写法不当作选项，
			// 而是回退为普通参数（贪婪类型则整体吞掉剩余输入）
			if (cmd.config.strictOptions && !cmd._namedOptions[names[0] ?? ""]) {
				if (cmd.ctx.$commander.resolveDomain(argDecl.type).greedy) {
					argv.tokens.unshift(token);
					args.push(
						cmd.ctx.$commander.parseValue(
							Argv.stringify(argv),
							"argument",
							argv,
							argDecl,
						),
					);
					break;
				}
				args.push(
					cmd.ctx.$commander.parseValue(content, "argument", argv, argDecl),
				);
				continue;
			}
			// "--no-xxx" 且 xxx 未注册：直接置 options.xxx = false（隐式取反）
			if (i > 1 && name.startsWith("no-") && !cmd._namedOptions[name]) {
				options[camelCase(name.slice(3))] = false;
				continue;
			}
			param = content.slice(++j);
			option = cmd._namedOptions[names[names.length - 1] ?? ""];
		}

		// 选项取值：本 token 未带 "=" 赋值时尝试从下一个 token 取值
		quoted = false;
		if (!param) {
			const type = option?.type;
			const values = option?.values;
			if (cmd.ctx.$commander.resolveDomain(type).greedy) {
				// 贪婪选项（-- <rest:text>）：剩余全部原文作为值，且视为已引用
				param = Argv.stringify(argv);
				quoted = true;
				argv.tokens = [];
			} else {
				// 有固定取值（value 变体）或 boolean 型选项不需要额外值；
				// 其余情况只要还有 token（且不是新的 "-" 开头写法）就消费它作为值
				const isValued =
					(names[names.length - 1] ?? "") in (values || {}) ||
					type === "boolean";
				if (
					!isValued &&
					argv.tokens.length &&
					(type || argv.tokens[0]?.content !== "-")
				) {
					const nextToken = argv.tokens.shift();
					if (!nextToken) continue;
					param = nextToken.content;
					quoted = nextToken.quoted;
				}
			}
		}

		// 逐个处理连写名：最后一个名字拿到值，前面的名字取空串（boolean 化）
		for (let j = 0; j < names.length; j++) {
			const name = names[j];
			if (!name) continue;
			const optDecl = cmd._namedOptions[name];
			const key = optDecl ? (optDecl.name ?? "") : camelCase(name);
			if (optDecl && name in optDecl.values) {
				options[key] = optDecl.values[name];
			} else {
				const source = j + 1 < names.length ? "" : param;
				options[key] = cmd.ctx.$commander.parseValue(
					source,
					"option",
					argv,
					optDecl,
				);
			}
			if (argv.error) break;
		}
	}

	// 填充 fallback：未显式传入且声明了默认值的选项在此补齐
	for (const { name, fallback } of Object.values(cmd._options)) {
		if (!name) continue;
		if (fallback !== undefined && !(name in options)) {
			options[name] = fallback;
		}
	}

	delete argv.tokens;
	return {
		...argv,
		options,
		args,
		error: argv.error || "",
		command: cmd as Command,
	};
}
