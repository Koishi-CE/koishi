import { coerce } from "@koishi-ce/utils";
import { type Fragment, Logger, Schema, type Universal } from "@satorijs/core";
import {
	type Awaitable,
	camelize,
	type Dict,
	isNullable,
	remove,
} from "cosmokit";
import { Context } from "../context";
import type { Channel, User } from "../database";
import type { Computed } from "../filter";
import { Next, SessionError } from "../middleware";
import type { Permissions } from "../permission";
import type { FieldCollector, Session } from "../session";
import { type Argv, CommandBase } from "./parser";

const logger = new Logger("command");

export type Extend<O extends {}, K extends string, T> = {
	[P in K | keyof O]?: (P extends keyof O ? O[P] : unknown) &
		(P extends K ? T : unknown);
};

export namespace Command {
	export interface Alias {
		options?: Dict;
		args?: string[];
		filter?: Computed<boolean>;
	}

	export interface Shortcut {
		i18n?: boolean;
		name?: string | RegExp;
		command?: Command;
		prefix?: boolean;
		fuzzy?: boolean;
		args?: string[];
		options?: Dict;
	}

	export type Action<
		U extends User.Field = never,
		G extends Channel.Field = never,
		A extends any[] = any[],
		O extends {} = {},
	> = (argv: Argv<U, G, A, O>, ...args: A) => Awaitable<void | Fragment>;

	export type Usage<
		U extends User.Field = never,
		G extends Channel.Field = never,
	> = string | ((session: Session<U, G>) => Awaitable<string>);
}

export class Command<
	U extends User.Field = never,
	G extends Channel.Field = never,
	A extends any[] = any[],
	O extends {} = {},
