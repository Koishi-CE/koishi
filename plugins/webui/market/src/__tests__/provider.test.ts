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
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RemotePackage } from "@koishi-ce/registry";
import {
	App,
	app,
	http,
	itQuiet,
	registryServer,
	setSearchResponse,
	startApp,
	stopApp,
	tmp,
} from "./helpers.ts";

const { default: Installer } = await import(
	"../node/installer/index.ts"
);

beforeAll(startApp);
afterAll(stopApp);

describe("market 插件", () => {
	it("注册三个数据服务与浏览器监听器", () => {
		expect(
			app.get("console.services.market"),
		).toBeDefined();
		expect(
			app.get("console.services.dependencies"),
		).toBeDefined();
		expect(
			app.get("console.services.registry"),
		).toBeDefined();
		expect(
			app.console.listeners["market/install"],
		).toBeDefined();
		expect(
			app.console.listeners["market/registry"],
		).toBeDefined();
	});

	it("resolveName 解析插件短名的候选全名", () => {
		const installer = app.installer;
		expect(
			installer.resolveName("@koishijs/plugin-echo"),
		).toEqual(["@koishijs/plugin-echo"]);
		expect(
			installer.resolveName("koishi-plugin-echo"),
		).toEqual(["koishi-plugin-echo"]);
		expect(installer.resolveName("@scope/echo")).toEqual([
			"@scope/koishi-plugin-echo",
		]);
		expect(installer.resolveName("echo")).toEqual([
			"@koishijs/plugin-echo",
			"koishi-plugin-echo",
		]);
	});

	it("getDeps 汇总本地依赖并带出远端最新版", async () => {
		const deps = await app.installer.getDeps();
		// 语义化区间去除前缀符号
		expect(deps["koishi-plugin-demo"]?.request).toBe(
			"1.0.0",
		);
		// 远端最新版（本地 registry 预置 2.0.0）
		expect(deps["koishi-plugin-demo"]?.latest).toBe(
			"2.0.0",
		);
		// 非法 semver 标记 invalid
		expect(deps["bad-range"]?.invalid).toBe(true);
	});

	itQuiet(
		"findVersion 返回首个存在的候选包版本",
		async () => {
			const found = await app.installer.findVersion([
				"@koishijs/plugin-none",
				"koishi-plugin-demo",
			]);
			expect(found).toEqual({
				"koishi-plugin-demo": "2.0.0",
			});
			// 全部不存在时返回 undefined
			expect(
				await app.installer.findVersion([
					"@koishijs/plugin-none",
				]),
			).toBeUndefined();
		},
	);

	itQuiet("getPackage 拉取失败时回退为空表", async () => {
		const versions = await app.installer.getPackage(
			"koishi-plugin-missing",
		);
		expect(versions).toEqual({});
	});

	it("setPackage 写入缓存并触发节流广播", async () => {
		app.installer.setPackage("koishi-plugin-demo", [
			{
				version: "3.0.0",
				peerDependencies: { koishi: "^4.17.0" },
				// RemotePackage 的其余元数据字段与本断言无关，最小载荷经 unknown 二段式断言
			} as unknown as RemotePackage,
		]);
		expect(
			Object.keys(
				app.installer.fullCache["koishi-plugin-demo"] ?? {},
			),
		).toEqual(["3.0.0"]);
		// 等待节流窗口
		await new Promise((resolve) =>
			setTimeout(resolve, 600),
		);
	});
});

describe("registry 配置探测", () => {
	it("无显式 endpoint 时按 npmrc / 环境变量探测", async () => {
		// 环境变量优先：npm_config_registry 指向本地服务
		process.env["npm_config_registry"] =
			`http://127.0.0.1:${registryServer.port}/`;
		const app2 = new App();
		app2.plugin(http);
		app2.plugin(Installer, {});
		await app2.start();
		expect(app2.installer.endpoint).toBe(
			`http://127.0.0.1:${registryServer.port}/`,
		);
		await app2.stop();

		// 环境变量缺失时回落到项目 .npmrc（含不合法行与合法 registry 行）
		delete process.env["npm_config_registry"];
		writeFileSync(
			join(tmp, ".npmrc"),
			"not-a-registry-line\nregistry=http://registry.example.npm/\n",
		);
		const app3 = new App();
		app3.plugin(http);
		app3.plugin(Installer, {});
		await app3.start();
		expect(app3.installer.endpoint).toBe(
			"http://registry.example.npm/",
		);
		await app3.stop();
		rmSync(join(tmp, ".npmrc"), { force: true });
	});
});

