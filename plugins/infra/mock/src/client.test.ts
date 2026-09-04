// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { App, h } from "@koishi-ce/koishi";
// 同 admin 既有测试：CJS 实现配 ESM 声明，nodenext 互操作视图多包一层 default，转型取真实插件对象
import * as memoryModule from "@koishijs/plugin-database-memory";
import mock from "./index.ts";

const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

/**
 * 消息客户端与编码器（client.ts）的边角测试：
 * MockMessageEncoder 的元素序列化分支（属性三态、自闭合、分段 flush）、
 * quote 剥离、shouldReply / shouldNotReply 的全部分支与失败文案。
 */

const app = new App();
app.plugin(memory);
app.plugin(mock);

// 各类元素形态的回复指令（编码器序列化分支）
app.command("tag").action(() =>
	h("img", {
		src: 'https://e.st/x"1.png',
		flag: true,
		off: false,
		dataNil: undefined,
		dataFoo: "v",
	}),
);
app.command("bold").action(() => h("b", {}, "加粗"));
app.command("para").action(() => h("p", {}, "第一段"));
app
	.command("nestedPara")
	.action(() => h("p", {}, h("p", {}, "内段")));
app.command("figure").action(() => h("figure", {}, "图段"));
app
	.command("tpl")
	.action(() => h("template", {}, "模板内容"));
app
	.command("msgs")
	.action(() => [
		h("message", {}, "其一"),
		h("message", {}, "其二"),
	]);
app
	.command("nested")
	.action(() => h("message", {}, h("message", {}, "内层")));
app.command("show").action(() => "ok");
app.command("echo <msg>").action((_, msg) => msg);

const client = app.mock.client("123");
const channelClient = app.mock.client("456", "321");

beforeAll(async () => {
	await app.start();
	await app.mock.initChannel("321");
});
afterAll(() => app.stop());

describe("MockMessageEncoder 序列化", () => {
	it("普通元素：属性三态（字符串转义 / true / false）与空值跳过、连字符化", async () => {
		await client.shouldReply(
			"tag",
			/^<img src="https:\/\/e\.st\/x&quot;1\.png" flag no-off data-foo="v"\/>$/,
		);
	});

	it("带子元素的元素输出闭合标签，自闭合元素以 /> 结尾", async () => {
		await client.shouldReply("bold", "<b>加粗</b>");
	});

	it("p 元素前后补换行（flush 时 trim）", async () => {
		await client.shouldReply("para", "第一段");
	});

	it("嵌套 p 时缓冲已有换行则不重复补行", async () => {
		// 内层 p 的前后缓冲均已以换行结尾：两个补行分支都走「跳过」半
		await client.shouldReply("nestedPara", "内段");
	});

	it("figure 与 template 分支", async () => {
		await client.shouldReply("figure", "图段");
		await client.shouldReply("tpl", "模板内容");
	});

	it("message 元素分段：数组逐项匹配两条独立回复", async () => {
		await client.shouldReply("msgs", ["其一", "其二"]);
	});

	it("嵌套 message 触发空缓冲 flush（不产生空回复）", async () => {
		await client.shouldReply("nested", "内层");
	});

	it("quote 元素被剥离为引用消息（剥离后的正文参与指令匹配）", async () => {
		await client.shouldReply('<quote id="88"/> show', "ok");
	});

	it("频道上下文的客户端同样完成收发闭环", async () => {
		await channelClient.shouldReply("echo hi", "hi");
	});
});

describe("shouldReply / shouldNotReply 分支", () => {
	it("无期待值：要求至少一条回复", async () => {
		await client.shouldReply("echo 有回复");
		await expect(
			client.shouldReply("missing-cmd-xyz"),
		).rejects.toThrow(
			'expected "missing-cmd-xyz" to be replied but received nothing',
		);
	});

	it("字符串 / 正则匹配", async () => {
		await client.shouldReply("echo ok", "ok");
		await client.shouldReply("echo 123", /^\d+$/);
	});

	it("字符串不匹配 → RECEIVED_OTHERWISE", async () => {
		await expect(
			client.shouldReply("echo hi", "no"),
		).rejects.toThrow(
			'expected "echo hi" to be replied with "no" but received "hi"',
		);
	});

	it("数组缺项 → RECEIVED_NTH_NOTHING", async () => {
		await expect(
			client.shouldReply("echo hi", ["hi", "more"]),
		).rejects.toThrow(
			'expected "echo hi" to be replied at index 1 but received nothing',
		);
	});

	it("数组逐项不匹配 → RECEIVED_NTH_OTHERWISE", async () => {
		await expect(
			client.shouldReply("echo hi", ["no"]),
		).rejects.toThrow(
			'expected "echo hi" to be replied with "no" at index 0 but received "hi"',
		);
	});

	it("shouldNotReply：无回复通过，收到回复时报错", async () => {
		await client.shouldNotReply("missing-cmd-xyz");
		// 断言失败文案里 result 以数组形态格式化
		await expect(
			client.shouldNotReply("echo hi"),
		).rejects.toThrow(
			'expected "echo hi" to be not replied but received "[ \'hi\' ]"',
		);
	});
});
