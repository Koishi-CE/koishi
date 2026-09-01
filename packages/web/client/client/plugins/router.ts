// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 路由服务：控制台页面（activity）与插槽视图的注册中心。
 *
 * 封装 vue-router，处理三件事：
 * 1. `ctx.page()` 注册页面——挂路由、进侧栏、管理标题与缓存路径；
 * 2. `ctx.slot()` 向具名插槽（layout / status / global 等）注入视图；
 * 3. 导航守卫——首次导航等待扩展加载，未匹配路径暂存待页面注册后跳转。
 */
import type { Disposable } from "cordis";
import { type Dict, omit, remove } from "cosmokit";
import {
	type Component,
	type MaybeRefOrGetter,
	reactive,
	ref,
	toValue,
} from "vue";
import { createRouter, createWebHistory, START_LOCATION } from "vue-router";
import type { SlotOptions } from "../components";
import Overlay from "../components/chat/overlay.vue";
import type { Context } from "../context";
import { global, type Store, store } from "../data";
import { insert, Service } from "../utils";

declare module "vue-router" {
	interface RouteMeta {
		activity?: Activity;
	}
}

declare module "../context" {
	interface Context {
		$router: RouterService;
		slot(options: SlotOptions): () => void;
		page(options: Activity.Options): () => void;
	}

	interface Events {
		activity(activity: Activity): boolean;
	}
}

/** activity（控制台页面）的注册选项 */
export namespace Activity {
	export interface Options {
		id?: string;
		/** 路由路径，支持 vue-router 动态段（如 "/foo/:id"） */
		path: string;
		/** 开启严格匹配（默认按路径前缀匹配） */
		strict?: boolean;
		component: Component;
		/** 页面标题（未提供时回退到 id） */
		name: MaybeRefOrGetter<string>;
		/** 页面描述（副标题） */
		desc?: MaybeRefOrGetter<string>;
		/** 侧栏图标名，默认 "activity:default" */
		icon?: MaybeRefOrGetter<string>;
		/** 侧栏排序权重，越小越靠前 */
		order?: number;
		/** 访问所需权限等级（authority） */
		authority?: number;
		/** 在侧栏中的位置：顶部或底部 */
		position?: "top" | "bottom";
		/** 依赖的数据服务键：任一未就绪时页面不可进入 */
		fields?: (keyof Store)[];
		/** @deprecated */
		when?: () => boolean;
		disabled?: () => boolean;
	}
}

// 实例上的 desc/name/icon 是 getter(toValue 解析后的值),与 Options 中
// MaybeRefOrGetter 形状不同,故从继承中排除后再声明
export interface Activity
	extends Omit<Activity.Options, "desc" | "name" | "icon"> {
	desc?: string | undefined;
	name?: string | undefined;
	icon?: string | undefined;
}

/** 从路由路径提取 activity id（首个非空路径段），如 "/foo/bar" → "foo" */
function getActivityId(path: string) {
	return path.split("/").find(Boolean) ?? "";
}

/** 页面被卸载时暂存的目标路由：等待路由就绪后由 handleUpdate 跳转 */
export const redirectTo = ref<string | null>();

/**
 * activity：控制台的一个页面（侧栏一项 + 一条 vue-router 路由）。
 * 由 ctx.page() 创建，dispose 时移除路由并尝试回退到首页。
 */
export class Activity {
	id: string;
	_disposables: Disposable[] = [];

	ctx: Context;
	options: Activity.Options;

	constructor(ctx: Context, options: Activity.Options) {
		this.ctx = ctx;
		this.options = options;
		options.order ??= 0;
		options.position ??= "top";
		Object.assign(this, omit(options, ["icon", "name", "desc", "disabled"]));
		const { path, id = getActivityId(path), component } = options;
		// 路由挂载时把 activity 实例放进 meta，供导航守卫与标题栏取用
		this._disposables.push(
			ctx.$router.router.addRoute({
				path,
				name: id,
				component,
				meta: { activity: this },
			}),
		);
		this.id ??= id;
		this.handleUpdate();
		this.authority ??= 0;
		this.fields ??= [];
		ctx.$router.pages[this.id] = this;
	}

	/** 若存在待跳转目标且当前路由已能解析，则立即完成该跳转 */
	handleUpdate() {
		if (redirectTo.value) {
			const location = this.ctx.$router.router.resolve(redirectTo.value);
			if (location.matched.length) {
				redirectTo.value = null;
				this.ctx.$router.router.replace(location);
			}
		}
	}

	/** 页面图标名（默认 "activity:default"，MaybeRefOrGetter 解析后的值） */
	get icon() {
		return toValue(this.options.icon ?? "activity:default");
	}

