/**
 * CommanderCore：命令服务的核心能力层。
 *
 * 职责：维护全局命令列表 `_commandList`；按别名（含 filter）查找命令；
 * 逐级解析点分命令路径；prefix 计算；向平台同步斜线指令；
 * 以及 domain（参数类型）的注册 / 解析与声明解析、值转换的委托入口。
 * 继承链：CommanderCore → CommanderResolve → CommanderRegister → Commander。
 */

import { type Bot, h } from "@satorijs/core";
import type { Context } from "../../context/index.ts";
import type { Computed } from "../../filter.ts";
import type { Session } from "../../session/index.ts";
import type { Command } from "../command/command.ts";
import { parseDecl, parseValue, resolveDomain } from "../declaration.ts";
import { normalizeCommand } from "../normalize.ts";
import type { Argv } from "../parser/index.ts";

/** 命令服务配置 */
export interface CommanderConfig {
	/** 指令前缀（Computed，可按会话计算）；支持字符串或数组 */
	prefix?: Computed<string | string[]>;
	/**
	 * 前缀判定模式：
	 * "auto"（默认）群聊需前缀或称呼，私聊直接识别；
	 * "strict" 任何场景都要求前缀
	 */
	prefixMode?: "auto" | "strict";
}

export class CommanderCore {
	/** 全局命令注册表（含所有层级命令） */
	_commandList: Command[] = [];

	protected ctx!: Context;
	protected config!: CommanderConfig;

	/**
	 * 按别名精确查找命令。
	 * @param name 归一化后的命令名或别名
	 * @param session 提供时还会校验该别名的 filter 是否放行本会话
	 */
	get(name: string, session?: Session) {
		return this._commandList.find((cmd) => {
			if (!Object.hasOwn(cmd._aliases, name)) return false;
			const alias = cmd._aliases[name];
			if (!alias) return false;
			return session?.resolve(alias.filter) ?? true;
		});
	}

	/** 把顶层命令（非子命令且启用 slash）同步给平台作为斜线指令 */
	updateCommands(bot: Bot) {
		return bot.updateCommands(
			this._commandList
				.filter((cmd) => !cmd.name.includes(".") && cmd.config.slash)
				.map((cmd) => cmd.toJSON()),
		);
	}

	/**
	 * 计算当前会话的候选前缀列表（已转义）。
	 * 按长度降序排列，保证最长前缀优先匹配（如 "!" 先于 ""）。
	 */
	_resolvePrefixes(session: Session) {
		const value = session.resolve(this.config.prefix);
		const result = Array.isArray(value) ? value : [value || ""];
		return result
			.map((source) => h.escape(source))
			.sort()
			.reverse();
	}

	/** 当前会话可用的全部命令名（含别名），用于命令纠错建议 */
	available(session: Session) {
		return this._commandList
			.filter((cmd) => cmd.match(session))
			.flatMap((cmd) =>
				Object.entries(cmd._aliases)
					.filter(([, alias]) => session.resolve(alias.filter) ?? true)
					.map(([name]) => name),
			);
	}

	/** 按点分路径解析命令（如 "a.b.c"），返回末级命令 */
	resolve(key: string, session?: Session) {
		return this._resolve(key, session).command;
	}

	/**
	 * 逐级解析点分路径：每命中一级命令就尝试拼接下一段，
	 * 直到无法继续或路径耗尽。
	 * @returns 命中的命令与最后一段名（用于取回别名配置）
	 */
	_resolve(key: string, session?: Session) {
		if (!key) return {};
		const segments = normalizeCommand(key).split(".");
		let i = 1,
			name = segments[0] ?? "",
			command: Command | undefined;
		while ((command = this.get(name, session)) && i < segments.length) {
			name = `${command.name}.${segments[i++] ?? ""}`;
		}
		return { command, name };
	}

	/**
	 * domain（参数类型）的注册 / 查询。
	 * 只传 name 时查询既有的 domain 配置；
	 * 同时传 transform 时注册为新 domain（写入 ctx 服务 `domain:<name>`），
	 * 返回反注册函数。
	 */
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
		const service = `domain:${name}`;
		if (!transform) return this.ctx.get(service);
		return this.ctx.set(service, { transform, ...options });
	}

	/** 把类型标注解析为 domain 配置（内置名查服务，其余按字面量构造） */
	resolveDomain(type: Argv.Type | undefined) {
		return resolveDomain(this.ctx, type);
	}

	/** 值转换委托：按声明类型把原始字符串强转，失败写入 argv.error */
	parseValue(
		source: string,
		kind: string,
		argv: Argv,
		decl: Argv.Declaration = {},
	) {
		return parseValue(this.ctx, source, kind, argv, decl);
	}

	/** 声明解析委托：解析定义串中的参数声明列表 */
	parseDecl(source: string) {
		return parseDecl(this.ctx, source);
	}
}
