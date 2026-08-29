/**
 * 沙盒消息编码器：机器人回复消息的出口。
 *
 * 机器人侧发送的内容经 visit() 逐元素累积到 buffer，在边界（flush /
 * message / figure 分段）时整体转换并通过 WebSocket 以 sandbox/message
 * 事件推回浏览器上屏；媒体资源若为 file: 协议，改写到沙盒静态文件服务。
 */
import { type Dict, h, MessageEncoder, Random } from "@koishi-ce/koishi";
import type { SandboxBot } from "./bot";

// 不携带类型参数：上游 Bot 的静态 MessageEncoder 签名以默认 Context 的 Bot 为参数，
// 若以 koishi Context 或 SandboxBot 为类型参数会产生构造参数逆变冲突（TS2417），见 mock 包同款处理
export class SandboxMessenger extends MessageEncoder {
	private buffer = "";

	// 媒体元素转换规则:image/img/audio/video/file 的 src 为 file: 协议时,
	// 重写为沙盒静态文件服务的 HTTP 地址,其余原样透传
	private rules: Dict<h.Transformer> = Object.fromEntries(
		["image", "img", "audio", "video", "file"].map((type) => {
			return [
				type,
				async (attrs) => {
					const src = attrs["src"] || attrs["url"];
					const type1 = type === "image" ? "img" : type;
					if (src.startsWith("file:")) {
						return h(type1, {
							...attrs,
							src: `${this.bot.ctx.server.selfUrl}/sandbox/${src}`,
						});
					}
					return h(type1, { ...attrs, src });
				},
			];
		}),
	);

	/** 把 buffer 中累积的内容作为一条机器人消息推送到浏览器，并记录到 results。 */
	async flush() {
		if (!this.buffer.trim()) return;
		const content = await h.transformAsync(this.buffer.trim(), this.rules);
		// 本编码器经 SandboxBot.MessageEncoder 挂载，运行时 this.bot 必为 SandboxBot
		const bot = this.bot as unknown as SandboxBot;
		const session = bot.session(this.session.event);
		session.messageId = Random.id();
		bot.client.send({
			type: "sandbox/message",
			body: {
				content,
				user: "Koishi",
				channel: session.channelId,
				id: session.messageId,
				platform: session.platform,
			},
		});
		// messageId 访问器（defineAccessor）赋值时会确保 event.message 已创建
		const { message } = session.event;
		if (message) this.results.push(message);
		this.buffer = "";
	}

	/** 逐元素访问：分段元素（message/figure）前后各触发一次 flush，其余以字符串形式累积。 */
	async visit(element: h) {
		const { type, children } = element;
		if (type === "message" || type === "figure") {
			await this.flush();
			await this.render(children);
			await this.flush();
		} else {
			this.buffer += element.toString();
		}
	}
}
