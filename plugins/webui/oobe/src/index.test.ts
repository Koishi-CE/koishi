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
import { App, type Plugin } from "@koishi-ce/koishi";
import * as oobe from "./index.ts";

/**
 * oobe 插件的 Node 侧为空实现（功能全在浏览器端引导流程），
 * 此处验证插件骨架可正常加载、销毁，且空配置 Schema 行为符合预期。
 */
const app = new App();

// 插件源码以 cordis 原生 Context 声明 apply，与本仓扩展 Context 逆变不匹配，测试侧按行为等价转型
const oobePlugin = oobe as unknown as Plugin.Object<App>;
app.plugin(oobePlugin);

beforeAll(() => app.start());

afterAll(async () => {
	await app.stop();
});

describe("oobe 插件骨架", () => {
	it("空 apply 可正常加载与停止", async () => {
		// 插件加载成功即 scope 存在且状态正常
		expect(app.registry.has(oobePlugin as never)).toBe(
			true,
		);
		await app.stop();
		await app.start();
	});

	it("Config 为空对象 Schema", () => {
		expect(oobe.Config({})).toEqual({});
	});
});
