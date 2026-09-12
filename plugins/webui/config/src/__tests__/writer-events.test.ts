// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import type { Plugin } from "@koishi-ce/koishi";
import {
	app,
	client,
	flushWrites,
	itQuiet,
	loader,
	readSent,
	startApp,
	stopApp,
	writer,
} from "./helpers.ts";

beforeAll(startApp);
afterAll(stopApp);

describe("@koishi-ce/plugin-config", () => {
	describe("ConfigWriter.get()", () => {
		it("过滤未加载项，分组递归展开，$ 与 ~ 键原样保留", async () => {
			const result = await writer().get();
			const plugins = result.plugins as Record<
				string,
				unknown
			>;
			// $if 为假的键不出现；$ 内部键与 ~ 停用键保留
			expect("gone:xyz" in plugins).toBe(false);
			expect(plugins["$sfolded"]).toBe(true);
			expect(plugins["~disabled:q"]).toEqual({ a: 1 });
			expect(plugins["keep:abc"]).toEqual({ v: 1 });
			expect(plugins["group:g1"]).toEqual({
				"./plugins/webui/auth": {},
				"./missing-pkg": {},
				"inner:two": { t: 2 },
				"mov:me": { m: 1 },
			});
		});
	});

	describe("ConfigWriter 事件", () => {
		it("manager/meta 更新元数据键（含 null 删除）", async () => {
			const listener =
				app.console.listeners["manager/meta"];
			await listener?.callback.call(
				client as never,
				"abc",
				{
					$label: "L",
					$collapsed: null,
				},
			);
			await flushWrites();
			const plugins = loader.config.plugins as Record<
				string,
				Record<string, unknown>
			>;
			expect(plugins["keep:abc"]?.["$label"]).toBe("L");
			expect(
				"$collapsed" in (plugins["keep:abc"] ?? {}),
			).toBe(false);
			// 元数据键置于配置开头
			expect(
				Object.keys(plugins["keep:abc"] ?? {})[0],
			).toBe("$label");
			// 分组内插件的 meta（按 ident 递归定位）
			await listener?.callback.call(
				client as never,
				"two",
				{
					$label: "G",
				},
			);
			await flushWrites();
			const group = plugins["group:g1"] as Record<
				string,
				Record<string, unknown>
			>;
			expect(group["inner:two"]?.["$label"]).toBe("G");
		});

		it("manager/reload 更新插件配置并保持键位置", async () => {
			const listener =
				app.console.listeners["manager/reload"];
			await listener?.callback.call(
				client as never,
				"",
				"keep:abc",
				{
					v: 2,
				},
			);
			await flushWrites();
			const plugins = loader.config.plugins as Record<
				string,
				unknown
			>;
			expect(plugins["keep:abc"]).toEqual({ v: 2 });
			const dummy = loader.data["keep"] as Plugin;
			expect(app.registry.get(dummy)?.config).toEqual({
				v: 2,
			});
			// 运行期更新触发回写
			expect(loader.writes.length).toBeGreaterThan(0);
		});

		it("manager/unload 停用插件（原位改 ~ 与按位置插入）", async () => {
			const listener =
				app.console.listeners["manager/unload"];
			// 原位重命名
			await listener?.callback.call(
				client as never,
				"",
				"keep:abc",
				{
					v: 3,
				},
			);
			await flushWrites();
			const plugins = loader.config.plugins as Record<
				string,
				unknown
			>;
			expect("keep:abc" in plugins).toBe(false);
			expect(plugins["~keep:abc"]).toEqual({ v: 3 });
			const dummy = loader.data["keep"] as Plugin;
			expect(app.registry.get(dummy)).toBeUndefined();

			// 先补一个可停用键，再按 index 插入到指定位置
			const reload =
				app.console.listeners["manager/reload"];
			await reload?.callback.call(
				client as never,
				"",
				"back:two",
				{
					b: 1,
				},
			);
			await flushWrites();
			await listener?.callback.call(
				client as never,
				"",
				"back:two",
				{},
				1,
			);
			await flushWrites();
			const keys = Object.keys(
				loader.config.plugins as object,
			);
			expect(keys.indexOf("~back:two")).toBe(1);
		});

		it("manager/remove 彻底移除插件（含 ~ 停用态键）", async () => {
			const listener =
				app.console.listeners["manager/remove"];
			await listener?.callback.call(
				client as never,
				"",
				"~keep:abc",
			);
			await flushWrites();
			const plugins = loader.config.plugins as Record<
				string,
				unknown
			>;
			expect("keep:abc" in plugins).toBe(false);
			expect("~keep:abc" in plugins).toBe(false);
			await listener?.callback.call(
				client as never,
				"",
				"pos:one",
			);
			await flushWrites();
			expect("pos:one" in plugins).toBe(false);
		});

		it("manager/teleport 跨分组迁移与同分组重排", async () => {
			const listener =
				app.console.listeners["manager/teleport"];
			const plugins = loader.config.plugins as Record<
				string,
				unknown
			>;
			// 跨分组：group:g1 → 根（index 0）
			await listener?.callback.call(
				client as never,
				"g1",
				"mov:me",
				"",
				0,
			);
			await flushWrites();
			expect(plugins["mov:me"]).toEqual({ m: 1 });
			const group = plugins["group:g1"] as Record<
				string,
				unknown
			>;
			expect("mov:me" in group).toBe(false);
			// 运行时 fork 已改挂根作用域
			const dummy = loader.data["mov"] as Plugin;
			const fork = app.registry.get(dummy)?.children[0];
			expect(fork?.parent.scope.uid).toBe(
				loader.entry.scope.uid,
			);

			// 同分组：仅重排键位置
			await listener?.callback.call(
				client as never,
				"",
				"mov:me",
				"",
				0,
			);
			await flushWrites();
			expect(Object.keys(plugins)[0]).toBe("mov:me");
		});

		itQuiet(
			["loader"],
			"manager/* 失败统一回执 failed",
			async () => {
				const listener =
					app.console.listeners["manager/teleport"];
				await expect(
					listener?.callback.call(
						client as never,
						"no-such-group",
						"k",
						"",
						0,
					),
				).rejects.toThrow("failed");
			},
		);

		it("manager/app-reload 替换全局配置并整进程重载", async () => {
			const listener =
				app.console.listeners["manager/app-reload"];
			const writesBefore = loader.writes.length;
			await listener?.callback.call(client as never, {
				prefix: ["."],
			});
			await flushWrites();
			expect(loader.config.prefix).toEqual(["."]);
			// plugins 部分被保留
			expect(loader.config.plugins).toBeTruthy();
			expect(loader.writes.length).toBeGreaterThan(
				writesBefore,
			);
			expect(loader.fullReloadCount).toBe(1);
			// 非静默写盘触发 config 事件 → config 服务刷新推送
			const messages = readSent().filter(
				(msg) =>
					msg.type === "data" && msg.body.key === "config",
			);
			expect(messages.length).toBeGreaterThan(0);
		});
	});
});