> extends CommandBase<Command.Config> {
	static normalize(name: string) {
		return name.toLowerCase().replace(/_/g, "-");
	}

	// 值侧由类静态承载(erasableSyntaxOnly 不允许 namespace 内运行时值)
	static Config: Schema<Command.Config> = Schema.object({
		permissions: Schema.array(String)
			.role("perms")
			.default(["authority:1"])
			.description("权限继承。"),
		dependencies: Schema.array(String).role("perms").description("权限依赖。"),
		slash: Schema.boolean().description("启用斜线指令功能。").default(true),
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
		handleError: Schema.union([Schema.boolean(), Schema.function()])
			.description("是否处理错误。")
			.default(true)
			.hidden(),
	});

	children: Command[] = [];

	_parent: Command | null = null;
	_aliases: Dict<Command.Alias> = Object.create(null);
	_examples: string[] = [];
	_usage?: Command.Usage<any, any>;

	private _userFields: FieldCollector<"user", any, any, any>[] = [["locales"]];
	private _channelFields: FieldCollector<"channel", any, any, any>[] = [
		["locales"],
	];
	private _actions: Command.Action<any, any, any, any>[] = [];
	private _checkers: Command.Action<any, any, any, any>[] = [
		async (argv) => {
			return this.ctx.serial(argv.session, "command/before-execute", argv);
		},
	];

	constructor(
		name: string,
		decl: string,
		ctx: Context,
		config: Command.Config,
	) {
		super(name, decl, ctx, {
			showWarning: true,
			handleError: true,
			slash: true,
			...config,
		});
		this.config.permissions ??= [`authority:${config?.authority ?? 1}`];
		this._registerAlias(name);
		ctx.$commander._commandList.push(this);
	}

	get caller(): Context {
		return this[Context.current] || this.ctx;
	}

	get displayName() {
		return Object.keys(this._aliases)[0] ?? this.name;
	}

	set displayName(name: string) {
		this._registerAlias(name, true);
	}

	get parent() {
		return this._parent;
	}

	set parent(parent: Command | null) {
		if (this._parent === parent) return;
		if (this._parent) {
			remove(this._parent.children, this);
		}
		this._parent = parent;
		if (parent) {
			parent.children.push(this);
		}
	}

	private _registerAlias(
		name: string,
		prepend = false,
		options: Command.Alias = {},
	) {
		name = Command.normalize(name);
		if (name.startsWith(".")) name = (this.parent?.name ?? "") + name;

		// check global
		const previous = this.ctx.$commander.get(name);
		if (previous && previous !== this) {
			throw new Error(`duplicate command names: "${name}"`);
		}

		// add to list
		const existing = this._aliases[name];
		if (existing) {
			if (prepend) {
				this._aliases = { [name]: existing, ...this._aliases };
			}
		} else if (prepend) {
			this._aliases = { [name]: options, ...this._aliases };
		} else {
			this._aliases[name] = options;
		}
	}

	[Symbol.for("nodejs.util.inspect.custom")]() {
		return `Command <${this.name}>`;
	}

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

	alias(...names: string[]): this;
	alias(name: string, options: Command.Alias): this;
	alias(...args: any[]) {
		if (typeof args[1] === "object") {
			this._registerAlias(args[0], false, args[1]);
		} else {
			for (const name of args) {
				this._registerAlias(name);
			}
		}
		this.caller.emit("command-updated", this);
		return this;
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
				this.ctx.i18n.define("", key, pattern);
				pattern = key;
			}
		}
		const dispose = this.ctx.match(pattern, `<execute>${content}</execute>`, {
			appel: config.prefix ?? false,
			fuzzy: config.fuzzy ?? false,
			i18n: config.i18n as never,
			regex: regex ?? false,
		});
		this._disposables.push(dispose);
		return this;
	}

	subcommand<D extends string>(
		def: D,
		config?: Command.Config,
	): Command<never, never, Argv.ArgumentType<D>>;
	subcommand<D extends string>(
		def: D,
		desc: string,
		config?: Command.Config,
	): Command<never, never, Argv.ArgumentType<D>>;
	subcommand(def: string, ...args: any[]) {
		def = this.name + (def.charCodeAt(0) === 46 ? "" : "/") + def;
		const desc = typeof args[0] === "string" ? (args.shift() as string) : "";
		const config = (args[0] as Command.Config) || {};
		return this.ctx.command(def, desc, config);
	}

	usage(text: Command.Usage<U, G>) {
		this._usage = text;
		return this;
	}

	example(example: string) {
		this._examples.push(example);
		return this;
	}

	option<K extends string>(
		name: K,
		desc: string,
		config: Argv.TypedOptionConfig<RegExp>,
	): Command<U, G, A, Extend<O, K, string>>;
	option<K extends string, R>(
		name: K,
		desc: string,
		config: Argv.TypedOptionConfig<(source: string) => R>,
	): Command<U, G, A, Extend<O, K, R>>;
	option<K extends string, R extends string>(
		name: K,
		desc: string,
		config: Argv.TypedOptionConfig<R[]>,
	): Command<U, G, A, Extend<O, K, R>>;
	option<K extends string, D extends string>(
		name: K,
		desc: D,
		config?: Argv.OptionConfig,
	): Command<U, G, A, Extend<O, K, Argv.OptionType<D>>>;
	option(name: string, ...args: any[]) {
		let desc = "";
		if (typeof args[0] === "string") {
			desc = args.shift() as string;
		}
		const config = { ...(args[0] as Argv.OptionConfig) };
		config.permissions ??= [`authority:${config.authority ?? 0}`];
		this._createOption(name, desc, config);
		this.caller.emit("command-updated", this);
		this.caller.collect("option", () => this.removeOption(name));
		return this;
	}

	match(session: Session) {
		return this.ctx.filter(session);
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
		return this;
	}

	action(callback: Command.Action<U, G, A, O>, prepend = false) {
		if (prepend) {
			this._actions.unshift(callback);
		} else {
			this._actions.push(callback);
		}
		this.caller.scope.disposables?.push(() => remove(this._actions, callback));
		return this;
	}

	/** @deprecated */
	use<T extends Command, R extends any[]>(
		callback: (command: this, ...args: R) => T,
		...args: R
	): T {
		return callback(this, ...args);
	}

	async execute(
		argv: Argv<U, G, A, O>,
		fallback: Next = Next.compose,
	): Promise<Fragment> {
		argv.command ??= this;
		const args = (argv.args ??= [] as unknown as A);
		const options = (argv.options ??= {} as O);
		const { error } = argv;
		if (error) return error;
		if (logger.level >= 3)
			logger.debug((argv.source ||= this.stringify(args as any, options)));

		// before hooks
		for (const validator of this._checkers) {
			const result = await validator.call(this, argv as any, ...args);
			if (!isNullable(result)) return result;
		}

		// FIXME empty actions will cause infinite loop
		if (!this._actions.length) return "";

		let index = 0;
		const queue: Next.Queue = this._actions.map((action) => async () => {
			return await action.call(this, argv, ...args);
		});

		queue.push(fallback);
		const length = queue.length;
		argv.next = async (callback) => {
			if (callback !== undefined) {
				queue.push((next) => Next.compose(callback, next));
				if (queue.length > Next.MAX_DEPTH) {
					throw new Error(`middleware stack exceeded ${Next.MAX_DEPTH}`);
				}
			}
			return queue[index++]?.(argv.next);
		};

		try {
			const result = await argv.next();
			if (!isNullable(result)) return result;
		} catch (err) {
			if (index === length) throw err;
			if (err instanceof SessionError) {
				return argv.session?.text(err.path, err.param) ?? "";
			}
			const stack = coerce(err);
			logger.warn(
				`${(argv.source ||= this.stringify(args as any, options))}\n${stack}`,
			);
			this.ctx.emit(argv.session, "command-error", argv, err);
			if (typeof this.config.handleError === "function") {
				const result = await this.config.handleError(err as Error, argv);
				if (!isNullable(result)) return result;
			} else if (this.config.handleError) {
				return argv.session?.text("internal.error-encountered") ?? "";
			}
		}

		return "";
	}

	dispose() {
		this._disposables.splice(0).forEach((dispose) => dispose());
		this.ctx.emit("command-removed", this);
		for (const cmd of this.children.slice()) {
			cmd.dispose();
		}
		remove(this.ctx.$commander._commandList, this);
		this.parent = null;
	}

	toJSON(): Universal.Command {
		return {
			name: this.name,
			description: this.ctx.i18n.get(`commands.${this.name}.description`),
			arguments: this._arguments.map((arg) => ({
				name: arg.name ?? this.name,
				type: toStringType(arg.type ?? "string"),
				description: this.ctx.i18n.get(
					`commands.${this.name}.arguments.${arg.name}`,
				),
				required: arg.required ?? false,
			})),
			options: Object.entries(this._options).map(([name, option]) => ({
				name,
				type: toStringType(option.type ?? "string"),
				description: this.ctx.i18n.get(`commands.${this.name}.options.${name}`),
				required: option.required ?? false,
			})),
			children: this.children
				.filter((child) => child.name.includes("."))
				.map((child) => child.toJSON()),
		};
	}
}

function toStringType(type: Argv.Type) {
	return typeof type === "string" ? type : "string";
}

export namespace Command {
	export interface Config extends CommandBase.Config, Permissions.Config {
		captureQuote?: boolean;
		/** disallow unknown options */
		checkUnknown?: boolean;
		/** check argument count */
		checkArgCount?: boolean;
		/** show command warnings */
		showWarning?: boolean;
		/** handle error */
		handleError?:
			| boolean
			| ((error: Error, argv: Argv) => Awaitable<void | Fragment>);
		/** enable slash command */
		slash?: boolean;
	}
}
