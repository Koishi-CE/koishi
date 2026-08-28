import type { Awaitable, Fragment } from "@satorijs/core";
import type { Channel, User } from "../database";
import type { Session } from "../session";
import type { Command } from "./command";
import type { Commander } from "./commander";
import type { Argv } from "./parser";

export * from "./command";
export * from "./commander";
export { CommanderCore } from "./commander-core";
export { CommanderRegister } from "./commander-register";
export { CommanderResolve } from "./commander-resolve";
export * from "./parser";
export * from "./validate";

declare module "../context" {
	interface Context {
		$commander: Commander;
		command<D extends string>(
			def: D,
			config?: Command.Config,
		): Command<never, never, Argv.ArgumentType<D>>;
		command<D extends string>(
			def: D,
			desc: string,
			config?: Command.Config,
		): Command<never, never, Argv.ArgumentType<D>>;
	}

	interface Events {
		"before-parse"(content: string, session: Session): Argv | undefined;
		"command-added"(command: Command): void;
		"command-updated"(command: Command): void;
		"command-removed"(command: Command): void;
		"command-error"(argv: Argv, error: any): void;
		"command/before-execute"(argv: Argv): Awaitable<void | Fragment>;
		"command/before-attach-channel"(
			argv: Argv,
			fields: Set<Channel.Field>,
		): void;
		"command/before-attach-user"(argv: Argv, fields: Set<User.Field>): void;
	}
}
