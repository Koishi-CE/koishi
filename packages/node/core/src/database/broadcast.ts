// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 数据库驱动的全服广播实现。
 *
 * 供 KoishiDatabase.broadcast 调用：查出所有受理频道，按
 * platform -> assignee 分组，为每个 bot 构造合成的发送会话后
 * 委托 bot.broadcast 批量发送（见 bot.ts）。
 */
import type { Fragment, Universal } from "@satorijs/core";
import type { Dict } from "cosmokit";
import type KoishiDatabase from "./index.ts";
import { Channel } from "./tables.ts";

/**
 * 全量广播消息：向所有受让人匹配的频道发送内容
 *
 * @param db 数据库服务实例
 * @param args 单元素重载 [content, forced] 广播全部受理频道；
 *   三元素重载 [channels, content, forced] 限定 `platform:channelId` 列表
 * @returns 全部成功发送的消息 id（扁平化）
 */
export async function broadcastDatabase(
	db: KoishiDatabase,
	...args: [Fragment, boolean?] | [readonly string[], Fragment, boolean?]
): Promise<string[]> {
	let channels: string[] | undefined;
	let platforms: string[] | undefined;
	if (Array.isArray(args[0])) {
		channels = args.shift() as string[];
		// 频道形如 "platform:channelId"，取出平台部分以缩小查询范围
		platforms = channels.map((c) => c.split(":")[0] ?? c);
	}
	const [content, forced] = args as [Fragment, boolean];
	if (!content) return [];

	const selfIdMap = db.getSelfIds(platforms);
	const data = await db.getAssignedChannels(
		["id", "assignee", "flag", "platform", "guildId", "locales"],
		selfIdMap,
	);
	// assignMap: platform -> assignee(selfId) -> 待发频道列表
	const assignMap: Dict<Dict<Pick<Channel, "id" | "guildId" | "locales">[]>> =
		{};
	for (const channel of data) {
		const { platform, id, assignee, flag } = channel;
		if (channels) {
			// 命中目标列表则从待匹配列表移除（结束时剩余的即"未找到"）
			const index = channels?.indexOf(`${platform}:${id}`);
			if (index < 0) continue;
			channels.splice(index, 1);
		}
		// 非强制模式下跳过静默频道
		if (!forced && flag & Channel.Flag.silent) continue;
		((assignMap[platform] ||= {})[assignee] ||= []).push(channel);
	}

	if (channels?.length) {
		db.ctx
			.logger("app")
			.warn("broadcast", "channel not found: ", channels.join(", "));
	}

	return (
		await Promise.all(
			db.ctx.bots.map((bot) => {
				const targets = bot.platform
					? assignMap[bot.platform]?.[bot.selfId]
					: undefined;
				if (!targets) return Promise.resolve([]);
				// 为每个目标频道构造合成会话（复用频道语言设置），
				// 让发送走 bot.broadcast 的统一链路（限速、错误容忍）
				const sessions = targets.map(({ id, guildId, locales }) => {
					const session = bot.session({
						type: "message",
						channel: { id, type: 0 satisfies Universal.Channel.Type },
						guild: { id: guildId },
					});
					session.locales = locales;
					return session;
				});
				return bot.broadcast(sessions, content);
			}),
		)
	).flat(1);
}
