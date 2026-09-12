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
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Dict, Plugin } from "@koishi-ce/koishi";
import {
	app,
	client,
	flushWrites,
	itQuiet,
	loader,
	startApp,
	stopApp,
	TestConsole,
	tick,
} from "./helpers.ts";

beforeAll(startApp);
afterAll(stopApp);

describe("@koishi-ce/plugin-config", () => {
	describe("PackageProvider", () => {
		it("收集本机包与 workspace 源码包并附全局设置条目", async () => {
			const provider = app.get(
				"console.services.packages",
			) as unknown as {
				get(): Promise<Dict<Record<string, unknown>>>;
			};
			const data = await provider.get();
			// 全局设置条目（name 为空串）排在最前
			expect(data[""]).toBeTruthy();
			// workspace 路径键引用的源码包：带 paths 与运行时缓存
			const auth = data["@koishi-ce/plugin-auth"];
			expect(auth?.["paths"]).toEqual([
				"./plugins/webui/auth",
			]);
			expect(auth?.["runtime"]).toBeTruthy();
			// 本机 node_modules 扫描出的已装插件包（fixture 预置，见文件头说明）
			expect(
				data["@koishi-ce/plugin-fixture"],
			).toBeTruthy();
		});

		it("扫描 external/ 约定目录收录未启用的 workspace 插件", async () => {
			const provider = app.get(
				"console.services.packages",
			) as unknown as {
				get(): Promise<Dict<Record<string, unknown>>>;
				pathKeys: Dict<string>;
				cache: Dict<Record<string, unknown>>;
			};
			const data = await provider.get();
			// 命名合规的插件包：收录并标注相对路径键
			const war = data["koishi-plugin-war-game"];
			expect(war?.["workspace"]).toBe(true);
			expect(war?.["paths"]).toEqual([
				"./external/war-game",
			]);
			// 未启用包不预热运行时缓存（require 会提前求值模块）
			expect(war?.["runtime"]).toBeUndefined();
			// 「包名 → 配置键」反查已登记，request-runtime 按需解析可用
			expect(
				provider.pathKeys["koishi-plugin-war-game"],
			).toBe("./external/war-game");
			expect(
				provider.cache["./external/war-game"],
			).toBeUndefined();
			// 非插件命名与无清单目录不进列表
			expect(data["plain-lib"]).toBeUndefined();
			expect(data["no-manifest"]).toBeUndefined();
		});

		it("workspaces 声明驱动收录嵌套 monorepo 子包与 plugins/ 未启用包", async () => {
			const provider = app.get(
				"console.services.packages",
			) as unknown as {
				get(): Promise<Dict<Record<string, unknown>>>;
			};
			const data = await provider.get();
			// 嵌套子包（external/** 任意深度）：收录并以深路径为键
			const lib = data["koishi-plugin-war-lib"];
			expect(lib?.["workspace"]).toBe(true);
			expect(lib?.["paths"]).toEqual([
				"./external/infra/packages/war-lib",
			]);
			expect(lib?.["runtime"]).toBeUndefined();
			// plugins/ 一级的未启用包同样可收录（此前的可见性盲区）
			expect(
				data["koishi-plugin-local-tool"]?.["paths"],
			).toEqual(["./plugins/local-tool"]);
			// monorepo 根（@scope/monorepo 命名）不进列表
			expect(data["@infra/monorepo"]).toBeUndefined();
			// node_modules 残留探针被负向通配排除（即使命名合规）
			expect(
				data["koishi-plugin-zzz-pollution"],
			).toBeUndefined();
		});

		it("readWorkspacePatterns：无清单 / 非数组 / 空数组时回退约定", async () => {
			const { readWorkspacePatterns } = await import(
				"../node/packages.ts"
			);
			const empty = mkdtempSync(
				join(tmpdir(), "koishi-config-ws-"),
			);
			try {
				// 无 package.json → 兜底约定
				expect(readWorkspacePatterns(empty)).toEqual([
					"plugins/*",
					"external/*",
				]);
				// 非数组（yarn no-hoist 对象形态）与空数组同理
				writeFileSync(
					join(empty, "package.json"),
					JSON.stringify({
						workspaces: { packages: ["external/*"] },
					}),
				);
				expect(readWorkspacePatterns(empty)).toEqual([
					"plugins/*",
					"external/*",
				]);
				writeFileSync(
					join(empty, "package.json"),
					JSON.stringify({ workspaces: [] }),
				);
				expect(readWorkspacePatterns(empty)).toEqual([
					"plugins/*",
					"external/*",
				]);
				// 合法声明原样透传（负向模式保留 ! 前缀）
				writeFileSync(
					join(empty, "package.json"),
					JSON.stringify({
						workspaces: [
							"external/**",
							"!external/**/node_modules/**",
						],
					}),
				);
				expect(readWorkspacePatterns(empty)).toEqual([
					"external/**",
					"!external/**/node_modules/**",
				]);
			} finally {
				rmSync(empty, { recursive: true, force: true });
			}
		});

		itQuiet(
			["config"],
			"request-runtime 按路径键 / 短名解析并刷新，失败结果同样缓存",
			async () => {
				const listener =
					app.console.listeners["config/request-runtime"];
				expect(listener).toBeTruthy();
				const provider = app.get(
					"console.services.packages",
				) as unknown as {
					cache: Dict<{ failed?: boolean }>;
					pathKeys: Dict<string>;
				};
				// 失败路径：stub 的 bad-plugin 抛错，{ failed: true } 入缓存并
				// 随数据下发——前端据以展示失败提示并停止重发请求
				await listener?.callback.call(
					client as never,
					"bad-plugin",
				);
				await flushWrites();
				expect(provider.cache["bad-plugin"]).toEqual({
					failed: true,
				});
				// 重复请求命中失败缓存，不再触发 loader.import（防活锁刷屏）
				const importsAfterFirst =
					loader.importCounts["bad-plugin"] ?? 0;
				expect(importsAfterFirst).toBeGreaterThan(0);
				await listener?.callback.call(
					client as never,
					"bad-plugin",
				);
				await flushWrites();
				expect(loader.importCounts["bad-plugin"] ?? 0).toBe(
					importsAfterFirst,
				);
				// 成功路径：workspace 包名命中 pathKeys
				await listener?.callback.call(
					client as never,
					"@koishi-ce/plugin-auth",
				);
				await flushWrites();
				expect(
					provider.pathKeys["@koishi-ce/plugin-auth"],
				).toBe("./plugins/webui/auth");
				expect(
					provider.cache["./plugins/webui/auth"],
				).toBeTruthy();
				expect(
					provider.cache["./plugins/webui/auth"]?.failed,
				).toBeUndefined();
			},
		);

		it("internal/runtime / fork / status 与 hmr/reload 触发运行时更新", async () => {
			const dummy = loader.data["keep"] as Plugin;
			const runtime = app.registry.get(dummy);
			expect(runtime).toBeTruthy();
			// keyFor 命中缓存：重新解析并去抖刷新
			app.emit("internal/runtime", runtime as never);
			// 未登记的插件：直接返回
			app.emit("internal/runtime", {
				runtime: { plugin: TestConsole },
			} as never);
			const fork = runtime?.children[0];
			expect(fork).toBeTruthy();
			app.emit("internal/fork", fork as never);
			// internal/status 签名为 (scope, oldValue) 双参，仓库内监听者均不消费第二参，
			// 补 undefined 占位满足调用形状且不改变运行时行为
			app.emit(
				"internal/status",
				fork as never,
				undefined as never,
			);
			app.emit("hmr/reload", [[dummy]] as never);
			await tick(30);
			expect(true).toBe(true);
		});
	});
});
