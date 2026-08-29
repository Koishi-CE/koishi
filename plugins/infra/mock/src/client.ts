/**
 * mock 消息客户端：模拟“用户侧”收发消息的测试沙箱。
 *
 * MessageClient 把输入投递为 mock 会话（receive），并拦截机器人
 * 对该消息的全部回复供断言（shouldReply / shouldNotReply）；
 * MockMessageEncoder 则把机器人的发送内容序列化为纯文本，
 * 经会话上挂载的 session.client 写回 MessageClient，形成闭环。
 */

import assert from "node:assert";
import { format } from "node:util";
import {
	type Context,
	clone,
	type Dict,
	h,
	hyphenate,
	isNullable,
	MessageEncoder,
	type Session,
	type Universal,
} from "@koishi-ce/koishi";
import type { MockBot } from "./adapter.ts";

// 断言失败时的错误提示模板（%s 为 util.format 占位符）
const RECEIVED_UNEXPECTED = 'expected "%s" to be not replied but received "%s"';
const RECEIVED_NOTHING = 'expected "%s" to be replied but received nothing';
const RECEIVED_OTHERWISE =
	'expected "%s" to be replied with %s but received "%s"';
const RECEIVED_NTH_NOTHING =
	'expected "%s" to be replied at index %s but received nothing';
const RECEIVED_NTH_OTHERWISE =
	'expected "%s" to be replied with %s at index %s but received "%s"';

// 不携带类型参数：上游 Bot 的静态 MessageEncoder 签名以无参 Bot 为参数，
// 若以 MockBot 为类型参数会产生构造参数逆变冲突（TS2417）；本类不使用 this.bot
/**
 * mock 消息编码器：把待发送的消息元素树序列化为纯文本。
 *
 * 文本元素直接拼接；其余元素还原为 `<type attr="value">…</type>`
 * 的标签形式（无子元素时输出自闭合），供测试断言使用。
 */
export class MockMessageEncoder extends MessageEncoder {
	private buffer = "";

	/** 将缓冲内容整体交回来源 MessageClient（若会话携带了 client） */
	async flush() {
		this.buffer = this.buffer.trim();
		if (!this.buffer) return;
		// options.session 的静态类型是 satori Session，运行时实为 koishi Session
		// （core 的 Session.send 会执行 options.session = this），其上挂载有 mock 的 client
		const session = this.options.session as Session | undefined;
		session?.client?.flush(this.buffer);
		this.buffer = "";
	}

	/** 逐元素遍历：message / figure 触发分段 flush，text 拼接，其余序列化为标签 */
	async visit(element: h) {
		const { type, attrs, children } = element;
		if (type === "message" || type === "figure") {
			await this.flush();
			await this.render(children);
			await this.flush();
		} else if (type === "text") {
			this.buffer += attrs["content"];
		} else if (type === "p") {
			if (!this.buffer.endsWith("\n")) this.buffer += "\n";
			await this.render(children);
			if (!this.buffer.endsWith("\n")) this.buffer += "\n";
		} else if (type === "template" || !type) {
			await this.render(children);
		} else {
			const attrString = Object.entries(attrs)
				.map(([key, value]) => {
					if (isNullable(value)) return "";
					key = hyphenate(key);
					if (value === true) return ` ${key}`;
					if (value === false) return ` no-${key}`;
					return ` ${key}="${h.escape(`${value}`, true)}"`;
				})
				.join("");
			this.buffer += `<${type}${attrString}>`;
			const length = this.buffer.length;
			await this.render(children);
			if (this.buffer.length === length) {
				this.buffer = `${this.buffer.slice(0, -1)}/>`;
			} else {
				this.buffer += `</${type}>`;
			}
		}
	}
}

/** 每条被测消息的等待钩子：count 为期望回复数，done 标记会话处理完毕，resolve 兑现回复列表 */
interface Hook {
	count: number;
	done?: boolean;
	resolve?: (replies: string[]) => void;
}

// 全局消息 ID 计数器，保证每条 mock 消息的 ID 唯一
let counter = 0;

/**
 * 消息客户端：在测试中扮演“用户”一侧。
 *
 * receive 把输入投递为 mock 会话并等待机器人的全部回复；
 * shouldReply / shouldNotReply 在此基础上完成断言。
 */
export class MessageClient {
	public app: Context;
	public event: Universal.Event;

	// erasableSyntaxOnly 禁止构造器参数属性，改为显式字段声明 + 赋值
	public bot: MockBot;
	public userId: string;
	public channelId: string | undefined;

	private replies: string[] = [];
	private hooks: Dict<Hook> = {};

