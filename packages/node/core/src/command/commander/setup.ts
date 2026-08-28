/**
 * Commander 的构造期装配：绑定事件监听、schema 扩展与内置参数类型。
 *
 * 装配内容包括：
 * - before-parse：判定消息是否有命令意图并做 tokenize；
 * - interaction/command：平台斜线指令的两条接入路径；
 * - before-attach：剥离子令前缀并解析出 argv；
 * - 命令执行与「命令纠错建议」两条中间件；
 * - command / command-option 的 schema 扩展；
 * - 机器人上线时同步斜线指令；注册内置 domain。
 */

import type { Universal } from "@satorijs/core";
import { defineProperty } from "cosmokit";
import { Context } from "../../context";
import { Command } from "../command/command";
import type { Commander } from "./commander";
import { commandOptionSchema, registerBuiltinDomains } from "../domains";
import { Argv } from "../parser";
import validate from "../validate";

/** Commander 的构造期装配：绑定事件监听、schema 扩展与内置参数类型 */
export function setupCommander(cmdr: Commander, ctx: Context) {
	defineProperty(cmdr, Context.current, ctx);
	ctx.plugin(validate);

	ctx.before("parse", (content, session) => {
		// 群聊消息必须带前缀或称呼才算命令调用，避免普通聊天被误解析
		const {
			isDirect,
			stripped: { prefix, appel },
		} = session;
		if (!isDirect && typeof prefix !== "string" && !appel) return;
		return Argv.parse(content);
	});

	// 平台侧斜线指令（interaction）接入：
	// 平台已给出结构化 argv 时直接按名执行；
	// 否则伪装成带称呼的根消息，走一遍常规解析链
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

		// 剥离命令前缀：候选前缀按长度降序尝试（见 _resolvePrefixes）
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
		// 命令执行中间件：argv 能推断出命令则执行，否则交给后续中间件
		if (!session.argv || !cmdr.resolveCommand(session.argv)) return next();
		return session.execute(session.argv, next);
	});

	// 命令纠错建议中间件：消息有命令意图但未命中时，
	// 在所有普通中间件之后（next 回调）给出"您要找的是否是 xxx"建议
	ctx.middleware((session, next) => {
		// 用 `!prefix` 而非 `prefix === null` 判断，避免空串前缀场景阻断其它中间件；
		// 同样需确认用户确有命令调用意图
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
			// 权限判定结果缓存：同一命令在多个候选名间复用
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
			// 用户接受建议：拼回完整命令（含剩余参数与引用）重新执行
			const message =
				name +
				content.slice(actual.length) +
				(quote?.content ? " " + quote.content : "");
			return session.execute(message, next);
		});
	});

	// 扩展控制台配置面板使用的 command / command-option schema
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
