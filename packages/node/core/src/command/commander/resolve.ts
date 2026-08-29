/**
 * CommanderResolve：从 token 流推断目标命令并完成解析。
 *
 * inferCommand 逐个消费 token 拼出点分命令路径（支持隐式子命令链），
 * 命中后注入别名预设的 args / options；resolveCommand 在此基础上
 * 调用 Command.parse 把剩余 token 装配为参数与选项。
 * 这是从「一条消息」到「一次命令调用」的关键衔接层。
 */

import type { Argv } from "../parser/index.ts";
import { CommanderCore } from "./core.ts";

export class CommanderResolve extends CommanderCore {
	/**
	 * 推断 argv 对应的目标命令。
	 *
	 * 优先级：已解析的 argv.command > 显式 argv.name > 按 token 逐级推断。
	 * 推断规则：把 token 内容依次拼为 "a"、"a.b"…… 命中即消费该 token，
	 * 直到命令声明了自身参数（说明后续 token 属于参数）或无法继续命中。
	 */
	inferCommand(argv: Argv) {
		if (!argv) return;
		if (argv.command) return argv.command;
		if (argv.name) {
			const command = this.resolve(argv.name, argv.session);
			if (command) argv.command = command;
			return argv.command;
		}

		const session = argv.session;
		if (!session) return;
		const { stripped, isDirect, quote } = session;
		// 群聊消息必须带前缀或称呼（@机器人）才可能是一次命令调用；
		// strict 模式下任何场景都要求前缀
		const isStrict =
			this.config.prefixMode === "strict" || (!isDirect && !stripped.appel);
		if (argv.root && stripped.prefix === null && isStrict) return;
		const segments: string[] = [];
		const tokens = argv.tokens ?? [];
		while (tokens.length) {
			const token = tokens[0];
			if (!token) break;
			const { content } = token;
			segments.push(content);
			const { name, command } = this._resolve(segments.join("."), argv.session);
			if (!command) break;
			tokens.shift();
			argv.command = command;
			// 命中的若是具名别名，注入其预设的参数与选项
			const alias = name ? command._aliases[name] : undefined;
			if (alias) {
				if (alias.args) argv.args = alias.args;
				if (alias.options) argv.options = alias.options;
			}
			// 命令自身声明了参数：后续 token 是参数而非子命令名
			if (command._arguments.length) break;
		}
		// https://github.com/koishijs/koishi/issues/1432
		// https://github.com/koishijs/koishi/issues/1441
		// 根消息带引用时，把引用内容追加为一个带引号的 token（captureQuote）
		if (
			argv.root &&
			argv.command?.config.captureQuote !== false &&
			quote?.content
		) {
			(argv.tokens ??= []).push({
				content: quote.content,
				quoted: true,
				inters: [],
				terminator: "",
			});
		}
		return argv.command;
	}

	/**
	 * 推断命令并完成参数解析，写回 argv.options / args / error。
	 * token 中含插值段（inters）时不做解析——插值场景由求值方接管。
	 */
	resolveCommand(argv: Argv) {
		const command = this.inferCommand(argv);
		if (!command) return;
		if (argv.tokens?.every((token) => !token.inters.length)) {
			const { options, args, error } = command.parse(argv);
			argv.options = options ?? {};
			argv.args = args ?? [];
			argv.error = error ?? "";
		}
		return argv.command;
	}
}
