// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { App } from "@koishi-ce/koishi";
import commands from "@koishi-ce/plugin-commands";
import * as help from "@koishi-ce/plugin-help";
import mock from "@koishi-ce/plugin-mock";

/**
 * @koishi-ce/plugin-commands 的行为测试：
 * 覆盖别名增删、指令在树中的移动（teleport）、指令创建 / 销毁，
 * 以及插件卸载后对原指令的恢复；分别验证「配置驱动」与「聊天指令驱动」两条路径。
 */
const app = new App();

app.plugin(help);
app.plugin(mock);

const client = app.mock.client("123");

beforeAll(() => app.start());
afterAll(() => app.stop());

afterEach(() => {
	// 每个用例结束后清空指令表并卸载插件，避免状态串扰
	for (const command of app.$commander._commandList.slice()) {
		if (command.name === "help") continue;
		command.dispose();
	}
	app.registry.delete(commands);
});

describe("@koishi-ce/plugin-commands", () => {
	describe("basic usage", () => {
		it("dispose command", async () => {
			// 指令本体被销毁后，插件为其注册的别名应一并失效
			const cmd = app.command("bar").action(() => "test");

			await client.shouldReply("bar", "test");
			await client.shouldNotReply("baz");

			app.plugin(commands, {
				bar: "baz",
			});

			await client.shouldReply("bar", "test");
			await client.shouldReply("baz", "test");

			cmd.dispose();

			await client.shouldNotReply("bar");
			await client.shouldNotReply("baz");
		});

		it("dispose plugin", async () => {
			// 插件先于指令加载时也能补挂别名；卸载插件后别名撤销、原指令保持可用
			const fork = app.plugin(commands, {
				bar: "baz",
			});

			await client.shouldNotReply("bar");
			await client.shouldNotReply("baz");

			app.command("bar").action(() => "test");
			await app.sleep(0);

			await client.shouldReply("bar", "test");
			await client.shouldReply("baz", "test");

			fork.dispose();

			await client.shouldReply("bar", "test");
			await client.shouldNotReply("baz");
		});

		it("edit command", async () => {
			// 通过 `command` 聊天指令增删别名，改动应同步写入插件配置
			const fork = app.plugin(commands, {});

			app.command("bar").action(() => "test");
			await client.shouldNotReply("baz");
			await client.shouldReply(
				"command bar -a baz",
				"已更新指令配置。",
			);
			await client.shouldReply("baz", "test");
			expect(fork.config).toEqual({
				bar: {
					aliases: {
						baz: {},
					},
				},
			});

			await client.shouldReply(
				"command bar -A baz",
				"已更新指令配置。",
			);
			await client.shouldNotReply("baz");
		});
	});

	describe("teleport (config)", () => {
		it("leaf to root", async () => {
			// 配置写法：把子指令提升为顶层指令并追加别名
			const foo = app.command("foo");
			app.command("foo/bar").action(() => "test");
			expect(foo.children).toHaveLength(1);

			const fork = app.plugin(commands, {
				bar: "/baz",
			});

			expect(foo.children).toHaveLength(0);
			await client.shouldReply("bar", "test");
			await client.shouldReply("baz", "test");

			fork.dispose();
			await client.shouldReply("bar", "test");
			await client.shouldNotReply("baz");
			expect(foo.children).toHaveLength(1);
		});

		it("root to leaf", async () => {
			// 配置写法：把顶层指令挂到其它指令之下并追加别名
			const foo = app.command("foo");
			app.command("bar").action(() => "test");
			expect(foo.children).toHaveLength(0);

			const fork = app.plugin(commands, {
				bar: "foo/baz",
			});

			expect(foo.children).toHaveLength(1);
			await client.shouldReply("bar", "test");
			await client.shouldReply("baz", "test");

			fork.dispose();
			await client.shouldReply("bar", "test");
			await client.shouldNotReply("baz");
			expect(foo.children).toHaveLength(0);
		});

		it("leaf to leaf", async () => {
			// 配置写法：把子指令挂到尚未注册的父指令下（pending 补挂），
			// 父指令被销毁后应回到原父级
			const bar = app.command("bar");
			app.command("bar/foo").action(() => "test");
			expect(bar.children).toHaveLength(1);

			const fork = app.plugin(commands, {
				foo: "baz/foo",
			});

			expect(bar.children).toHaveLength(1);
			const baz = app.command("baz");
			await app.sleep(0);
			expect(bar.children).toHaveLength(0);
			expect(baz.children).toHaveLength(1);
			await client.shouldReply("foo", "test");

			baz.dispose();
			expect(bar.children).toHaveLength(1);

			fork.dispose();
			await client.shouldReply("foo", "test");
			expect(bar.children).toHaveLength(1);
			expect(baz.children).toHaveLength(0);
		});
	});

	describe("teleport (command)", () => {
		it("leaf to root", async () => {
			// 聊天指令写法：-P 提升为顶层，-a 追加别名
			const foo = app.command("foo");
			app.command("foo/bar").action(() => "test");
			expect(foo.children).toHaveLength(1);

			const fork = app.plugin(commands, {});
			await client.shouldReply(
				"command bar -P -a baz",
				"已更新指令配置。",
			);
			expect(foo.children).toHaveLength(0);
			await client.shouldReply("bar", "test");
			await client.shouldReply("baz", "test");

			fork.dispose();
			await client.shouldReply("bar", "test");
			await client.shouldNotReply("baz");
			expect(foo.children).toHaveLength(1);
		});

		it("root to leaf", async () => {
			// 聊天指令写法：-p 指定父指令并追加别名
			const foo = app.command("foo");
			app.command("bar").action(() => "test");
			expect(foo.children).toHaveLength(0);

			const fork = app.plugin(commands, {});
			await client.shouldReply(
				"command bar -p foo -a baz",
				"已更新指令配置。",
			);
			expect(foo.children).toHaveLength(1);
			await client.shouldReply("bar", "test");
			await client.shouldReply("baz", "test");

			fork.dispose();
			await client.shouldReply("bar", "test");
			await client.shouldNotReply("baz");
			expect(foo.children).toHaveLength(0);
		});

		it("leaf to leaf", async () => {
			// 聊天指令写法：目标父指令尚不存在，待其注册后补挂；
			// 父指令销毁后回到原父级
			const bar = app.command("bar");
			app.command("bar/foo").action(() => "test");
			expect(bar.children).toHaveLength(1);

			const fork = app.plugin(commands, {});
			await client.shouldReply(
				"command foo -p baz",
				"已更新指令配置。",
			);
			expect(bar.children).toHaveLength(1);
			const baz = app.command("baz");
			await app.sleep(0);
			expect(bar.children).toHaveLength(0);
			expect(baz.children).toHaveLength(1);
			await client.shouldReply("foo", "test");

			baz.dispose();
			expect(bar.children).toHaveLength(1);

			fork.dispose();
			await client.shouldReply("foo", "test");
			expect(bar.children).toHaveLength(1);
			expect(baz.children).toHaveLength(0);
		});
	});

	describe("create", () => {
		it("from config", async () => {
			// 配置里的 create: true 应在加载时直接创建新指令，
			// 卸载插件后新指令连同子指令一起消失
			app.command("bar").action(() => "test");

			const fork = app.plugin(commands, {
				foo: { create: true },
				bar: "foo/baz",
			});

			const foo = app.command("foo");
			expect(foo.children).toHaveLength(1);
			await client.shouldReply("foo", /baz/);
			await client.shouldReply("baz", "test");

			fork.dispose();
			await client.shouldNotReply("foo");
			await client.shouldNotReply("baz");
			await client.shouldReply("bar", "test");
		});

		it("from command", async () => {
			// 聊天指令 -c 创建新指令；父指令不存在时先报错，创建后子指令补挂
			app.command("bar").action(() => "test");

			const fork = app.plugin(commands, {});
			await client.shouldReply(
				"command bar -p foo -n baz",
				"已更新指令配置。",
			);
			await client.shouldReply(
				"command foo",
				"指令不存在。",
			);
			await client.shouldReply(
				"command foo -c",
				"已创建指令。",
			);

			const foo = app.command("foo");
			await app.sleep(0);
			expect(foo.children).toHaveLength(1);
			await client.shouldReply("foo", /baz/);
			await client.shouldReply("baz", "test");

			fork.dispose();
			await client.shouldNotReply("foo");
			await client.shouldNotReply("baz");
			await client.shouldReply("bar", "test");
		});
	});
});
