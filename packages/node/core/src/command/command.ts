import { coerce } from "@koishi-ce/utils";
import { type Fragment, Logger, Schema, type Universal } from "@satorijs/core";
import { type Awaitable, type Dict, isNullable, remove } from "cosmokit";
import type { Channel, User } from "../database";
import type { Computed } from "../filter";
import { Next, SessionError } from "../middleware";
import type { Permissions } from "../permission";
import type { Session } from "../session";
import { CommandDefinition } from "./command-definition";
import { normalizeCommand } from "./normalize";
import type { Argv, CommandBase } from "./parser";

const logger = new Logger("command");

export type Extend<O extends {}, K extends string, T> = {
	[P in K | keyof O]?: (P extends keyof O ? O[P] : unknown) &
		(P extends K ? T : unknown);
};

export class Command<
	U extends User.Field = never,
	G extends Channel.Field = never,
	A extends any[] = any[],
	O extends {} = {},
> extends CommandDefinition<U, G, A, O> {
	static normalize(name: string) {
		return normalizeCommand(name);
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
			const result = await validator.call(this as any, argv as any, ...args);
			if (!isNullable(result)) return result;
		}

		// FIXME empty actions will cause infinite loop
		if (!this._actions.length) return "";

		let index = 0;
		const queue: Next.Queue = this._actions.map((action) => async () => {
			return await action.call(this as any, argv, ...args);
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
		remove(this.ctx.$commander._commandList, this as any);
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
