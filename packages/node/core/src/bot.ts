// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Koishi 对 satori 协议层 `Bot` 的扩展实现。
 *
 * satori 的 `@satorijs/core` 提供了与平台无关的 `Bot` / `Adapter` 抽象；
 * 本文件在其上定义 `KoishiBot`，注入 Koishi 特有的两个能力：
 * - `getGuildMemberMap`：把群成员迭代器拍平成 userId -> 昵称 的映射表；
 * - `broadcast`：按频道列表批量发送消息，支持限速与失败容忍。
 *
 * 通过 `declare module` 的方式为 satori 的 `Bot` 接口补充这两个方法的类型声明，
 * 使所有适配器产出的 bot 实例都能调用它们。
 */
import { sleep } from "@koishi-ce/utils";
import { Adapter, Bot, type Fragment } from "@satorijs/core";
import { type Dict, defineProperty } from "cosmokit";
import type { Context } from "./context/index.ts";
import type { Session } from "./session/index.ts";

declare module "@satorijs/core" {
	interface Bot {
		/** @deprecated 已废弃：请改用 {@link Bot.getGuildMemberIter} 迭代器逐个获取成员。 */
		getGuildMemberMap(guildId: string): Promise<Dict<string>>;
		/**
		 * 向多个频道批量发送相同内容的消息。
		 *
		 * @param channels 目标频道列表，支持三种形式：频道 ID 字符串、
		 * `[guildId, channelId]` 元组、或现成的 Session 对象（复用其上下文）
		 * @param content 消息内容（Fragment 片段）
		 * @param delay 相邻两条消息之间的间隔毫秒数，用于规避平台风控
		 * @returns 成功发送的消息 ID 列表（单条失败不会中断后续发送）
		 */
		broadcast(
			channels: (string | [string, string] | Session)[],
			content: Fragment,
			delay?: number,
		): Promise<string[]>;
	}
}

// 适配器插件通常不参与 Koishi 的会话过滤体系，这里显式关闭
// filter 属性注入，避免 Bot / Adapter 实例被误认为可过滤的服务
defineProperty(Bot, "filter", false);
defineProperty(Adapter, "filter", false);

// biome-ignore lint/correctness/noUnusedVariables: 该接口与同名类声明合并，为类实例注入 satori Bot 的 this 成员（this.getGuildMemberIter 等），并非冗余
interface KoishiBot extends Bot<Context> {}

/**
 * Koishi 的 Bot 实现。
 *
 * 本身不继承 satori Bot 的全部逻辑，而是通过 cordis 的 `ctx.mixin`
 * 把下列方法混入运行时上下文，使其成为可被插件调用、可被事件系统追踪的服务方法。
 */
class KoishiBot {
	constructor(ctx: Context) {
		// 将实例方法注册为 ctx 上的服务（bot.getGuildMemberMap / bot.broadcast），
		// 这样其它插件可以通过 ctx.bot.broadcast 调用，并享受依赖注入解析
		ctx.mixin(this, {
			getGuildMemberMap: "bot.getGuildMemberMap",
			broadcast: "bot.broadcast",
		});
	}

	/**
	 * 获取指定群内全部成员的映射表（userId -> 昵称）。
	 *
	 * 内部基于 {@link Bot.getGuildMemberIter} 迭代器实现，可自动处理平台分页。
	 * 昵称取值优先级：群昵称 member.name > 用户名 user.name > userId 兜底。
	 *
	 * @param guildId 目标群号
	 * @returns userId 到昵称的映射
	 */
	async getGuildMemberMap(guildId: string) {
		const result: Dict<string> = {};
		for await (const member of this.getGuildMemberIter(guildId)) {
			if (!member.user) continue;
			result[member.user.id] =
				member.name || member.user.name || member.user.id;
		}
		return result;
	}

	/**
	 * 向多个频道批量发送消息（实现见同文件上方接口注释）。
	 *
	 * 默认限速取根上下文配置 `delay.broadcast`；单条发送失败只记录警告日志，
	 * 不中断循环，最终返回所有成功消息的 ID。
	 */
	async broadcast(
		channels: (string | [string, string] | Session)[],
		content: Fragment,
		delay = this.ctx.root.config.delay.broadcast,
	) {
		const ids: string[] = [];
		for (let index = 0; index < channels.length; index++) {
			// 首条消息前不等待，之后每条按 delay 间隔发送以防风控
			if (index && delay) await sleep(delay);
			try {
				const value = channels[index];
				if (!value) continue;
				ids.push(
					...(typeof value === "string"
						? await this.sendMessage(value, content)
						: Array.isArray(value)
							? await this.sendMessage(value[0], content, value[1])
							: await this.sendMessage(
									value.channelId ?? "",
									content,
									value.guildId,
									{ session: value },
								)),
				);
			} catch (error) {
				this.ctx.logger("bot").warn(error);
			}
		}
		return ids;
	}
}

export default KoishiBot;