describe("MarketProvider 市场数据服务", () => {
	it("collect 经搜索接口收集并逐包分析填充缓存", async () => {
		const svc = app.get("console.services.market");
		expect(svc).toBeDefined();
		// 提供搜索结果：一个插件条目 + 一个被忽略条目
		setSearchResponse({
			objects: [
				{
					package: {
						name: "koishi-plugin-demo",
						version: "1.0.0",
						date: "2024-01-01T00:00:00Z",
						keywords: ["koishi", "plugin", "Tool"],
					},
				},
				{
					package: {
						name: "not-a-plugin",
						date: "2024-01-01T00:00:00Z",
					},
				},
			],
			total: 1,
		});
		// start(true) 强制刷新市场数据（重新 collect）
		await svc?.start(true);
		// 等待节流窗口与逐包分析完成
		await new Promise((resolve) =>
			setTimeout(resolve, 700),
		);
		const payload = await svc?.get();
		expect(payload).toBeDefined();
		// 非 plugin 条目被剔除，只保留 demo
		expect(Object.keys(payload?.data ?? {})).toEqual([
			"koishi-plugin-demo",
		]);
		expect(payload?.total).toBe(1);
		expect(payload?.failed).toBe(0);
		expect(payload?.registry).toBe(
			`http://127.0.0.1:${registryServer.port}/`,
		);
	});

	it("依赖 / 注册表数据服务读取安装器缓存", async () => {
		const dependencies = await app
			.get("console.services.dependencies")
			?.get();
		expect(
			dependencies?.["koishi-plugin-demo"]?.request,
		).toBeTruthy();
		expect(
			dependencies?.["koishi-plugin-demo"]?.latest,
		).toBe("2.0.0");

		const registry = await app
			.get("console.services.registry")
			?.get();
		expect(
			Object.keys(registry?.["koishi-plugin-demo"] ?? {}),
		).toContain("2.0.0");
	});

	itQuiet(
		"搜索接口失败时 get 返回空数据与错误标记",
		async () => {
			const svc = app.get("console.services.market");
			setSearchResponse(null);
			// 强制重扫：collect 失败置 _error，get 返回空 payload
			await svc?.start(true);
			const payload = await svc?.get();
			expect(payload).toEqual({
				data: {},
				failed: 0,
				total: 0,
				progress: 0,
			});
			setSearchResponse({
				objects: [],
				total: 0,
			});
		},
	);

	it("控制台连接事件在数据过期时触发刷新", async () => {
		const svc = app.get("console.services.market");
		expect(svc).toBeDefined();
		// 伪造一个在线客户端，使连接事件通过在线检查（broadcast 需可用的 socket）
		const fakeClient = {
			id: "conn-1",
			socket: { send() {} },
		};
		(app.console.clients as Record<string, unknown>)[
			"conn-1"
		] = fakeClient;
		// 刚刷新过：12 小时窗口内直接返回，不重新收集
		const timestamp = svc?.[
			"_timestamp" as keyof typeof svc
		] as number;
		// console/connection 载荷声明为 Client，桩对象仅含在线检查所需的最小面，类型层断言穿透
		app.emit("console/connection", fakeClient as never);
		expect(
			svc?.["_timestamp" as keyof typeof svc] as number,
		).toBe(timestamp);
		// 将时间戳回拨到窗口外，连接事件重新触发 start（异步监听，稍等）
		(svc as Record<string, unknown>)["_timestamp"] = 0;
		app.emit("console/connection", fakeClient as never);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(
			(svc as Record<string, unknown>)[
				"_timestamp"
			] as number,
		).toBeGreaterThan(0);
		delete app.console.clients["conn-1"];
	});
});
