// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 快捷对话（ctx.match / executeMatcher）补充测试。
 *
 * 覆盖正则模式匹配、i18n 模板的逐语言匹配与会话语言锁定、
 * i18n + regex 组合（含 fuzzy 捕获剩余内容）以及空模式的安全忽略。
 */
import {
	afterAll,
	beforeAll,
	describe,
	it,
} from "bun:test";
import { App, type Session } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

const app = new App();
app.plugin(mock);
const client = app.mock.client("123");

app.i18n.define("zh-CN", "short.greet", "你好");
app.i18n.define("en-US", "short.greet", "hello");
app.i18n.define("zh-CN", "short.num", "编号\\s*\\d+");

// ctx.match 的重载未覆盖「i18n 模式 + 函数回复」组合（运行时经 session.resolve
// 求值函数回复，受支持），以宽松签名视图注册，调用形态保持一致
const matchI18n = app.match as (
	pattern: string,
	response: (
		session: Session,
		params: [string, ...string[]],
	) => string,
	options: {
		i18n?: boolean;
		regex?: boolean;
		fuzzy?: boolean;
	},
) => unknown;

// 正则模式：exec 捕获组作为回复参数
app.match(
	/^re-(\d+)$/,
	(_session, captured) => `编号${captured[1]}`,
);
// i18n 模板：逐语言取出文案再匹配，命中后锁定会话语言
matchI18n("short.greet", () => "i18n-hit", { i18n: true });
// i18n + 正则语义
matchI18n("short.num", () => "regex-i18n-hit", {
	i18n: true,
	regex: true,
});
// i18n + 正则 + 模糊：捕获模板之后的剩余内容
matchI18n(
	"short.num",
	(_session, captured) => `fuzzy:${captured[1] ?? ""}`,
	{
		i18n: true,
		regex: true,
		fuzzy: true,
	},
);
// 空模式不参与匹配
app.match("", () => "never");

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("Matcher", () => {
	it("正则模式捕获组", async () => {
		await client.shouldReply("re-42", "编号42");
		await client.shouldNotReply("re-xx");
	});

	it("i18n 模板逐语言匹配", async () => {
		await client.shouldReply("你好", "i18n-hit");
		await client.shouldReply("hello", "i18n-hit");
		await client.shouldNotReply("こんにちは");
	});

	it("i18n + 正则语义", async () => {
		await client.shouldReply("编号 42", "regex-i18n-hit");
		// 模板后不允许直接紧跟其它内容
		await client.shouldNotReply("编号42x");
	});

	it("i18n + 正则 + 模糊捕获剩余内容", async () => {
		await client.shouldReply("编号 42 附注", "fuzzy:附注");
	});

	it("空模式不命中任何消息", async () => {
		await client.shouldNotReply("whatever");
	});
});
