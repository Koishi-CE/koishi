import { type Dict, remove } from "cosmokit";
import { Context } from "../context";
import type { Command } from "./command";
import { normalizeCommand } from "./normalize";
import { CommandBase } from "./parser";

export class CommandCore extends CommandBase<Command.Config> {
	children: Command[] = [];

	_parent: Command | null = null;
	_aliases: Dict<Command.Alias> = Object.create(null);

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
		ctx.$commander._commandList.push(this as any);
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
			remove(this._parent.children, this as any);
		}
		this._parent = parent;
		if (parent) {
			parent.children.push(this as any);
		}
	}

	_registerAlias(name: string, prepend = false, options: Command.Alias = {}) {
		name = normalizeCommand(name);
		if (name.startsWith(".")) name = (this.parent?.name ?? "") + name;

		// check global
		const previous = this.ctx.$commander.get(name);
		if (previous && previous !== (this as any)) {
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
		this.caller.emit("command-updated", this as any);
		return this as any;
	}

	/** @deprecated */
	use<T extends Command, R extends any[]>(
		callback: (command: this, ...args: R) => T,
		...args: R
	): T {
		return callback(this, ...args);
	}
}
