import { type Context, h, Schema } from "@koishi-ce/koishi";
import zhCN from "./locales/zh-CN.yml";

export const name = "inspect";

export type Config = {};

export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context) {
	ctx.i18n.define("zh-CN", zhCN);

	ctx
		.command("inspect", { captureQuote: false })
		.action(({ session }, target) => {
			if (!session) return;
			if (session.quote) {
				return session.text(".message", {
					platform: session.platform,
					messageId: session.quote.id,
					guildId: session.guildId,
					selfId: session.selfId,
					userId: session.quote.user?.id,
					channelId: session.quote.channel?.id,
				});
			}

			if (target) {
				const element = h.parse(target)[0];
				if (!element) return session.text(".invalid");
				const { type, attrs } = element;
				if (type === "at") {
					return session.text(".user", attrs);
				} else if (type === "sharp") {
					return session.text(".channel", attrs);
				} else {
					return session.text(".invalid");
				}
			}

			return session.text(".message", session);
		});
}
