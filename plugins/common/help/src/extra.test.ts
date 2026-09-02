// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * help 插件补充用例（bun:test 断言）：
 * 父指令对当前会话不可见时下钻子指令（getCommands else 分支）、
 * 选项权限不足时从帮助中隐藏、i18n 定义的示例文本逐行展示、
 * 以及快捷调用的模糊命中给出的纠错建议（候选字段收集循环）。
 *
 * 备注：inferCommand 里 session.suggest 的 filter 回调（index.ts 223-225）
 * 经 help 插件路径不可达——suggest 仅在传入 actual 时才调用 filter，
 * 而 help 的 suggest 调用不传 actual（见 core/src/session/interact.ts）。
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { App } from "@koishi-ce/koishi";
import * as help from "@koishi-ce/plugin-help";
import mock from "@koishi-ce/plugin-mock";
import * as memoryModule from "@koishijs/plugin-database-memory";

// CJS 实现配 ESM 声明，Bun 互操作视图多包一层 default，穿透取真实驱动
const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

const app = new App({
	minSimilarity: 0.64,
});

app.plugin(mock);
app.plugin(help);
app.plugin(memory);

app.i18n.define("$zh-CN", "commands.help.messages.global-epilog", "");

const client = app.mock.client("123", "456");

beforeAll(async () => {
	await app.start();
	await app.mock.initUser("123", 2);
	await app.mock.initChannel("456");
});

describe("@koishi-ce/plugin-help 补充用例", () => {
	it("父指令对当前会话不可见时不进入全局列表", async () => {
		// 限定 telegram 平台的指令对 mock 会话 match 失败，全局列表不展示
		const parent = app.platform("telegram").command("tg", "T");
		parent.subcommand("tgc", "C");
		const [reply] = await client.receive("help");
		expect(reply).toContain("help");
		expect(reply).not.toContain("tg");
	});

	it("选项权限不足时从帮助中隐藏", async () => {
		app.command("adv", "D").option("top", "-t", { authority: 3 });
		const [reply] = await client.receive("help adv");
		expect(reply).toBe("指令：adv\nD");
	});

	it("i18n 定义的示例文本逐行展示", async () => {
		app.command("demo", "D");
		app.i18n.define("$zh-CN", "commands.demo.examples", "first\nsecond");
		const [reply] = await client.receive("help demo");
		expect(reply).toBe("指令：demo\nD\n使用示例：\n    first\n    second");
	});

	it("快捷调用的模糊命中给出纠错建议", async () => {
		const probe = app.command("probe", "DESCRIPTION");
		probe.shortcut("ask", { i18n: true });
		app.i18n.define("$zh-CN", "commands.probe.shortcuts.ask", "quickbrownfox");
		// 与快捷调用文本相差一字母：非精确命中，走候选列表与建议流程
		await client.shouldReply(
			"help quickbrownfo",
			"指令未找到。您要找的是不是“probe”？回复句号以使用推测的指令。",
		);
		// 回复句号确认后展示推测指令的帮助
		await client.shouldReply(".", "指令：probe\nDESCRIPTION");
	});
});
