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
import {} from "@koishi-ce/plugin-server";
import { createReadStream } from "fs";
import { extname, resolve } from "path";
import { fileURLToPath } from "url";
import { SandboxBot } from "./bot";
import zhCN from "../locales/zh-CN.yml";

// 模块增强必须指向本仓库的 @koishi-ce/koishi（上游包名 "koishi" 在此无法解析）
declare module "@koishi-ce/koishi" {
	interface Events {
		"sandbox/response"(nonce: string, data: any): void;
	}
}

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			sandbox: SandboxService;
		}
	}

	interface Events {
		"sandbox/response"(this: Client, nonce: string, data?: any): void;
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

export function apply(ctx: Context, config: Config) {
	ctx.plugin(SandboxService);

	ctx.console.addEntry(
		process.env["KOISHI_BASE"]
			? [
					process.env["KOISHI_BASE"] + "/dist/index.js",
					process.env["KOISHI_BASE"] + "/dist/style.css",
				]
			: process.env["KOISHI_ENV"] === "browser"
				? [import.meta.url.replace(/\/src\/[^/]+$/, "/client/index.ts")]
				: {
						dev: resolve(__dirname, "../client/index.ts"),
						prod: resolve(__dirname, "../dist"),
					},
	);

	const bots: Dict<SandboxBot> = {};

	const createEvent = (userId: string, channelId: string) => {
		const isDirect = channelId === "@" + userId;
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

	const ensureBot = (platform: string, client: Client) => {
		// assert unique platform
		return (bots[platform] ||= new SandboxBot(ctx, client, {
			platform,
			selfId: "koishi",
		}));
	};

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

	ctx.console.addListener(
		"sandbox/response",
		(nonce, data) => {
			ctx.emit("sandbox/response", nonce, data);
		},
		{ authority: 4 },
	);

	ctx.on("console/connection", async (client) => {
		if (ctx.console.clients[client.id]) return;
		for (const [platform, bot] of Object.entries(bots)) {
			if (bot.client === client) {
				delete bots[platform];
				delete ctx.bots[bot.sid];
			}
		}
	});

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