	/** 页面标题（默认取 id） */
	get name() {
		return toValue(this.options.name ?? this.id);
	}

	/** 页面描述 */
	get desc() {
		return toValue(this.options.desc);
	}

	/**
	 * 判断页面当前是否应被禁用：
	 * activity 事件被拦截（bail）、依赖数据未就绪、when/disabled 判否均视为禁用。
	 */
	disabled() {
		if (this.ctx.bail("activity", this)) return true;
		if (!this.fields?.every((key) => store[key])) return true;
		if (this.when && !this.when()) return true;
		if (this.options.disabled?.()) return true;
		return false;
	}

	dispose() {
		this._disposables.forEach((dispose) => dispose());
		// 若被卸载的恰是当前展示的页面：暂存目标路由，退回缓存的首页
		const current = this.ctx.$router.router.currentRoute.value;
		if (current?.meta?.activity === this) {
			redirectTo.value = current.fullPath;
			this.ctx.$router.router.push(this.ctx.$router.cache["home"] || "/");
		}
		return delete this.ctx.$router.pages[this.id];
	}
}

/**
 * 路由服务：封装 vue-router，管理 activity 页面注册、插槽视图与页面缓存。
 *
 * - `ctx.page()` 注册 activity（页面）；
 * - `ctx.slot()` 向具名插槽（layout / status / global 等）注入视图；
 * - `views` 为插槽名 → 视图列表，`pages` 为页面 id → Activity，
 *   `cache` 记录各页面最近一次访问的完整路径。
 */
export default class RouterService extends Service {
	/** 各插槽（按 type 分组）的视图列表 */
	public views = reactive<Dict<SlotOptions[]>>({});
	/** 页面 id → 最近访问的完整路径（用于"返回上次位置"） */
	public cache = reactive<Record<PropertyKey, string>>({});
	/** 已注册的全部 activity 页面 */
	public pages = reactive<Dict<Activity>>({});
	public router = createRouter({
		history: createWebHistory(global.uiPath),
		// 复用全局 .active 类作为路由激活态样式
		linkActiveClass: "active",
		routes: [],
	});

	constructor(ctx: Context) {
		super(ctx, "$router", true);
		ctx.mixin("$router", ["slot", "page"]);

		const initialTitle = document.title;
		ctx.effect(() =>
			this.router.afterEach((route) => {
				const { name, fullPath } = this.router.currentRoute.value;
				if (name) {
					// 本应用的路由名均为字符串;reactive 收窄了索引签名,不含 symbol
					this.cache[name as string] = fullPath;
				}
				// 进入 activity 页面时更新标签页标题为 "页面名 | 原标题"
				if (route.meta.activity) {
					document.title = `${route.meta.activity.name}`;
					if (initialTitle) document.title += ` | ${initialTitle}`;
				}
			}),
		);

		this.router.beforeEach(async (to, from) => {
			if (to.matched.length) {
				// 已能匹配：目标是具体页面时清空待跳转标记
				if (to.matched[0]?.path !== "/") {
					redirectTo.value = null;
				}
				return;
			}

			// 首次导航（from 为起始位置）时等待扩展加载完，
			// 页面路由由扩展注册，未加载前无法匹配
			if (from === START_LOCATION) {
				await ctx.$loader.initTask;
				const resolved = this.router.resolve(to);
				if (resolved.matched.length) return resolved;
			}

			// 仍无法匹配：暂存目标路径，先落回缓存首页（或 "/"），
			// 待对应页面注册后由 Activity.handleUpdate() 自动跳转
			redirectTo.value = to.fullPath;
			const result = this.cache["home"] || "/";
			if (result === to.fullPath) return;
			return result;
		});

		// 图片查看器等全局浮层经 global 插槽挂载
		this.slot({
			type: "global",
			component: Overlay,
		});
	}

	/**
	 * 向具名插槽注入视图组件；返回取消注册函数。
	 * when 是 disabled 的旧写法（取反语义），仅做兼容转换。
	 */
	slot(options: SlotOptions) {
		options.order ??= 0;
		const component = this.ctx.wrapComponent(options.component);
		if (component) options.component = component;
		if (options.when) {
			const { when } = options;
			options.disabled = () => !when();
		}
		return this.ctx.effect(() => {
			const list = (this.views[options.type] ||= []);
			insert(list, options);
			return () => {
				remove(list, options);
				if (!list.length) delete this.views[options.type];
			};
		});
	}

	/** 注册 activity 页面（自动挂到 vue-router 与侧栏）；返回取消注册函数 */
	page(options: Activity.Options) {
		const component = this.ctx.wrapComponent(options.component);
		if (component) options.component = component;
		return this.ctx.effect(() => {
			const activity = new Activity(this.ctx, options);
			return () => activity.dispose();
		});
	}
}
