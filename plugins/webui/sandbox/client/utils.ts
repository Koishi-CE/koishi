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

export const panelTypes = {
	private: "私聊模式",
	guild: "群聊模式",
	profile: "用户设置",
};

interface SandboxConfig {
	platform: string;
	user: string;
	index: number;
	messages: Dict<Message[]>;
	panelType: keyof typeof panelTypes;
}

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

export const channel = computed(() => {
	if (config.value.panelType === "guild") return "#";
	return "@" + config.value.user;
});

receive("sandbox/message", (message: Message) => {
	if (message.platform !== config.value.platform) return;
	(config.value.messages[message.channel] ||= []).push(message);
});

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

receive<{ method: string; nonce: string; data: unknown }>(
	"sandbox/request",
	({ method, nonce, data }) => {
		// 方法名与载荷形状由服务端 SandboxBot.request 动态约定，按统一签名分发
		const handler = (api as Record<string, (data: unknown) => unknown>)[method];
		const result = handler?.(data);
		void send("sandbox/response", nonce, result);
	},
);

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
