import { CommanderCore } from "./commander-core";
import type { Argv } from "./parser";

export class CommanderResolve extends CommanderCore {
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
		// guild message should have prefix or appel to be interpreted as a command call
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
			const alias = name ? command._aliases[name] : undefined;
			if (alias) {
				if (alias.args) argv.args = alias.args;
				if (alias.options) argv.options = alias.options;
			}
			if (command._arguments.length) break;
		}
		// https://github.com/koishijs/koishi/issues/1432
		// https://github.com/koishijs/koishi/issues/1441
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
