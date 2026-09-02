// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * help 插件测试：覆盖帮助列表、指令属性（别名 / 用法 / 示例 / 权限）、
 * 选项展示、子指令、无数据库场景与 shortcut / options 配置开关。
 */
import { beforeAll, describe, it } from "bun:test";
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

app.i18n.define("$zh-CN", "commands.help.messages.global-epilog", "EPILOG");

const client = app.mock.client("123", "456");

beforeAll(async () => {
	await app.start();
	await app.mock.initUser("123", 2);
	await app.mock.initChannel("456");
});

let message: string;

describe("@koishi-ce/plugin-help", () => {
	// 验证全局帮助列表、“帮助”快捷调用、-h 选项与相似度建议（“您要找的是不是…”）
	it("basic support", async () => {
		await client.shouldReply(
			"help",
			(message = [
				"当前可用的指令有：",
				"    help  显示帮助信息",
				"EPILOG",
			].join("\n")),
		);

		// 全局快捷调用
		await client.shouldReply("帮助", message);

		await client.shouldReply(
			"help help",
			(message = [
				"指令：help [command]",
				"显示帮助信息",
				"可用的选项有：",
				"    -H, --show-hidden  查看隐藏的选项和指令",
			].join("\n")),
		);

		await client.shouldReply("help xxxx", "指令未找到。");
		await client.shouldReply(
			"help heip",
			"指令未找到。您要找的是不是“help”？回复句号以使用推测的指令。",
		);
		await client.shouldReply(".", message);
		await client.shouldReply("help -h", message);
		await client.shouldReply("help 帮助", message);
	});

	// 验证 description / 别名 / usage / example / authority 等指令属性在帮助中的呈现
	it("command attributes", async () => {
		app.command("foo1", "DESCRIPTION").alias("foo");
		app.command("foo3", "DESCRIPTION").shortcut(/foobar/);
		app.command("foo4", "DESCRIPTION").usage("USAGE TEXT");
		app.command("foo5", "DESCRIPTION").usage(({ userId }) => `${userId}`);
		app.command("foo6", "DESCRIPTION").example("EXAMPLE TEXT");
		app.command("foo7", "DESCRIPTION", { authority: 3 });

		await client.shouldReply(
			"help foo1",
			"指令：foo1\nDESCRIPTION\n别名：foo。",
		);
		await client.shouldReply("help foobar", "指令：foo3\nDESCRIPTION");
		await client.shouldReply(
			"help foo4",
			"指令：foo4\nDESCRIPTION\nUSAGE TEXT",
		);
		await client.shouldReply("help foo5", "指令：foo5\nDESCRIPTION\n123");
		await client.shouldReply(
			"help foo6",
			"指令：foo6\nDESCRIPTION\n使用示例：\n    EXAMPLE TEXT",
		);
		await client.shouldReply("help foo7", "权限不足。");
	});

	// 验证 hideOptions、选项权限与 hidden 选项的过滤，以及 -H 的全量展示
	it("command options", async () => {
		const bar = app
			.command("bar <arg:number>", "DESCRIPTION", { hideOptions: true })
			.option("opt1", "选项1", { authority: 2 })
			.option("opt1", "-n  选项2", { value: false })
			.option("opt2", "[arg:boolean]  选项3")
			.option("opt3", "-o [arg:boolean]", { hidden: true });

		await client.shouldReply(
			"help bar",
			(message = "指令：bar <arg>\nDESCRIPTION"),
		);

		bar.config.hideOptions = false;

		await client.shouldReply(
			"help bar",
			[
				message,
				"可用的选项有：",
				"    --opt1  选项1",
				"    -n  选项2",
				"    --opt2 [arg]  选项3",
			].join("\n"),
		);

		await client.shouldReply(
			"help bar -H",
			[
				message,
				"可用的选项有：",
				"    -h, --help  显示此信息",
				"    --opt1  选项1",
				"    -n  选项2",
				"    --opt2 [arg]  选项3",
				"    -o, --opt3 [arg]",
			].join("\n"),
		);
	});

	// 验证多级子指令在父指令帮助中的逐层呈现
	it("subcommand", async () => {
		const foo2 = app.command("foo2", "DESCRIPTION", { authority: 0 });
		const foo1 = foo2.subcommand("foo1");
		foo1.subcommand("foo3");

		await client.shouldReply(
			"help foo2",
			[
				"指令：foo2",
				"DESCRIPTION",
				"可用的子指令有：",
				"    foo1  DESCRIPTION",
			].join("\n"),
		);

		await client.shouldReply(
			"help foo1",
			[
				"指令：foo1",
				"DESCRIPTION",
				"别名：foo。",
				"可用的子指令有：",
				"    foo3  DESCRIPTION",
			].join("\n"),
		);
	});

	// 无数据库环境下 help 仍能正常列出指令
	it("no database", async () => {
		const app = new App();
		app.plugin(help);
		app.plugin(mock);
		app.i18n.define("$zh-CN", "commands.help.messages.global-epilog", "");
		await app.start();

		const client = app.mock.client("123");
		await client.shouldReply(
			"help",
			"当前可用的指令有：\n    help  显示帮助信息",
		);
	});

	// options: false 时不为指令注入 -h 选项
	it("disable help options", async () => {
		const app = new App();
		app.plugin(help, { options: false });
		app.plugin(mock);
		app.command("foo").action(() => {});
		await app.start();

		const client = app.mock.client("123");
		await client.shouldReply("help");
		await client.shouldNotReply("foo -h");
	});

	// shortcut: false 时不注册“帮助”全局快捷调用
	it("disable help shortcut", async () => {
		const app = new App();
		app.plugin(help, { shortcut: false });
		app.plugin(mock);
		await app.start();

		const client = app.mock.client("123");
		await client.shouldReply("help");
		await client.shouldNotReply("帮助");
	});

	// 带 checkArgCount 的指令在缺参追问后仍可用 -h 查看帮助（回归 #769）
	it("checkArgCount (#769)", async () => {
		const app = new App();
		app.plugin(help);
		app.plugin(mock);
		app.command("test <arg>", { checkArgCount: true }).action(() => "pass");
		await app.start();

		const client = app.mock.client("123");
		await client.shouldReply("test", "请发送arg。");
		await client.shouldReply("foo", "pass");
		await client.shouldReply("test -h", "指令：test <arg>");
	});
});
