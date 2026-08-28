import { Context } from "../context";
import { Command } from "./command";
import { CommanderResolve } from "./commander-resolve";
import { normalizeCommand } from "./normalize";

export class CommanderRegister extends CommanderResolve {
	command(def: string, ...args: [Command.Config?] | [string, Command.Config?]) {
		const desc = typeof args[0] === "string" ? (args.shift() as string) : "";
		const config = args[0] as Command.Config;
		const path = normalizeCommand(def.split(" ", 1)[0] ?? def);
		const decl = def.slice(path.length);
		const segments = path.split(/(?=[./])/g);

		/** parent command in the chain */
		let parent: Command | undefined;
		/** the first created command */
		let root: Command | undefined;
		const created: Command[] = [];
		segments.forEach((segment, index) => {
			const code = segment.charCodeAt(0);
			const name =
				code === 46
					? (parent?.name ?? "") + segment
					: code === 47
						? segment.slice(1)
						: segment;
			let command = this.get(name);
			if (command) {
				if (parent) {
					if (command === parent) {
						throw new Error(
							`cannot set a command (${command.name}) as its own subcommand`,
						);
					}
					if (command.parent) {
						if (command.parent !== parent) {
							throw new Error(
								`cannot create subcommand ${path}: ${command.parent.name}/${command.name} already exists`,
							);
						}
					} else {
						command.parent = parent;
					}
				}
				parent = command;
				return;
			}
			const isLast = index === segments.length - 1;
			command = new Command(
				name,
				isLast ? decl : "",
				this.ctx,
				isLast ? config : {},
			);
			command._disposables.push(
				this.ctx.i18n.define("", {
					[`commands.${command.name}.$`]: "",
					[`commands.${command.name}.description`]: isLast ? desc : "",
				}),
			);
			created.push(command);
			root ||= command;
			if (parent) {
				command.parent = parent;
			}
			parent = command;
		});

		if (!parent) throw new Error(`invalid command definition: ${def}`);
		Object.assign(parent.config, config);
		// Make sure `command.config` is set before emitting any events
		created.forEach((command) => this.ctx.emit("command-added", command));
		parent[Context.current] = this.ctx;
		if (root) {
			const created = root;
			this.ctx.collect(`command <${created.name}>`, () => created.dispose());
		}
		return parent;
	}
}
