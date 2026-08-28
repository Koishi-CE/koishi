/**
 * sandbox 浏览器侧的共享状态与"平台适配器后端"。
 *
 * - config：经 useStorage 持久化的沙盒状态（平台名、当前用户、各频道消息）；
 * - api：实现服务端 SandboxBot.request 所需的获取类方法（消息 / 频道 / 群成员），
 *   数据直接来自本地保存的沙盒消息；
 * - receive()：接收 node 侧推送的 sandbox/message、sandbox/clear 与 sandbox/request。
 */
import { receive, send, useStorage } from "@koishi-ce/client";
import type { Dict } from "@koishi-ce/koishi";
import type { Message } from "@koishi-ce/plugin-sandbox";
import type { RemovableRef } from "@vueuse/core";
import { computed } from "vue";

declare module "@koishi-ce/client" {
	interface ActionContext {
		"sandbox.message": Message;
	}
}

// 浏览器侧协议事件的类型增强：send() 的类型来自 @koishi-ce/client 内置的
// "@koishi-ce/plugin-console" 手写垫片（见 packages/web/client/client/shims.d.ts），
// 与服务端 src/index.ts 对 "@koishi-ce/console" 的增强一一对应
declare module "@koishi-ce/plugin-console" {
	interface Events {
		"sandbox/response"(nonce: string, data?: unknown): void;
	}
}

/** 沙盒右上角面板类型：私聊 / 群聊 / 用户设置。 */
export const panelTypes = {
	private: "私聊模式",
	guild: "群聊模式",
	profile: "用户设置",
};

/** 沙盒持久化状态的形状。 */
interface SandboxConfig {
	platform: string;
	user: string;
	index: number;
	messages: Dict<Message[]>;
	panelType: keyof typeof panelTypes;
}

/**
 * 沙盒全局状态（键名 "sandbox"，结构版本 1.1）：
 * platform 在首次初始化时生成随机的 `sandbox:` 前缀平台名，与 node 侧
 * SandboxBot 的平台一一对应；messages 以频道 id（`@私聊` / `#` 群聊）分组。
 */
export const config: RemovableRef<SandboxConfig> = useStorage<SandboxConfig>(
	"sandbox",
	1.1,
	() => ({
		platform: "sandbox:" + Math.random().toString(36).slice(2),
		user: "",
		index: 0,
		messages: {},
		panelType: "private",
	}),
);

/** 当前会话的频道 id：群聊固定为 `#`，私聊为 `@当前用户`。 */
export const channel = computed(() => {
	if (config.value.panelType === "guild") return "#";
	return "@" + config.value.user;
});

// 机器人回复到达:归属本平台的消息按频道归档上屏
receive("sandbox/message", (message: Message) => {
	if (message.platform !== config.value.platform) return;
	(config.value.messages[message.channel] ||= []).push(message);
});

// clear 命令:清空当前频道的消息列表
receive("sandbox/clear", () => {
	config.value.messages[channel.value] = [];
});

// 各方法载荷形状与服务端 SandboxBot 的同名 request 调用对应
export const api = {
	deleteMessage({
		messageId,
		channelId,
	}: {
		messageId: string;
		channelId: string;
	}) {
		const messages = config.value.messages[channelId];
		if (!messages) return;
		config.value.messages[channelId] = messages.filter(
			(msg) => msg.id !== messageId,
		);
	},
	getMessage({
		messageId,
		channelId,
	}: {
		messageId: string;
		channelId: string;
	}) {
		return config.value.messages[channelId]?.find(
			(msg) => msg.id === messageId,
		);
	},
	getChannel(_data: { channelId: string; guildId?: string }) {
		return { channelId: "#" };
	},
	getChannelList(_data: { guildId: string }) {
		return { data: { channelId: "#" } };
	},
	getGuild(_data: { guildId: string }) {
		return { guildId: "#" };
	},
	getGuildList() {
		return { data: { guildId: "#" } };
	},
	getGuildMember({ userId }: { guildId: string; userId: string }) {
		return { userId, username: userId };
	},
	getGuildMemberList(_data: { guildId: string }) {
		const data = Object.keys(config.value.messages)
			.filter((id) => id.startsWith("@"))
			.map((key) => {
				const userId = key.slice(1);
				return { userId, username: userId };
			});
		return { data };
	},
};

// node 侧 SandboxBot.request 转来的调用:按 method 查表执行并以 sandbox/response 应答
receive<{ method: string; nonce: string; data: unknown }>(
	"sandbox/request",
	({ method, nonce, data }) => {
		// 方法名与载荷形状由服务端 SandboxBot.request 动态约定，按统一签名分发
		const handler = (api as Record<string, (data: unknown) => unknown>)[method];
		const result = handler?.(data);
		void send("sandbox/response", nonce, result);
	},
);

/** 沙盒用户昵称候选表（与服务端 src/bot.ts 的 words 保持一致）。 */
export const words = [
	"Alice",
	"Bob",
	"Carol",
	"Dave",
	"Eve",
	"Frank",
	"Grace",
	"Hank",
	"Ivy",
	"Jack",
	"Kathy",
	"Lily",
	"Mandy",
	"Nancy",
	"Oscar",
	"Peggy",
	"Quinn",
	"Randy",
	"Sandy",
	"Toby",
	"Uma",
	"Vicky",
	"Wendy",
	"Xander",
	"Yvonne",
	"Zoe",
];
