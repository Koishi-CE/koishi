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

export const DEFAULT_SELF_ID = "514";

export namespace MockBot {
	export interface Config {
		selfId: string;
	}
}

export class MockBot<C extends Context = Context> extends Bot<C> {
	static override MessageEncoder = MockMessageEncoder;

	constructor(ctx: C, config: MockBot.Config) {
		super(ctx, config, "mock");
		this.selfId = config.selfId ?? DEFAULT_SELF_ID;
		// Universal.Status 是 ambient const enum（verbatimModuleSyntax 下禁止取值），
		// 用等价字面量 + satisfies 校验，下同
		this.status = 1 satisfies Universal.Status;
		ctx.plugin(MockAdapter, this);
	}

	client(userId: string, channelId?: string) {
		return new MessageClient(this, userId, channelId);
	}

	receive(event: Partial<Universal.Event>, client?: MessageClient) {
		const session = this.session(event);
		session.client = client;
		this.dispatch(session);
		return session.id;
	}

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

	async initUser(id: string, authority = 1, data?: Partial<User>) {
		await this.ctx.root.database.createUser("mock", id, { authority, ...data });
	}

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

	client(userId: string, channelId?: string) {
		return this.bots[0]!.client(userId, channelId);
	}

	receive(event: Partial<Universal.Event>, client?: MessageClient) {
		return this.bots[0]!.receive(event, client);
	}

	session(event: Partial<Universal.Event>) {
		return this.bots[0]!.session(event);
	}
}

export namespace MockAdapter {
	export type Config = {};
}
