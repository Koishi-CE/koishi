// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 会话命令执行层：数据字段收集与指令执行装配。
 *
 * collect 汇总执行某条 argv 所需的 user / channel 表字段
 * （含嵌套插值指令的字段，并让监听 before-attach-* 的插件补充）；
 * execute 是完整执行入口：插值展开 -> 指令定位 -> 过滤器准入 ->
 * 数据预取 -> 进入指令 i18n 作用域执行 -> 发送结果。
 */
import { h, Logger } from "@satorijs/core";
import { Argv } from "../command/index.ts";
import type { Context } from "../context/index.ts";
import type { Tables } from "../database/index.ts";
import type { Next } from "../middleware/index.ts";
import { SessionLocalized } from "./locale.ts";
import type { FieldCollector } from "./types.ts";
import { collectFields } from "./types.ts";

const logger = new Logger("session");

/** 会话命令执行层：字段收集与命令执行装配 */
export interface SessionExecutable extends SessionLocalized {}

export class SessionExecutable extends SessionLocalized {
	/**
	 * 收集执行 argv 指令所需的 user / channel 表字段。
	 *
	 * 递归处理 argv 中的插值指令（inters），触发
	 * `command/before-attach-{user|channel}` 事件让监听插件补充字段，
	 * 最后合并目标指令通过 `_{key}Fields` 声明的字段列表。
	 */
	override collect<T extends "user" | "channel">(
		key: T,
		argv: Argv | undefined,
		fields = new Set<keyof Tables[T]>(),
	): Set<keyof Tables[T]> {
		const collect = (argv: Argv) => {
			argv.session = this;
			if (argv.tokens) {
				for (const { inters } of argv.tokens) {
					inters.forEach(collect);
				}
			}
			const command = this.app.$commander.resolveCommand(argv);
			if (!command) return;
			// 事件名与 fields 的具体类型由泛型 T 决定，emit 的重载无法表达该映射，
			// 退化为运行时事件总线签名调用
			const emit = (this.app as Context).emit as (
				session: unknown,
				name: `command/before-attach-${T}`,
				argv: Argv,
				fields: Set<keyof Tables[T]>,
			) => void;
			emit(argv.session, `command/before-attach-${key}`, argv, fields);
			collectFields(
				argv,
				(command as unknown as Record<`_${T}Fields`, FieldCollector<T>[]>)[
					`_${key}Fields`
				],
				fields,
			);
		};
		if (argv) collect(argv);
		return fields;
	}

	/**
	 * 执行一条指令。
	 *
	 * 流程：
	 * 1. 字符串先解析为 Argv；带 tokens 时先把所有插值（inters）递归执行
	 *    并把输出按原位置回填到参数文本中（倒序回填避免位置偏移）；
	 * 2. 解析出目标指令（找不到则静默返回 / 警告）；
	 * 3. 通过指令所属上下文的 filter 准入检查；
	 * 4. 预取频道/用户数据（群聊含 permissions、locales 等权限相关字段）；
	 * 5. 进入指令的 i18n 作用域执行；next 为 true 时只返回结果不发送。
	 */
	override async execute(argv: string | Argv, next?: true | Next) {
		if (typeof argv === "string") argv = Argv.parse(argv);

		argv.session = this;
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
				// 倒序回填：从后往前替换，前面的插值位置才不会因文本变长而错位
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
			// 群聊需要观察频道与群两级数据；用户数据始终观察
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

		// next === true 表示本次调用是被别处（如插值）复用的内部执行，不发送结果
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
