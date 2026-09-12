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
	App,
	type Dict,
	type Plugin,
} from "@koishi-ce/koishi";
import * as configPlugin from "@koishi-ce/plugin-config";
import {
	app,
	itQuiet,
	readSent,
	socket,
	startApp,
	stopApp,
	TestConsole,
	tick,
} from "./helpers.ts";

beforeAll(startApp);
afterAll(stopApp);

describe("@koishi-ce/plugin-config", () => {
	itQuiet(
		["app"],
		"无可写 loader 时仅告警并跳过装配",
		async () => {
			const bare = new App();
			bare.plugin(
				TestConsole as unknown as Plugin.Constructor<App>,
			);
			bare.plugin(configPlugin);
			await bare.start();
			expect(
				bare.get("console.services.config"),
			).toBeUndefined();
			expect(
				bare.get("console.services.packages"),
			).toBeUndefined();
			expect(
				bare.get("console.services.services"),
			).toBeUndefined();
			await bare.stop();
		},
	);

	it("挂载 packages / services / config 三个数据服务", () => {
		expect(
			app.get("console.services.packages"),
		).toBeTruthy();
		expect(
			app.get("console.services.services"),
		).toBeTruthy();
		expect(app.get("console.services.config")).toBeTruthy();
	});

	describe("ServiceProvider", () => {
		it("上报各服务的提供者上下文并在服务变动时刷新", async () => {
			const provider = app.get(
				"console.services.services",
			) as unknown as {
				get(): Promise<Dict<number>>;
			};
			const data = await provider.get();
			expect(data["console"]).toBeGreaterThanOrEqual(0);
			// 服务注册（set 会广播 internal/service）→ refresh → 客户端收到 services 数据
			socket.sent.length = 0;
			app.set(
				"probe.svc" as never,
				{ marker: true } as never,
			);
			await tick(30);
			const messages = readSent().filter(
				(msg) =>
					msg.type === "data" &&
					msg.body.key === "services",
			);
			expect(messages.length).toBeGreaterThan(0);
		});

		it("provide() 注册的服务同样上报（loader / watcher 形态）", async () => {
			const provider = app.get(
				"console.services.services",
			) as unknown as {
				get(): Promise<Dict<number>>;
			};
			// cordis 3.18 的 ctx.provide() 不给值定义自有 "ctx" 属性
			// （只有 tracker 符号，经 traceable 代理的属性访问可达），
			// descriptor 查询落空时须以属性访问兜底，否则配置页
			// 恒显示「必需服务未加载」
			app.provide("probe.plain", { marker: 1 });
			const data = await provider.get();
			expect(data["probe.plain"]).toBeGreaterThanOrEqual(0);
		});
	});
});
