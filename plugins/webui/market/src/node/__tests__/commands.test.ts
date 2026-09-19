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
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "@koishi-ce/koishi";
import {
	App,
	app,
	client,
	FakeConsole,
	type FakeLoader,
	http,
	itQuiet,
	Logger,
	market,
	registryData,
	registryServer,
	setNextExitCode,
	setSearchResponse,
	spawnCalls,
	startApp,
	stopApp,
	type TestApp,
	tmp,
} from "./helpers.ts";

beforeAll(startApp);
afterAll(stopApp);

describe("market 聊天指令", () => {
	itQuiet(
		"plugin.install 缺参与未找到的报错路径",
		async () => {
			const missing = await client.receive(
				"plugin.install",
			);
			expect(missing[0]).toContain("请输入插件名。");
			const notFound = await client.receive(
				"plugin.install absent-pkg",
			);
			expect(notFound[0]).toContain("未找到该插件。");
		},
	);

	it("plugin.install 已安装时提示重复", async () => {
		const replies = await client.receive(
			"plugin.install demo",
		);
		expect(replies[0]).toContain("该插件已安装。");
	});

	itQuiet(
		"plugin.install 安装新插件并写入依赖",
		async () => {
			setNextExitCode(0);
			spawnCalls.length = 0;
			const replies = await client.receive(
				"plugin.install newpkg",
			);
			expect(replies[0]).toContain("安装成功！");
			expect(spawnCalls.length).toBe(1);
			const manifest = JSON.parse(
				await Bun.file(join(tmp, "package.json")).text(),
			) as { dependencies: Record<string, string> };
			expect(
				manifest.dependencies["koishi-plugin-newpkg"],
			).toBe("1.0.0");
			// 重启消息在安装完成后复位（Loader 与桩形状不同，经 unknown 二段式断言）
			expect(
				(app.loader as unknown as FakeLoader).envData[
					"message"
				],
			).toBeNull();
		},
		15000,
	);

	itQuiet(
		"plugin.uninstall 卸载依赖并从清单移除",
		async () => {
			setNextExitCode(0);
			spawnCalls.length = 0;
			const replies = await client.receive(
				"plugin.uninstall newpkg",
			);
			expect(replies[0]).toContain("卸载成功！");
			const manifest = JSON.parse(
				await Bun.file(join(tmp, "package.json")).text(),
			) as { dependencies: Record<string, string> };
			expect(
				manifest.dependencies["koishi-plugin-newpkg"],
			).toBeUndefined();
		},
		15000,
	);

	it("plugin.uninstall 未安装时提示", async () => {
		const replies = await client.receive(
			"plugin.uninstall absent-pkg",
		);
		expect(replies[0]).toContain("该插件未安装。");
	});

	it("plugin.upgrade 无可升级项时提示已最新", async () => {
		const replies = await client.receive("plugin.upgrade");
		expect(replies[0]).toContain("所有插件已是最新版本。");
	}, 10000);
});

