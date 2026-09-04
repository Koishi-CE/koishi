// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Command 杂项补充测试：序列化与定义层 API。
 *
 * 覆盖 Command.normalize 命名归一化、toJSON 平台无关序列化
 * （含非字符串类型降级、子命令树）、usage / example 帮助信息注册、
 * displayName 写入别名表首位、use 回调直通，
 * 以及 Commander.updateCommands 只同步顶层可斜线指令。
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { App, Command } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import "../../../tests/shape.ts";

const app = new App();
app.plugin(mock);
const bot = app.bots[0]!;

const cmd = app.command(
	"ser <a:number> [b:text]",
	"描述文本",
);
cmd.option("reg", "-r <v>", { type: /x/ });
cmd.option("plain", "-p");
cmd.usage("用法说明").example("ser 1 2");
cmd.subcommand(".kid", "子指令");
// 不可斜线的顶层命令不应被同步
app.command("hidden", { slash: false });

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("Command Misc", () => {
	it("normalize 命令名归一化", () => {
		expect(Command.normalize("Foo_Bar")).toBe("foo-bar");
		expect(Command.normalize("CMD")).toBe("cmd");
	});

	it("toJSON 序列化为平台无关描述", () => {
		const json = cmd.toJSON();
		expect(json).toHaveShape({
			name: "ser",
			description: { "": "描述文本" },
			arguments: [
				{ name: "a", type: "number", required: true },
				{ name: "b", type: "text", required: false },
			],
			options: [
				// 正则类型的选项序列化时降级为 string
				{ name: "reg", type: "string", required: true },
				{ name: "plain", type: "boolean", required: false },
			],
			children: [{ name: "ser.kid" }],
		});
	});

	it("usage 与 example 的注册", () => {
		expect(cmd._usage).toBe("用法说明");
		expect(cmd._examples).toEqual(["ser 1 2"]);
	});

	it("displayName 写入别名表首位", () => {
		cmd.displayName = "renamed";
		expect(cmd.displayName).toBe("renamed");
		expect(Object.keys(cmd._aliases)).toEqual([
			"renamed",
			"ser",
		]);
	});

	it("use 直接调用回调并返回其结果", () => {
		// use 的签名沿袭历史形状（约束回调返回 Command），运行时直通任意返回值，
		// 以绑定 this 的宽松签名视图调用，保持回调的原始返回类型
		const useLoose = cmd.use.bind(cmd) as (
			callback: (command: Command) => string,
		) => string;
		expect(useLoose((self) => self.name)).toBe("ser");
	});

	it("updateCommands 只同步顶层可斜线指令", async () => {
		let captured: { name: string }[] = [];
		Object.defineProperty(bot, "updateCommands", {
			value: async (list: { name: string }[]) => {
				captured = list;
			},
			configurable: true,
		});
		await app.$commander.updateCommands(bot);
		expect(captured.map((item) => item.name)).toEqual([
			"ser",
		]);
		delete (bot as { updateCommands?: unknown })
			.updateCommands;
	});
});
