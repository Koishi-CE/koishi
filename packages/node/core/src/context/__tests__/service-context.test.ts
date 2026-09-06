// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * getServiceContext 的行为测试：服务归属反查须覆盖 cordis 的全部
 * 注册形态——Service 子类（构造器赋真实 ctx 自有属性）、ctx.provide()
 * 注册的普通对象（仅 tracker 符号，descriptor 落空须属性访问兜底，
 * loader / hmr 的 watcher 即此形态）、无归属标记的裸对象（返回
 * undefined）。
 */
import { describe, expect, it } from "bun:test";
import {
	Context,
	getServiceContext,
	Service,
} from "../index.ts";

describe("getServiceContext", () => {
	it("Service 子类实例反查到提供者上下文", () => {
		const app = new Context({});
		// Service 的提供者是其构造所在的 fork 上下文；注意不能以
		// proxy 的 instance.ctx 比对——那是 traceable 的调用者视角语义
		let captured!: Context;
		class FakeService extends Service {
			constructor(ctx: Context) {
				super(ctx, "probe.svc-like", true);
				captured = ctx;
			}
		}
		app.plugin(FakeService);
		const instance = app.get("probe.svc-like");
		expect(instance).toBeInstanceOf(FakeService);
		expect(
			getServiceContext(instance as object)?.scope.uid,
		).toBe(captured.scope.uid);
	});

	it("provide() 注册的普通对象同样反查到（descriptor 落空走属性访问）", () => {
		const app = new Context({});
		const marker = { hello: 1 };
		app.provide("probe.plain", marker);
		const instance = app.get("probe.plain");
		// 前置确认：此形态没有自有 ctx 属性（正是历史上 descriptor
		// 单独查询漏报 loader / watcher 的根源）
		expect(
			Reflect.getOwnPropertyDescriptor(
				instance,
				Context.current,
			),
		).toBeUndefined();
		expect(getServiceContext(instance as object)).toBe(
			app.root,
		);
	});

	it("无归属标记的裸对象返回 undefined", () => {
		expect(getServiceContext({})).toBeUndefined();
	});
});