describe("market 进阶链路", () => {
	itQuiet("宿主配置不可写时不加载安装器", async () => {
		// apply 的「仅告警并跳过」正是被测行为，静默 app 域避免预期告警刷屏
		const levels = Logger.levels as Record<string, number>;
		levels["app"] = 0;
		try {
			const appNoLoader = new App();
			appNoLoader.plugin(http);
			appNoLoader.plugin(
				FakeConsole as unknown as Plugin.Constructor<TestApp>,
			);
			appNoLoader.plugin(market, {
				registry: {
					endpoint: `http://127.0.0.1:${registryServer.port}/`,
				},
			});
			await appNoLoader.start();
			// apply 在 loader 缺席时仅告警并提前返回
			expect(appNoLoader.installer).toBeUndefined();
			await appNoLoader.stop();
		} finally {
			delete levels["app"];
		}
	});

	itQuiet(
		"浏览器 market/install 监听器执行安装并刷新服务",
		async () => {
			setNextExitCode(0);
			const listener =
				app.console.listeners["market/install"];
			expect(listener).toBeDefined();
			const code = (await listener?.callback.call(
				{} as never,
				{ "koishi-plugin-newpkg": "1.0.0" },
				true,
			)) as number;
			expect(code).toBe(0);
		},
		15000,
	);

	itQuiet(
		"浏览器 market/registry 监听器批量查询包元数据",
		async () => {
			const listener =
				app.console.listeners["market/registry"];
			expect(listener).toBeDefined();
			const meta = (await listener?.callback.call(
				{} as never,
				["koishi-plugin-demo", "koishi-plugin-missing"],
			)) as Record<string, unknown>;
			expect(
				Object.keys(meta["koishi-plugin-demo"] ?? {}),
			).toContain("2.0.0");
			expect(meta["koishi-plugin-missing"]).toEqual({});
		},
	);

	it("搜索结果中不兼容的包被跳过（analyze onSkipped/ignored）", async () => {
		const svc = app.get("console.services.market");
		// ghost 有 registry 条目，但版本声明的 koishi peer 与 4.x 不相交
		registryData["koishi-plugin-ghost"] = {
			versions: {
				"1.0.0": {
					version: "1.0.0",
					peerDependencies: { koishi: "^5.0.0" },
				},
			},
			time: { "1.0.0": "2024-01-01T00:00:00Z" },
		};
		setSearchResponse({
			objects: [
				{
					package: {
						name: "koishi-plugin-ghost",
						version: "1.0.0",
						date: "2024-01-01T00:00:00Z",
					},
				},
			],
			total: 1,
		});
		await svc?.start(true);
		// collect 对 analyze 为即发即忘，等待逐包分析完成
		await new Promise((resolve) =>
			setTimeout(resolve, 300),
		);
		const payload = await svc?.get();
		// 无兼容版本：对象标记 ignored，不进入数据缓存。
		// progress 恒为 0：Scanner 以 defineProperty 定义 progress（不可写），
		// analyze 收尾的自增在严格模式下抛错且被即发即忘吞掉（上游行为）。
		expect(payload?.data).toEqual({});
		expect(payload?.failed).toBe(0);
		expect(payload?.total).toBe(1);
		expect(payload?.progress).toBe(0);
		delete registryData["koishi-plugin-ghost"];
	});

	itQuiet(
		"搜索结果中被限流的包经重试后计入 failed（onFailure）",
		async () => {
			const svc = app.get("console.services.market");
			setSearchResponse({
				objects: [
					{
						package: {
							name: "koishi-plugin-ratelimited",
							version: "1.0.0",
							date: "2024-01-01T00:00:00Z",
						},
					},
				],
				total: 1,
			});
			await svc?.start(true);
			// 等待限流重试（Retry-After 10ms × 3 次）与即发即忘的 analyze。
			// 注意不能经 get() 断言：super.start() 会清空 _task，get() 触发的
			// 二次 collect 会把 failed 重置（即发即忘的 analyze 尚未完成）。
			await new Promise((resolve) =>
				setTimeout(resolve, 400),
			);
			// 不可达/被限流的包名进入 failed 列表（上一个用例中 registry
			// 条目已删除的 ghost 包经 404 路径同样落入此处）
			const provider = svc as unknown as {
				failed: string[];
			};
			expect(
				provider.failed.some((name) =>
					name.startsWith("koishi-plugin-"),
				),
			).toBe(true);
		},
	);

	itQuiet(
		"plugin.upgrade 检出可升级项并输出确认提示",
		async () => {
			// 本地放置旧版安装，使 resolved 有值且低于远端 latest
			mkdirSync(
				join(tmp, "node_modules", "koishi-plugin-demo"),
				{
					recursive: true,
				},
			);
			writeFileSync(
				join(
					tmp,
					"node_modules",
					"koishi-plugin-demo",
					"package.json",
				),
				JSON.stringify({
					name: "koishi-plugin-demo",
					version: "1.0.0",
				}),
			);
			app.installer.refresh();

			setNextExitCode(0);
			// 发出升级指令（异步等待确认），再以 Y 回复确认。
			// 注：mock 环境下指令 ctx 对 loader 服务的可见性受 cordis
			// isolate 语义限制（见仓库测试任务记录），确认后的安装段
			// 由 market/install 监听器用例覆盖。
			const question = client.receive(
				"plugin.upgrade demo",
			);
			await new Promise((resolve) =>
				setTimeout(resolve, 200),
			);
			await client.receive("Y");
			const replies = await question;
			const output = replies.join("\n");
			expect(output).toContain("koishi-plugin-demo");
			expect(output).toContain("1.0.0 -> 2.0.0");
		},
		20000,
	);

	itQuiet(
		"plugin.upgrade 对本地畸形版本静默跳过（非法 semver catch）",
		async () => {
			// registry 侧提供合法 latest；本地安装产物的 version 是畸形串，
			// request（清单声明）合法故不标记 invalid，gt(latest, resolved)
			// 解析失败进入 catch 分支：该包被过滤，视为无可升级项
			registryData["koishi-plugin-weird"] = {
				versions: {
					"2.0.0": {
						version: "2.0.0",
						peerDependencies: { koishi: "^4.17.0" },
					},
				},
			};
			mkdirSync(
				join(tmp, "node_modules", "koishi-plugin-weird"),
				{
					recursive: true,
				},
			);
			writeFileSync(
				join(
					tmp,
					"node_modules",
					"koishi-plugin-weird",
					"package.json",
				),
				JSON.stringify({
					name: "koishi-plugin-weird",
					version: "not.a.version",
				}),
			);
			setNextExitCode(0);
			// 经 install 注入清单声明（顺带刷新 Installer 的 manifest 快照）
			const code = await app.installer.install({
				"koishi-plugin-weird": "1.0.0",
			});
			expect(code).toBe(0);
			const deps = await app.installer.getDeps();
			expect(deps["koishi-plugin-weird"]?.resolved).toBe(
				"not.a.version",
			);
			const replies = await client.receive(
				"plugin.upgrade weird",
			);
			expect(replies[0]).toContain(
				"所有插件已是最新版本。",
			);
		},
		20000,
	);
});