	constructor(bot: MockBot, userId: string, channelId?: string) {
		this.bot = bot;
		this.userId = userId;
		this.channelId = channelId;
		this.app = bot.ctx.root;
		this.event = {
			platform: "mock",
			type: "message",
			selfId: bot.selfId,
			user: { id: userId, name: `${userId}` },
		} as Universal.Event;

		if (channelId) {
			this.event.guild = { id: channelId };
			this.event.channel = {
				id: channelId,
				type: 0 satisfies Universal.Channel.Type,
			};
		} else {
			this.event.channel = {
				id: `private:${userId}`,
				type: 1 satisfies Universal.Channel.Type,
			};
		}

		// 监听 middleware 事件（每个会话处理完毕时触发）：
		// 全部在等钩子都完成后统一 flush，避免回复尚未收齐就断言
		this.app.on("middleware", (session) => {
			const hook = this.hooks[session.id];
			if (!hook) return;
			hook.done = true;
			if (!hook.resolve) delete this.hooks[session.id];
			if (Object.values(this.hooks).every((hook) => hook.done)) {
				this.flush();
				this.hooks = {};
			}
		});
	}

	/** 收集一条回复并兑现已凑齐期望条数的钩子 */
	flush(buffer?: string) {
		if (buffer) this.replies.push(buffer);
		for (const id in this.hooks) {
			const hook = this.hooks[id];
			if (!hook?.resolve || (buffer && this.replies.length < hook.count))
				continue;
			hook.resolve(this.replies);
			// exactOptionalPropertyTypes 下可选属性不能显式赋 undefined，用 delete 等价清除
			delete hook.resolve;
			hook.count = Infinity;
			this.replies = [];
		}
	}

	/**
	 * 投递一条用户消息并等待机器人处理完毕
	 * @param content 消息内容（首元素为 quote 时会剥离为引用消息）
	 * @param count 期望收到的回复条数（默认不限）
	 * @returns 机器人对该消息的全部回复
	 */
	async receive(content: string, count = Infinity) {
		const result = await new Promise<string[]>((resolve) => {
			let quote: Universal.Message | undefined;
			let elements = h.parse(content);
			const quoteElement = elements[0];
			if (quoteElement?.type === "quote") {
				elements.shift();
				quote = {
					id: quoteElement.attrs["id"],
					messageId: quoteElement.attrs["id"],
					elements: quoteElement.children,
					content: quoteElement.children.join(""),
				};
				content = elements.join("").trimStart();
				elements = h.parse(content);
			}
			// exactOptionalPropertyTypes 下可选属性 quote 不能显式携带 undefined，按需附加
			const message: Universal.Message = {
				id: `${++counter}`,
				content,
				elements,
			};
			if (quote) message.quote = quote;
			const id = this.bot.receive(
				{
					...clone(this.event),
					message,
				},
				this,
			);
			this.hooks[id] = { resolve, count };
		});
		// 等待下一个 tick，确保后续操作（回复的收发）全部完成。
		// 不能用 setTimeout：在使用假定时器的测试中会失效。
		await new Promise(process.nextTick);
		return result;
	}

	/** 断言机器人对 message 的回复符合预期（字符串全等 / 正则命中 / 数组逐项匹配） */
	async shouldReply(
		message: string,
		reply?: string | RegExp | (string | RegExp)[],
	) {
		function match(reply: string | RegExp, content: string) {
			return typeof reply === "string"
				? reply === content
				: reply.test(content);
		}

		function prettify(reply: string | RegExp) {
			return typeof reply === "string" ? `"${reply}"` : reply.toString();
		}

		if (!reply) {
			const result = await this.receive(message);
			assert.ok(result.length, format(RECEIVED_NOTHING, message));
			return;
		}

		if (!Array.isArray(reply)) {
			const [result] = await this.receive(message, 1);
			assert.ok(result, format(RECEIVED_NOTHING, message));
			assert.ok(
				match(reply, result),
				format(RECEIVED_OTHERWISE, message, prettify(reply), result),
			);
			return;
		}

		const result = await this.receive(message);
		for (const [index, expected] of reply.entries()) {
			const actual = result[index];
			assert.ok(actual, format(RECEIVED_NTH_NOTHING, message, index));
			assert.ok(
				match(expected, actual),
				format(
					RECEIVED_NTH_OTHERWISE,
					message,
					prettify(expected),
					index,
					actual,
				),
			);
		}
	}

	/** 断言机器人对 message 没有任何回复 */
	async shouldNotReply(message: string) {
		const result = await this.receive(message);
		assert.ok(!result.length, format(RECEIVED_UNEXPECTED, message, result));
	}
}
