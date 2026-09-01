// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * sandbox 插件（node 侧）：网页控制台里的机器人调试沙盒。
 *
 * 核心思路是把"浏览器页面"伪装成一个聊天平台适配器：
 * - 为每个打开沙盒页面的 console 连接创建一个 SandboxBot（见 ./bot.ts），
 *   浏览器端发送的消息经此 bot 转成标准 session 派发，机器人的回复经
 *   SandboxMessenger（见 ./message.ts）写回浏览器渲染；
 * - 本文件注册浏览器侧可调用的 RPC 监听器（发消息 / 删消息 / 用户管理等），
 *   以及可选的本地静态文件服务（fileServer 配置）。
 */

import { createReadStream } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Client, DataService } from "@koishi-ce/console";
import {
	$,
	type Context,
	type Dict,
	Random,
	Schema,
	type Universal,
	type User,
} from "@koishi-ce/koishi";
import type {} from "@koishi-ce/plugin-server";
import zhCN from "../locales/zh-CN.yml";
import { SandboxBot } from "./bot.ts";

// 模块增强必须指向本仓库的 @koishi-ce/koishi（上游包名 "koishi" 在此无法解析）
declare module "@koishi-ce/koishi" {
	interface Events {
		"sandbox/response"(nonce: string, data: unknown): void;
	}
}

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			sandbox: SandboxService;
		}
	}

	interface Events {
		"sandbox/response"(this: Client, nonce: string, data?: unknown): void;
		"sandbox/send-message"(
			this: Client,
			platform: string,
			user: string,
			channel: string,
			content: string,
			quote?: Message,
		): void;
		"sandbox/delete-message"(
			this: Client,
			platform: string,
			user: string,
			channel: string,
			messageId: string,
		): void;
		"sandbox/get-user"(
			this: Client,
			platform: string,
			pid: string,
		): Promise<User | undefined>;
		"sandbox/set-user"(
			this: Client,
			platform: string,
			pid: string,
			data: Partial<User>,
		): Promise<void>;
	}
}

/** 沙盒消息：浏览器与 node 侧之间传递的一条聊天记录。 */
export interface Message {
	id: string;
	user: string;
	channel: string;
	content: string;
	platform: string;
	quote?: Message;
}

export const filter = false;
export const name = "sandbox";
export const inject = ["console", "server"];

/** 沙盒插件配置（本地静态文件服务开关）。 */
export interface Config {
	fileServer: {
		enabled: boolean;
	};
}

export const Config: Schema<Config> = Schema.object({
	fileServer: Schema.object({
		enabled: Schema.boolean()
			.default(false)
			.description(
				"是否提供本地静态文件服务 (请勿在暴露在公网的设备上开启此选项)。",
			),
	}),
});

/**
 * sandbox 数据服务：按平台统计绑定用户数（binding 表按 platform 分组计数），
 * 供浏览器端展示沙盒平台列表。依赖 database。
 */
class SandboxService extends DataService<Dict<number>> {
	static override inject = ["database"];

	constructor(ctx: Context) {
		super(ctx, "sandbox");
	}

	override async get() {
		const data = await this.ctx.database
			.select("binding")
			.groupBy("platform", {
				count: (row) => $.count(row.pid),
			})
			.execute();
		return Object.fromEntries(
			data.map(({ platform, count }) => [platform, count]),
		);
	}
}

