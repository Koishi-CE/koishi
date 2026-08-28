import { camelize, remove } from "cosmokit";
import type { Channel, User } from "../database";
import type { FieldCollector, Session } from "../session";
import type { Command } from "./command";
import { CommandCore } from "./command-core";
import type { Argv } from "./parser";

export class CommandDefinition<
	U extends User.Field = never,
	G extends Channel.Field = never,
	A extends any[] = any[],
	O extends {} = {},
> extends CommandCore {
	_examples: string[] = [];
	_usage?: Command.Usage<any, any>;

	_userFields: FieldCollector<"user", any, any, any>[] = [["locales"]];
	_channelFields: FieldCollector<"channel", any, any, any>[] = [["locales"]];
	_actions: Command.Action<any, any, any, any>[] = [];
	_checkers: Command.Action<any, any, any, any>[] = [
		async (argv) => {
			return this.ctx.serial(argv.session, "command/before-execute", argv);
		},
	];

	userFields<T extends User.Field>(
		fields: FieldCollector<"user", T, A, O>,
	): Command<U | T, G, A, O> {
		this._userFields.push(fields);
		return this as any;
	}

	channelFields<T extends Channel.Field>(
		fields: FieldCollector<"channel", T, A, O>,
	): Command<U, G | T, A, O> {
		this._channelFields.push(fields);
		return this as any;
	}

	subcommand(def: string, ...args: any[]) {
		def = this.name + (def.charCodeAt(0) === 46 ? "" : "/") + def;
		const desc = typeof args[0] === "string" ? (args.shift() as string) : "";
		const config = (args[0] as Command.Config) || {};
		return (this as any).ctx.command(def, desc, config);
	}

	usage(text: Command.Usage<U, G>) {
		this._usage = text;
		return this as any;
	}

	example(example: string) {
		this._examples.push(example);
		return this as any;
	}

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

	match(session: Session) {
		return (this as any).ctx.filter(session);
	}

	check(callback: Command.Action<U, G, A, O>, append = false) {
		return this.before(callback, append);
	}

	before(callback: Command.Action<U, G, A, O>, append = false) {
		if (append) {
			this._checkers.push(callback);
		} else {
			this._checkers.unshift(callback);
		}
		this.caller.scope.disposables?.push(() => remove(this._checkers, callback));
		return this as any;
	}

	action(callback: Command.Action<U, G, A, O>, prepend = false) {
		if (prepend) {
			this._actions.unshift(callback);
		} else {
			this._actions.push(callback);
		}
		this.caller.scope.disposables?.push(() => remove(this._actions, callback));
		return this as any;
	}

	_escape(source: any) {
		if (typeof source !== "string") return source;
		return source
			.replace(/\$\$/g, "@@__PLACEHOLDER__@@")
			.replace(/\$\d/g, (s) => `{${s[1]}}`)
			.replace(/@@__PLACEHOLDER__@@/g, "$");
	}

	/** @deprecated please use `cmd.alias()` instead */
	shortcut(
		pattern: string | RegExp,
		config?: Command.Shortcut & { i18n?: false },
	): this;
	/** @deprecated please use `cmd.alias()` instead */
	shortcut(pattern: string, config: Command.Shortcut & { i18n: true }): this;
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
