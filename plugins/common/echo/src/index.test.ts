/**
 * echo 插件测试：验证基础复述、CQ 码转义 / 反转义
 * 与定向发送（-u 用户私聊 / -c 频道）的参数形状。
 */
import { beforeAll, describe, expect, it, jest } from "bun:test";
import { App, type Bot, h } from "@koishi-ce/koishi";
import * as echo from "@koishi-ce/plugin-echo";
import mock from "@koishi-ce/plugin-mock";

const app = new App();

app.plugin(mock);
app.plugin(echo);

const client = app.mock.client("123");

beforeAll(() => app.start());

describe("@koishi-ce/plugin-echo", () => {
	// 覆盖纯文本、转义输入、-E 反转义（拆分为多条消息），以及向用户 / 频道定向发送时的调用参数
	it("basic support", async () => {
		await client.shouldReply("echo", "请输入要发送的文本。");
		await client.shouldReply("echo foo", "foo");
		await client.shouldReply(h.escape("echo &lt;&gt;"), "&lt;&gt;");
		await client.shouldReply(
			h.escape("echo 1<message>2</message>3"),
			"1<message>2</message>3",
		);
		await client.shouldReply(h.escape("echo -E &lt;&gt;"), "<>");
		await client.shouldReply(h.escape("echo -E 1<message>2</message>3"), [
			"1",
			"2",
			"3",
		]);

		const send1 = (app.bots[0]!.sendPrivateMessage =
			jest.fn<Bot["sendPrivateMessage"]>());
		await client.shouldNotReply("echo -u @100 foo");
		expect(send1.mock.calls).toHaveLength(1);
		// 形状断言：仅校验期望侧的数组索引（args[0] 平台目标、args[1] 消息体）
		expect(send1.mock.calls[0]?.[0]).toBe("100");
		expect(send1.mock.calls[0]?.[1]).toStrictEqual(["foo"]);

		const send2 = (app.bots[0]!.sendMessage = jest.fn<Bot["sendMessage"]>());
		await client.shouldNotReply("echo -c #200 foo");
		expect(send1.mock.calls).toHaveLength(1);
		expect(send2.mock.calls[0]?.[0]).toBe("200");
		expect(send2.mock.calls[0]?.[1]).toStrictEqual(["foo"]);
	});

	// -e 转义：消息中的标签原样输出为转义文本
	it("escape option", async () => {
		// 存量用例曾以 jest.fn 覆盖实例属性，删除后回落到原型上的真实实现
		delete (app.bots[0] as Partial<Bot>).sendMessage;
		await client.shouldReply("echo -e <foo>", "&lt;foo/&gt;");
	});

	// -u 指向不存在的平台时提示找不到平台
	it("platform not found", async () => {
		await client.shouldReply("echo -u @nosuch:100 foo", "找不到指定的平台。");
	});
});
