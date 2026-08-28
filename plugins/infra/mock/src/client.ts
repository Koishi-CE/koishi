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
import assert from "assert";
import { format } from "util";
import type { MockBot } from "./adapter";

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
export class MockMessageEncoder extends MessageEncoder {
	private buffer = "";

	async flush() {
		this.buffer = this.buffer.trim();
		if (!this.buffer) return;
		// options.session 的静态类型是 satori Session，运行时实为 koishi Session
		// （core 的 Session.send 会执行 options.session = this），其上挂载有 mock 的 client
		const session = this.options.session as Session | undefined;
		session?.client?.flush(this.buffer);
		this.buffer = "";
	}

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
					return ` ${key}="${h.escape("" + value, true)}"`;
				})
				.join("");
			this.buffer += `<${type}${attrString}>`;
			const length = this.buffer.length;
			await this.render(children);
			if (this.buffer.length === length) {
				this.buffer = this.buffer.slice(0, -1) + `/>`;
			} else {
				this.buffer += `</${type}>`;
			}
		}
	}
}

interface Hook {
	count: number;
	done?: boolean;
	resolve?: (replies: string[]) => void;
}

let counter = 0;

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
			user: { id: userId, name: "" + userId },
		} as Universal.Event;

		if (channelId) {
			this.event.guild = { id: channelId };
			this.event.channel = {
				id: channelId,
				type: 0 satisfies Universal.Channel.Type,
			};
		} else {
			this.event.channel = {
				id: "private:" + userId,
				type: 1 satisfies Universal.Channel.Type,
			};
		}

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
				id: ++counter + "",
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
		// Await for next tick to ensure subsequent operations are executed.
		// Do not use `setTimeout` because it may break tests with mocked timers.
		await new Promise(process.nextTick);
		return result;
	}

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

	async shouldNotReply(message: string) {
		const result = await this.receive(message);
		assert.ok(!result.length, format(RECEIVED_UNEXPECTED, message, result));
	}
}
