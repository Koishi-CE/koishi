/**
 * 消息检查插件（inspect）。
 *
 * 提供 `inspect` 指令：查看当前会话或引用消息的平台、消息 ID、
 * 频道 / 群组 / 用户 / 自身 ID 等元信息；
 * 也可以直接检查消息中携带的 `<at>`（用户）或 `<sharp>`（频道）元素。
 */
import { type Context, h, Schema } from "@koishi-ce/koishi";
import zhCN from "../locales/zh-CN.yml";

export const name = "inspect";

/** 配置项（当前无可用配置） */
export type Config = Record<never, never>;

export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context) {
	ctx.i18n.define("zh-CN", zhCN);

	ctx
		.command("inspect", { captureQuote: false })
		.action(({ session }, target) => {
			if (!session) return;
			// 优先展示引用消息的信息（captureQuote 已关闭，引用保留在会话对象上）
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

			// 检查消息参数中携带的元素（@ 用户 / # 频道），其余元素视为无法解析
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
