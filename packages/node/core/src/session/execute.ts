import { h, Logger } from "@satorijs/core";
import type { Dict } from "cosmokit";
import { Argv } from "../command";
import type { Context } from "../context";
import type { Tables } from "../database";
import type { Next } from "../middleware";
import { SessionLocalized } from "./locale";
import type { Session } from "./types";
import { collectFields } from "./types";

const logger = new Logger("session");

/** 会话命令执行层：字段收集与命令执行装配 */
export interface SessionExecutable extends SessionLocalized {}

export class SessionExecutable extends SessionLocalized {
	override collect<T extends "user" | "channel">(
		key: T,
		argv: Argv | undefined,
		fields = new Set<keyof Tables[T]>(),
	): Set<keyof Tables[T]> {
		const collect = (argv: Argv) => {
			argv.session = this as Session<any, any, any>;
			if (argv.tokens) {
				for (const { inters } of argv.tokens) {
					inters.forEach(collect);
				}
			}
			const command = this.app.$commander.resolveCommand(argv);
			if (!command) return;
			(this.app as Context).emit(
				argv.session,
				`command/before-attach-${key}` as any,
				argv,
				fields,
			);
			collectFields(argv, (command as Dict<any>)[`_${key}Fields`], fields);
		};
		if (argv) collect(argv);
		return fields;
	}

	override async execute(argv: string | Argv, next?: true | Next) {
		if (typeof argv === "string") argv = Argv.parse(argv);

		argv.session = this as Session<any, any, any>;
		if (argv.tokens) {
			for (const arg of argv.tokens) {
				const { inters } = arg;
				const output: string[] = [];
				for (let i = 0; i < inters.length; ++i) {
					const inter = inters[i];
					if (!inter) continue;
					const execution = await this.execute(inter, true);
					const transformed = await this.transform(execution);
					output.push(transformed.join(""));
				}
				for (let i = inters.length - 1; i >= 0; --i) {
					const inter = inters[i];
					if (!inter) continue;
					const { pos } = inter;
					arg.content =
						arg.content.slice(0, pos) +
						(output[i] ?? "") +
						arg.content.slice(pos);
				}
				arg.inters = [];
			}
			if (!this.app.$commander.resolveCommand(argv)) return [];
		} else {
			const command = argv.command ?? this.app.$commander.get(argv.name ?? "");
			if (!command) {
				logger.warn(new Error(`cannot find command ${argv.name}`));
				return [];
			}
			argv.command = command;
		}

		const { command } = argv;
		if (!command) return [];
		if (!command.ctx.filter(this)) return [];

		if (this.app.database) {
			if (!this.isDirect) {
				await this.observeChannel(
					this.collect("channel", argv, new Set(["permissions", "locales"])),
				);
			}
			await this.observeUser(
				this.collect(
					"user",
					argv,
					new Set(["authority", "permissions", "locales"]),
				),
			);
		}

		const shouldEmit = next !== true;

		return this.withScope(`commands.${command.name}.messages`, async () => {
			const result = await command.execute(
				argv as Argv,
				next === true ? undefined : next,
			);
			if (!shouldEmit) return h.normalize(result);
			await this.send(result);
			return [];
		});
	}
}
