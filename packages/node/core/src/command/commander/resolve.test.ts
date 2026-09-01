// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * CommanderResolve（命令推断与解析）补充测试。
 *
 * 覆盖 inferCommand 的按名（argv.name）解析分支与未命中分支、
 * 根消息带引用时 captureQuote 的追加 token 行为（含关闭配置），
 * 以及具名别名预设 args / options 的注入。
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { App, type Argv, type Session } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

const app = new App();
app.plugin(mock);
const bot = app.bots[0]!;
const client = app.mock.client("123");

app.command("qu [x:text]").action((_, x) => x);
app.command("nq [x:text]", { captureQuote: false }).action((_, x) => x);
app
	.command("al")
	.alias("alx", { args: ["pre"] })
	.action((argv) => `ok:${JSON.stringify(argv.args)}`);

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("Commander Resolve", () => {
	it("resolveCommand 按 argv.name 解析命令", () => {
		const session = bot.session({ platform: "mock" }) as Session;
		const argv = { name: "qu", session } as Argv;
		expect(app.$commander.resolveCommand(argv)?.name).toBe("qu");
		// 解析出的命令写回 argv.command
		expect(argv.command?.name).toBe("qu");
	});

	it("resolveCommand 未命中的名字返回 undefined", () => {
		const session = bot.session({ platform: "mock" }) as Session;
		const argv = { name: "missing", session } as Argv;
		expect(app.$commander.resolveCommand(argv)).toBeUndefined();
		expect(argv.command).toBeUndefined();
	});

	it("根消息的引用内容追加为带引号的参数", async () => {
		// 引用内容作为最后一个参数并入贪婪 text 参数
		await client.shouldReply(
			'<quote id="1">quoted</quote>qu base',
			/base.*quoted/,
		);
	});

	it("captureQuote 关闭时不追加引用内容", async () => {
		await client.shouldReply('<quote id="1">quoted</quote>nq base', "base");
	});

	it("具名别名注入预设参数", async () => {
		await client.shouldReply("alx", 'ok:["pre"]');
	});
});
