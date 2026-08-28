/**
 * 指令纠错建议（suggest）测试。
 *
 * 两部分：指令名打错时的"您要找的是不是……"提示与句号确认流程
 * （含多候选、忽略建议等分支）；以及 session.suggest() 自定义
 * 纠错（如 find 指令的条目名匹配）的行为。
 */
import { afterAll, beforeAll, describe, it } from "bun:test";
import { App } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

describe("Command Suggestion", () => {
	const app = new App({ prefix: "/", minSimilarity: 0.64 });
	app.plugin(mock);

	const client1 = app.mock.client("456");
	const client2 = app.mock.client("789", "987");

	app
		.command("foo <text>", { checkArgCount: true })
		.action((_, bar) => "foo" + bar);

	app
		.command("fooo", { checkUnknown: true })
		.alias("bool")
		.option("text", "-t <bar>")
		.action(({ options }) => "fooo" + options.text);

	beforeAll(() => app.start());
	afterAll(() => app.stop());

	it("execute command", async () => {
		// 正常执行不受纠错影响；单独的句号不触发任何指令
		await client1.shouldReply("foo bar", "foobar");
		await client1.shouldNotReply(".");
	});

	it("no suggestions", async () => {
		// 相似度不足（参数错位而非指令名打错）不出建议
		await client1.shouldNotReply("bar foo");
	});

	it("apply suggestions 1", async () => {
		// 打错指令名触发建议，回复句号确认后执行推测指令
		await client1.shouldReply(
			"fo bar",
			"您要找的是不是“foo”？回复句号以使用推测的指令。",
		);
		await client2.shouldReply("/fooo -t bar", "fooobar");
		await client1.shouldReply(".", "foobar");
		await client1.shouldNotReply(".");
	});

	it("apply suggestions 2", async () => {
		// 选项值打错的场景同样给出建议并可确认
		await client2.shouldReply(
			"/foooo -t bar",
			"您要找的是不是“fooo”？回复句号以使用推测的指令。",
		);
		await client1.shouldReply("foo bar", "foobar");
		await client2.shouldReply(".", "fooobar");
		await client2.shouldNotReply(".");
	});

	it("ignore suggestions 1", async () => {
		// 出建议后输入其它内容：建议作废，句号不再生效
		await client1.shouldReply(
			"fo bar",
			"您要找的是不是“foo”？回复句号以使用推测的指令。",
		);
		await client1.shouldNotReply("bar foo");
		await client1.shouldNotReply(".");
	});

	it("ignore suggestions 2", async () => {
		// 正确执行其它指令后，此前的建议同样作废
		await client2.shouldReply(
			"/fo bar",
			"您要找的是不是“foo”？回复句号以使用推测的指令。",
		);
		await client2.shouldReply("/foo bar", "foobar");
		await client2.shouldNotReply(".");
	});

	it("multiple suggestions", async () => {
		// 多个相近候选：列出全部且不进入句号确认流程
		await client1.shouldReply(
			"fool bar",
			"您要找的是不是“foo”或“fooo”或“bool”？",
		);
		await client1.shouldNotReply(".");
	});
});

describe("session.suggest()", () => {
	const app = new App({ prefix: ".", minSimilarity: 0.64 });
	app.plugin(mock);

	const client = app.mock.client("123", "456");
	const items = ["foo", "bar"];

	// find 指令：条目不存在时用 session.suggest 做条目名纠错
	app.command("find [item]").action(async ({ session }, item) => {
		if (items.includes(item)) return "found:" + item;
		const name = await session.suggest({
			actual: item,
			expect: ["foo", "bar", "baz"],
			prefix: "PREFIX",
			suffix: "SUFFIX",
		});
		if (!name) return;
		return session.execute({ args: [name], name: "find" });
	});

	beforeAll(() => app.start());
	afterAll(() => app.stop());

	it("no suggestions", async () => {
		// 无相似候选时不输出 prefix，也没有句号确认
		await client.shouldNotReply(".");
		await client.shouldNotReply("find for");
	});

	it("show suggestions", async () => {
		// 完全不相似时只发 prefix；唯一候选带 suffix 可确认，多候选不可
		await client.shouldReply(".find 111", "PREFIX");
		await client.shouldNotReply(".");
		await client.shouldReply(".find for", `PREFIX您要找的是不是“foo”？SUFFIX`);
		await client.shouldReply(".", "found:foo");
		await client.shouldReply(".find bax", `PREFIX您要找的是不是“bar”或“baz”？`);
		await client.shouldNotReply(".");
	});
});
