import { sleep } from "@koishi-ce/utils";
import { Adapter, Bot, type Fragment } from "@satorijs/core";
import { type Dict, defineProperty } from "cosmokit";
import type { Context } from "./context";
import type { Session } from "./session";

declare module "@satorijs/core" {
	interface Bot {
		/** @deprecated */
		getGuildMemberMap(guildId: string): Promise<Dict<string>>;
		broadcast(
			channels: (string | [string, string] | Session)[],
			content: Fragment,
			delay?: number,
		): Promise<string[]>;
	}
}

// adapter plugins usually do not respect filters
defineProperty(Bot, "filter", false);
defineProperty(Adapter, "filter", false);

interface KoishiBot extends Bot<Context> {}

class KoishiBot {
	constructor(ctx: Context) {
		ctx.mixin(this, {
			getGuildMemberMap: "bot.getGuildMemberMap",
			broadcast: "bot.broadcast",
		});
	}

	async getGuildMemberMap(guildId: string) {
		const result: Dict<string> = {};
		for await (const member of this.getGuildMemberIter(guildId)) {
			if (!member.user) continue;
			result[member.user.id] =
				member.name || member.user.name || member.user.id;
		}
		return result;
	}

	async broadcast(
		channels: (string | [string, string] | Session)[],
		content: Fragment,
		delay = this.ctx.root.config.delay.broadcast,
	) {
		const ids: string[] = [];
		for (let index = 0; index < channels.length; index++) {
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
