// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/plugin-actions（应用指令面板）Node 侧的骨架测试。
 *
 * 该插件的全部功能位于浏览器端，Node 侧 apply 为空实现：
 * 此处验证插件骨架可正常加载与卸载、配置 schema 为空对象形态。
 */
import { describe, expect, it } from "bun:test";
import { App, type Plugin } from "@koishi-ce/koishi";
import * as actions from "@koishi-ce/plugin-actions";

describe("@koishi-ce/plugin-actions", () => {
	it("空实现 apply 可正常加载与卸载", async () => {
		const app = new App();
		// 插件源码以 cordis 原生 Context 声明 apply，与本仓扩展 Context 逆变不匹配，测试侧按行为等价转型
		const actionsPlugin =
			actions as unknown as Plugin.Object<App>;
		const fork = app.plugin(actionsPlugin);
		expect(app.registry.has(actionsPlugin as never)).toBe(
			true,
		);
		await app.start();
		// apply 为空实现：不注册任何指令 / 服务 / 事件
		expect(
			Object.keys(app.console?.listeners ?? {}),
		).toEqual([]);
		fork.dispose();
		await app.stop();
	});

	it("Config 为空对象 schema", () => {
		expect(actions.Config).toBeTruthy();
		expect(actions.Config({})).toEqual({});
	});
});
