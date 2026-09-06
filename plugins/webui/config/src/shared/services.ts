// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 服务状态提供器：以 `services` 数据服务的形式向浏览器端上报当前
 * 应用中每个已注册服务的提供者信息（服务名 → 提供该服务的上下文 uid）。
 * 前端据此判断某插件"必需/可选注入的服务"是否已可用。
 *
 * 遍历方式：从根上下文的 internal 对象出发沿原型链逐层收集类型为
 * "service" 的属性，再通过 Context.current 访问器反查服务实例所属的
 * 上下文，取其作用域 uid。
 */
import { DataService } from "@koishi-ce/console";
import { Context, type Dict } from "@koishi-ce/koishi";

export class ServiceProvider extends DataService<
	Dict<number>
> {
	constructor(ctx: Context) {
		super(ctx, "services");
		// 任何服务的注册 / 注销都会改变统计结果
		ctx.on("internal/service", () => this.refresh());
	}

	override async get() {
		const services = {} as Dict<number>;
		/**
		 * 递归遍历 internal 对象的原型链，收集所有服务属性。
		 *
		 * @param internal 当前层级的 internal 对象
		 */
		const attach = (
			internal: Context[typeof Context.internal],
		) => {
			if (!internal) return;
			attach(Object.getPrototypeOf(internal));
			for (const [key, { type }] of Object.entries(
				internal,
			)) {
				if (type !== "service") continue;
				const instance = this.ctx.get(key);
				if (!(instance instanceof Object)) continue;
				// Context.current 是个访问器属性，其值即服务实例所属的上下文。
				// cordis 3.18 起 ctx.provide() 注册的服务（loader / hmr 的
				// watcher 等）不再有自有 "ctx" 属性（只定义 tracker 符号，
				// 其 traceable 代理在 "ctx" 键上返回上下文），descriptor
				// 查询会落空——补一层属性访问，否则此类服务在配置页
				// 恒显示「未加载」（上游 plugin-config 同样命中此缺陷）
				const ctx = (Reflect.getOwnPropertyDescriptor(
					instance,
					Context.current,
				)?.value ??
					Reflect.get(instance, Context.current)) as
					| Context
					| undefined;
				if (!ctx) continue;
				// 服务内部名形如 __foo__，对外展示时去掉首尾下划线
				const name = key
					.replace(/^__/, "")
					.replace(/__$/, "");
				// 已销毁的 scope(uid 为 null)不参与统计
				if (ctx.scope.uid !== null) {
					services[name] = ctx.scope.uid;
				}
			}
		};
		attach(this.ctx.root[Context.internal]);
		return services;
	}
}
