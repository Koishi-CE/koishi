import { type Dict, h, MessageEncoder, Random } from "@koishi-ce/koishi";
import type { SandboxBot } from "./bot";

// 不携带类型参数：上游 Bot 的静态 MessageEncoder 签名以默认 Context 的 Bot 为参数，
// 若以 koishi Context 或 SandboxBot 为类型参数会产生构造参数逆变冲突（TS2417），见 mock 包同款处理
export class SandboxMessenger extends MessageEncoder {
	private buffer = "";

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

	async flush() {
		if (!this.buffer.trim()) return;
		const content = await h.transformAsync(this.buffer.trim(), this.rules);
		// 本编码器经 SandboxBot.MessageEncoder 挂载，运行时 this.bot 必为 SandboxBot
		const bot = this.bot as SandboxBot;
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
		this.results.push(session.event.message!);
		this.buffer = "";
	}

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
