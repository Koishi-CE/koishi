/**
 * mock 适配器与模拟 Bot。
 *
 * MockBot 以 "mock" 平台注册，不连接任何真实聊天平台，
 * 可由测试代码直接构造并派发会话（session）；
 * MockAdapter 随 MockBot 加载，向 ctx 提供 `mock` 服务：
 * initUser / initChannel 预置数据库，client / receive 模拟用户消息。
 * 两者构成本仓库绝大多数插件测试的基础设施。
 */
import {
	Adapter,
	Bot,
	type Channel,
	type Context,
	type Universal,
	type User,
} from "@koishi-ce/koishi";
import { MessageClient, MockMessageEncoder } from "./client";
import { Webhook } from "./webhook";

// 模块增强必须指向本仓库的 @koishi-ce/koishi（上游包名 "koishi" 在此无法解析）
declare module "@koishi-ce/koishi" {
	interface Context {
		mock: MockAdapter<this>;
	}

	interface User {
		mock: string;
	}

	// mock 在会话上挂载的 MessageClient 引用（receive 时写入，编码器 flush 时读取）
	// 属性可能被显式赋值为 undefined（receive 未传 client 时），故声明含 undefined
	interface Session<
		U extends User.Field = never,
		G extends Channel.Field = never,
		C extends Context = Context,
	> {
		client?: MessageClient | undefined;
	}
}

/** 未配置 selfId 时的默认自身 ID */
export const DEFAULT_SELF_ID = "514";

export namespace MockBot {
	/** mock Bot 配置（selfId 缺省时使用 DEFAULT_SELF_ID） */
	export interface Config {
		selfId?: string;
	}
}

/** 模拟 Bot：以 "mock" 平台注册，支持不经真实平台直接派发会话 */
export class MockBot<C extends Context = Context> extends Bot<C> {
	static override MessageEncoder = MockMessageEncoder;

	// config 参数可选：cordis 的 plugin() 以 Spread<T> 推断参数个数，
	// 可选 config 才能让测试里的裸 `app.plugin(mock)` 通过类型检查
	constructor(ctx: C, config: MockBot.Config = {}) {
		super(ctx, config, "mock");
		this.selfId = config.selfId ?? DEFAULT_SELF_ID;
		// Universal.Status 是 ambient const enum（verbatimModuleSyntax 下禁止取值），
		// 用等价字面量 + satisfies 校验，下同
		this.status = 1 satisfies Universal.Status;
		ctx.plugin(MockAdapter, this);
	}

	/** 为该 Bot 创建一个模拟用户的消息客户端 */
	client(userId: string, channelId?: string) {
		return new MessageClient(this, userId, channelId);
	}

	/** 基于事件模板构造会话并派发到应用（可携带来源 client 以回捕回复），返回会话 ID */
	receive(event: Partial<Universal.Event>, client?: MessageClient) {
		const session = this.session(event);
		session.client = client;
		this.dispatch(session);
		return session.id;
	}

	/** 返回极简的消息记录（仅满足接口形状，内容为空） */
	override async getMessage(channelId: string, id: string) {
		const isDirect = channelId.startsWith("private:");
		return {
			id,
			messageId: id,
			channel: {
				id: channelId,
				type: isDirect
					? (1 satisfies Universal.Channel.Type)
					: (0 satisfies Universal.Channel.Type),
			},
			content: "",
			time: 0,
			user: { id: this.selfId },
		};
	}
}

/** 模拟适配器：向 ctx 注入 mock 服务，并代理到第一个 bot 的便捷方法 */
export class MockAdapter<C extends Context = Context> extends Adapter<
	C,
	MockBot<C>
> {
	public webhook: Webhook;

	// 第二个参数是 ctx.plugin(MockAdapter, bot) 传入的 bot 实例，构造流程不使用
	constructor(ctx: C, _bot: MockBot<C>) {
		super(ctx);
		this.webhook = new Webhook(ctx.root);
		ctx.provide("mock", this, true);
	}

	/** 在数据库中预置一个 mock 平台用户 */
	async initUser(id: string, authority = 1, data?: Partial<User>) {
		await this.ctx.root.database.createUser("mock", id, { authority, ...data });
	}

	/** 在数据库中预置一个 mock 平台频道（默认指派给第一个 bot） */
	async initChannel(
		id: string,
		assignee = this.bots[0]!.selfId,
		data?: Partial<Channel>,
	) {
		await this.ctx.root.database.createChannel("mock", id, {
			assignee,
			...data,
		});
	}

	/** 在第一个 bot 上创建消息客户端 */
	client(userId: string, channelId?: string) {
		return this.bots[0]!.client(userId, channelId);
	}

	/** 让第一个 bot 派发一条事件 */
	receive(event: Partial<Universal.Event>, client?: MessageClient) {
		return this.bots[0]!.receive(event, client);
	}

	/** 让第一个 bot 构造一个会话（不派发） */
	session(event: Partial<Universal.Event>) {
		return this.bots[0]!.session(event);
	}
}

export namespace MockAdapter {
	export type Config = {};
}