/** 沙盒插件的入口：注册服务、页面入口与一组浏览器侧 RPC 监听器。 */
export function apply(ctx: Context, config: Config) {
	ctx.plugin(SandboxService);

	ctx.console.addEntry(
		process.env["KOISHI_BASE"]
			? [
					`${process.env["KOISHI_BASE"]}/dist/index.js`,
					`${process.env["KOISHI_BASE"]}/dist/style.css`,
				]
			: process.env["KOISHI_ENV"] === "browser"
				? [import.meta.url.replace(/\/src\/[^/]+$/, "/client/index.ts")]
				: {
						dev: resolve(__dirname, "../client/index.ts"),
						prod: resolve(__dirname, "../dist"),
					},
	);

	const bots: Dict<SandboxBot> = {};

	/**
	 * 构造一条标准化的 Universal.Event：
	 * 私聊（channelId 形如 `@userId`）只带 channel，群聊额外附带同 id 的 guild。
	 */
	const createEvent = (userId: string, channelId: string) => {
		const isDirect = channelId === `@${userId}`;
		// exactOptionalPropertyTypes 下可选属性不能显式携带 undefined，guild 按需附加
		const event: Partial<Universal.Event> = {
			user: { id: userId, name: userId },
			channel: {
				id: channelId,
				// Universal.Channel.Type 是 ambient const enum（verbatimModuleSyntax 下禁止取值），
				// 用等价字面量 + satisfies 校验（1 = DIRECT，0 = TEXT）
				type: isDirect
					? (1 satisfies Universal.Channel.Type)
					: (0 satisfies Universal.Channel.Type),
			},
			timestamp: Date.now(),
		};
		if (!isDirect) event.guild = { id: channelId };
		return event;
	};

	/** 取平台对应的沙盒 bot：同一平台的 bot 全局唯一，不存在时才创建。 */
	const ensureBot = (platform: string, client: Client) => {
		// 保证平台唯一（同一 platform 只创建一个 SandboxBot 实例）
		return (bots[platform] ||= new SandboxBot(ctx, client, {
			platform,
			selfId: "koishi",
		}));
	};

	// 浏览器发来用户消息：先回显给浏览器立即上屏，再构造 message session
	// 派发给本插件的机器人逻辑（含引用消息 quote 的透传）
	ctx.console.addListener(
		"sandbox/send-message",
		async function (platform, userId, channel, content, quote) {
			const bot = ensureBot(platform, this);
			const id = Random.id();
			this.send({
				type: "sandbox/message",
				body: { id, content, user: userId, channel, platform, quote },
			});
			const session = bot.session(createEvent(userId, channel));
			session.type = "message";
			session.messageId = id;
			if (quote) {
				session.quote = {
					content: quote.content,
					id: quote.id,
				};
			}
			session.content = content;
			bot.dispatch(session);
		},
		{ authority: 4 },
	);

	// 浏览器删除消息：以 message-deleted 事件派发，触发相关的监听插件
	ctx.console.addListener(
		"sandbox/delete-message",
		async function (platform, userId, channel, messageId) {
			const bot = ensureBot(platform, this);
			const session = bot.session(createEvent(userId, channel));
			session.type = "message-deleted";
			session.messageId = messageId;
			bot.dispatch(session);
		},
		{ authority: 4 },
	);

	// 查询沙盒用户：无绑定记录时按 authority 1 现场创建
	ctx.console.addListener(
		"sandbox/get-user",
		async (platform, pid) => {
			const database = ctx.get("database");
			if (!database) return;
			const [binding] = await database.get("binding", { platform, pid }, [
				"aid",
			]);
			if (binding) return database.getUser(platform, pid);
			return database.createUser(platform, pid, {
				authority: 1,
			});
		},
		{ authority: 4 },
	);

	// 写入沙盒用户：data 为空对象表示"用户进入频道"（guild-member-added），
	// 为 null 表示删除用户（guild-member-added 的反向），其余按字段更新
	ctx.console.addListener(
		"sandbox/set-user",
		async function (platform, pid, data) {
			const bot = ensureBot(platform, this);
			const session = bot.session(createEvent(pid, "#"));
			if (data) {
				session.type = "guild-member-added";
				ctx.emit("guild-member-added", session);
			} else {
				session.type = "guild-member-removed";
				ctx.emit("guild-member-removed", session);
			}
			const database = ctx.get("database");
			if (!database) return;
			const [binding] = await database.get("binding", { platform, pid }, [
				"aid",
			]);
			if (!binding) {
				if (!data) return;
				await database.createUser(platform, pid, {
					authority: 1,
					...data,
				});
			} else if (!data) {
				await database.remove("user", binding.aid);
				await database.remove("binding", { platform, pid });
			} else {
				await database.upsert("user", [
					{
						id: binding.aid,
						...data,
					},
				]);
			}
		},
		{ authority: 4 },
	);

	// 浏览器对 sandbox/request 的应答：转成应用级事件,由 SandboxBot.request 的事件等待方消费
	ctx.console.addListener(
		"sandbox/response",
		(nonce, data) => {
			ctx.emit("sandbox/response", nonce, data);
		},
		{ authority: 4 },
	);

	// 新连接接入时清理其名下已失联的沙盒 bot（页面刷新 / 断线重连场景）
	ctx.on("console/connection", async (client) => {
		if (ctx.console.clients[client.id]) return;
		for (const [platform, bot] of Object.entries(bots)) {
			if (bot.client === client) {
				delete bots[platform];
				delete ctx.bots[bot.sid];
			}
		}
	});

	// 可选的本地静态文件服务:把沙盒消息里引用的 file: 本地资源暴露为 HTTP,
	// 供浏览器端展示(仅限本地调试,勿在公网环境开启)
	if (config.fileServer.enabled) {
		ctx.server.get("/sandbox/:url(file:.+)", async (koa) => {
			const { url } = koa.params;
			// 路由参数 :url(file:.+) 必然存在，此守卫仅为收窄类型
			if (!url) return;
			koa.type = extname(url);
			koa.body = createReadStream(fileURLToPath(url));
		});
	}

	ctx.i18n.define("zh-CN", zhCN);

	// clear 命令仅对 sandbox: 平台的会话生效:通知浏览器清空当前频道的消息列表
	ctx
		.intersect((session) => session.platform.startsWith("sandbox:"))
		.command("clear")
		.action(({ session }) => {
			if (!session) return;
			(session.bot as SandboxBot).client.send({
				type: "sandbox/clear",
			});
		});
}
