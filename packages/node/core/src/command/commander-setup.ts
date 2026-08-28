import type { Universal } from "@satorijs/core";
import { defineProperty } from "cosmokit";
import { Context } from "../context";
import { Command } from "./command";
import type { Commander } from "./commander";
import { commandOptionSchema, registerBuiltinDomains } from "./domains";
import { Argv } from "./parser";
import validate from "./validate";

/** Commander 的构造期装配：绑定事件监听、schema 扩展与内置参数类型 */
export function setupCommander(cmdr: Commander, ctx: Context) {
	defineProperty(cmdr, Context.current, ctx);
	ctx.plugin(validate);

	ctx.before("parse", (content, session) => {
		// we need to make sure that the user truly has the intension to call a command
		const {
			isDirect,
			stripped: { prefix, appel },
		} = session;
		if (!isDirect && typeof prefix !== "string" && !appel) return;
		return Argv.parse(content);
	});

	ctx.on("interaction/command", (session) => {
		if (session.event?.argv) {
			const { name, options, arguments: args } = session.event.argv;
			session.execute({ name, args, options });
		} else {
			session.stripped.hasAt = true;
			session.stripped.appel = true;
			session.stripped.atSelf = true;
			session.stripped.prefix = "";
			defineProperty(
				session,
				"argv",
				ctx.bail("before-parse", session.content ?? "", session),
			);
			if (!session.argv) {
				ctx
					.logger("command")
					.warn("failed to parse interaction command:", session.content);
				return;
			}
			session.argv.root = true;
			session.argv.session = session;
			session.execute(session.argv);
		}
	});

	ctx.before("attach", (session) => {
		const { hasAt, appel } = session.stripped;
		if (!appel && hasAt) return;

		// strip prefix
		let content = session.stripped.content;
		for (const prefix of cmdr._resolvePrefixes(session)) {
			if (!content.startsWith(prefix)) continue;
			session.stripped.prefix = prefix;
			content = content.slice(prefix.length);
			break;
		}
		defineProperty(session, "argv", ctx.bail("before-parse", content, session));
		if (!session.argv) return;
		session.argv.root = true;
		session.argv.session = session;
	});

	ctx.middleware((session, next) => {
		// execute command
		if (!session.argv || !cmdr.resolveCommand(session.argv)) return next();
		return session.execute(session.argv, next);
	});

	ctx.middleware((session, next) => {
		// use `!prefix` instead of `prefix === null` to prevent from blocking other middlewares
		// we need to make sure that the user truly has the intension to call a command
		const {
			argv,
			quote,
			isDirect,
			stripped: { prefix, appel },
		} = session;
		if (argv?.command || (!isDirect && !prefix && !appel)) return next();
		const content = session.stripped.content.slice((prefix ?? "").length);
		const actual = (content.split(/\s/, 1)[0] ?? "").toLowerCase();
		if (!actual) return next();

		return next(async (next) => {
			const cache = new Map<string, Promise<boolean>>();
			const name = await session.suggest({
				actual,
				expect: cmdr.available(session),
				suffix: session.text("internal.suggest-command"),
				filter: (name) => {
					const command = cmdr.resolve(name, session);
					if (!command) return false;
					return ctx.permissions.test(
						`command:${command.name}`,
						session,
						cache,
					);
				},
			});
			if (!name) return next?.();
			const message =
				name +
				content.slice(actual.length) +
				(quote?.content ? " " + quote.content : "");
			return session.execute(message, next);
		});
	});

	ctx.schema.extend("command", Command.Config, 1000);
	ctx.schema.extend("command-option", commandOptionSchema, 1000);

	ctx.on("ready", () => {
		const bots = ctx.bots.filter(
			(v) => v.status === (1 satisfies Universal.Status) && v.updateCommands,
		);
		bots.forEach((bot) => cmdr.updateCommands(bot));
	});

	ctx.on("bot-status-updated", async (bot) => {
		if (bot.status !== (1 satisfies Universal.Status) || !bot.updateCommands)
			return;
		cmdr.updateCommands(bot);
	});

	registerBuiltinDomains(cmdr);
}
