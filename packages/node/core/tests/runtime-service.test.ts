// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Koishi Service 基类与 defineConfig 工具的测试。
 *
 * Service 在 satori.Service 之上把 setup 阶段的 ctx 替换为新建的
 * Koishi Context（不经 ctx.plugin 注入、直接以配置构造时触发），
 * 使服务内部副作用挂在 Koishi 上下文体系内；
 * defineConfig 是配置透传的类型断言工具。
 */
import { describe, expect, it } from "bun:test";
import { App, type Context, defineConfig, Service } from "@koishi-ce/koishi";

interface MyConfig {
	foo: string;
}

class MyService extends Service<MyConfig, Context> {
	static [Service.provide] = "test-service";

	declare ctx: Context;

	constructor(...args: unknown[]) {
		super(args[0] as MyConfig);
	}
}

describe("Koishi Service", () => {
	it("setup 阶段以全新 Koishi Context 充当服务 ctx", () => {
		// 直接以配置构造（无 ctx 实参）触发 setup 路径
		const service = new MyService({ foo: "bar" });
		expect(service.ctx).toBeInstanceOf(App);
		expect(service.name).toBe("test-service");
		expect(service.config).toEqual({ foo: "bar" });
	});

	it("defineConfig 原样透传配置对象", () => {
		const config = { prefix: "." };
		expect(defineConfig(config)).toBe(config);
	});
});
