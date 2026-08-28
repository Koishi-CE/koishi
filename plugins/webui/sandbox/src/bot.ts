/**
 * 沙盒机器人：把一个浏览器控制台连接（Client）包装成 Bot 适配器，
 * 让沙盒页面在 Koishi 眼中表现为一个真实的聊天平台。
 *
 * 主动调用类 API（获取频道 / 群成员等）通过 request() 经 WebSocket 转发给
 * 浏览器端执行（浏览器侧在 client/utils.ts 的 api 表中实现同名方法），
 * 并以 nonce 关联请求与响应。
 */
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

	/**
	 * 向浏览器端发起一次 RPC 调用并等待应答。
	 *
	 * 以随机 nonce 标识本次请求：发送 sandbox/request 后监听 sandbox/response
	 * 事件，匹配到相同 nonce 即视为应答；5 秒未收到则超时拒绝。
	 *
	 * @param method 浏览器侧 api 表中的方法名
	 * @param data 传给该方法的载荷
	 * @returns 浏览器侧方法的返回值
	 */
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

	/** 创建私聊频道：沙盒中私聊频道 id 约定为 `@userId`。 */
	override async createDirectChannel(
		userId: string,
	): Promise<Universal.Channel> {
		// Universal.Channel.Type 是 ambient const enum（verbatimModuleSyntax 下禁止取值），
		// 用等价字面量 + satisfies 校验（1 = DIRECT）
		return { id: `@${userId}`, type: 1 satisfies Universal.Channel.Type };
	}

	// ---- 以下获取类 API 均为 request() 的薄封装，实际数据由浏览器端提供 ----

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

/** 沙盒用户昵称候选表：浏览器端"添加用户"时按序取用（与 client/utils.ts 保持一致）。 */
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
