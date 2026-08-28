import type { Client } from "@koishi-ce/console";
import { Bot, type Context, Time, type Universal } from "@koishi-ce/koishi";
import { SandboxMessenger } from "./message";

export namespace SandboxBot {
	export interface Config {
		selfId: string;
		platform: string;
	}
}

export class SandboxBot<C extends Context = Context> extends Bot<
	C,
	SandboxBot.Config
> {
	// 上游 Bot 基类约定的 MessageEncoder 静态属性名
	static override MessageEncoder = SandboxMessenger;

	override hidden = true;
	override internal = {};

	// erasableSyntaxOnly 禁止构造器参数属性，改为显式字段声明 + 赋值
	public client: Client;

	constructor(ctx: C, client: Client, config: SandboxBot.Config) {
		super(ctx, config, "sandbox");
		this.client = client;
		this.selfId = config.selfId;
		this.platform = config.platform;
		// selfId 访问器（defineAccessor）赋值时会确保 user 对象已创建
		this.user!.name = "koishi";
	}

	async request<T = any>(method: string, data = {}) {
		const nonce = Math.random().toString(36).slice(2);
		return new Promise<T>((resolve, reject) => {
			const dispose1 = this.ctx.on("sandbox/response", (nonce2, data) => {
				if (nonce !== nonce2) return;
				dispose1();
				dispose2();
				resolve(data);
			});
			const dispose2 = this.ctx.setTimeout(() => {
				dispose1();
				dispose2();
				reject(new Error("timeout"));
			}, Time.second * 5);
			this.client.send({
				type: "sandbox/request",
				body: { method, data, nonce },
			});
		});
	}

	override async createDirectChannel(
		userId: string,
	): Promise<Universal.Channel> {
		// Universal.Channel.Type 是 ambient const enum（verbatimModuleSyntax 下禁止取值），
		// 用等价字面量 + satisfies 校验（1 = DIRECT）
		return { id: "@" + userId, type: 1 satisfies Universal.Channel.Type };
	}

	override async deleteMessage(channelId: string, messageId: string) {
		return this.request("deleteMessage", { channelId, messageId });
	}

	override async getMessage(channelId: string, messageId: string) {
		return this.request("getMessage", { channelId, messageId });
	}

	override async getChannel(channelId: string, guildId?: string) {
		return this.request("getChannel", { channelId, guildId });
	}

	override async getChannelList(guildId: string) {
		return this.request("getChannelList", { guildId });
	}

	override async getGuild(guildId: string) {
		return this.request("getGuild", { guildId });
	}

	override async getGuildList() {
		return this.request("getGuildList");
	}

	override async getGuildMember(guildId: string, userId: string) {
		return this.request("getGuildMember", { guildId, userId });
	}

	override async getGuildMemberList(guildId: string) {
		return this.request("getGuildMemberList", { guildId });
	}
}

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
