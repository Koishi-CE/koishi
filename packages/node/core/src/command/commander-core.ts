import { type Bot, h } from "@satorijs/core";
import type { Context } from "../context";
import type { Computed } from "../filter";
import type { Session } from "../session";
import type { Command } from "./command";
import { parseDecl, parseValue, resolveDomain } from "./declaration";
import { normalizeCommand } from "./normalize";
import type { Argv } from "./parser";

export interface CommanderConfig {
	prefix?: Computed<string | string[]>;
	prefixMode?: "auto" | "strict";
}

export class CommanderCore {
	_commandList: Command[] = [];

	protected ctx!: Context;
	protected config!: CommanderConfig;

	get(name: string, session?: Session) {
		return this._commandList.find((cmd) => {
			if (!Object.hasOwn(cmd._aliases, name)) return false;
			const alias = cmd._aliases[name];
			if (!alias) return false;
			return session?.resolve(alias.filter) ?? true;
		});
	}

	updateCommands(bot: Bot) {
		return bot.updateCommands(
			this._commandList
				.filter((cmd) => !cmd.name.includes(".") && cmd.config.slash)
				.map((cmd) => cmd.toJSON()),
		);
	}

	_resolvePrefixes(session: Session) {
		const value = session.resolve(this.config.prefix);
		const result = Array.isArray(value) ? value : [value || ""];
		return result
			.map((source) => h.escape(source))
			.sort()
			.reverse();
	}

	available(session: Session) {
		return this._commandList
			.filter((cmd) => cmd.match(session))
			.flatMap((cmd) =>
				Object.entries(cmd._aliases)
					.filter(([, alias]) => session.resolve(alias.filter) ?? true)
					.map(([name]) => name),
			);
	}

	resolve(key: string, session?: Session) {
		return this._resolve(key, session).command;
	}

	_resolve(key: string, session?: Session) {
		if (!key) return {};
		const segments = normalizeCommand(key).split(".");
		let i = 1,
			name = segments[0] ?? "",
			command: Command | undefined;
		while ((command = this.get(name, session)) && i < segments.length) {
			name = command.name + "." + (segments[i++] ?? "");
		}
		return { command, name };
	}

	domain<K extends keyof Argv.Domain>(
		name: K,
	): Argv.DomainConfig<Argv.Domain[K]>;
	domain<K extends keyof Argv.Domain>(
		name: K,
		transform: Argv.Transform<Argv.Domain[K]>,
		options?: Argv.DomainConfig<Argv.Domain[K]>,
	): () => void;
	domain<K extends keyof Argv.Domain>(
		name: K,
		transform?: Argv.Transform<Argv.Domain[K]>,
		options?: Argv.DomainConfig<Argv.Domain[K]>,
	) {
		const service = "domain:" + name;
		if (!transform) return this.ctx.get(service);
		return this.ctx.set(service, { transform, ...options });
	}

	resolveDomain(type: Argv.Type | undefined) {
		return resolveDomain(this.ctx, type);
	}

	parseValue(
		source: string,
		kind: string,
		argv: Argv,
		decl: Argv.Declaration = {},
	) {
		return parseValue(this.ctx, source, kind, argv, decl);
	}

	parseDecl(source: string) {
		return parseDecl(this.ctx, source);
	}
}
