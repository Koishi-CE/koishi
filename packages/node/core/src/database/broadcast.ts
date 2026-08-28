import type { Fragment, Universal } from "@satorijs/core";
import type { Dict } from "cosmokit";
import type KoishiDatabase from "./index";
import { Channel } from "./tables";

/** 全量广播消息：向所有受让人匹配的频道发送内容 */
export async function broadcastDatabase(
	db: KoishiDatabase,
	...args: [Fragment, boolean?] | [readonly string[], Fragment, boolean?]
): Promise<string[]> {
	let channels: string[] | undefined;
	let platforms: string[] | undefined;
	if (Array.isArray(args[0])) {
		channels = args.shift() as string[];
		platforms = channels.map((c) => c.split(":")[0] ?? c);
	}
	const [content, forced] = args as [Fragment, boolean];
	if (!content) return [];

	const selfIdMap = db.getSelfIds(platforms);
	const data = await db.getAssignedChannels(
		["id", "assignee", "flag", "platform", "guildId", "locales"],
		selfIdMap,
	);
	const assignMap: Dict<Dict<Pick<Channel, "id" | "guildId" | "locales">[]>> =
		{};
	for (const channel of data) {
		const { platform, id, assignee, flag } = channel;
		if (channels) {
			const index = channels?.indexOf(`${platform}:${id}`);
			if (index < 0) continue;
			channels.splice(index, 1);
		}
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
