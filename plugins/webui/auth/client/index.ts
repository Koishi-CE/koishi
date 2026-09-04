// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * auth 插件（浏览器端入口）：登录页、个人资料页与鉴权路由守卫。
 *
 * - 插件加载时用本地记忆的令牌尝试静默续期登录
 * - 全局路由守卫：需登录的页面未登录时跳 /login，权限不足时阻断
 * - 注册 /login 与 /profile 两个页面、绑定/同步两个全局对话框插槽
 *   以及"用户设置"面板中的配置同步开关
 */

import {
	type Context,
	deepEqual,
	icons,
	message,
	pick,
	router,
	Schema,
	send,
	store,
	useConfig,
} from "@koishi-ce/client";
import type { Binding } from "@koishi-ce/koishi";
import type {
	Auth,
	LoginToken,
	UserLogin,
	UserUpdate,
} from "@koishi-ce/plugin-auth";
import type { DataService } from "@koishi-ce/plugin-console";
import {
	defineComponent,
	h,
	resolveComponent,
	watch,
} from "vue";
import BindDialog from "./bind-dialog.vue";
import At from "./icons/at.vue";
import Check from "./icons/check.vue";
import Lock from "./icons/lock.vue";
import SignIn from "./icons/sign-in.vue";
import SignOut from "./icons/sign-out.vue";
import UserFull from "./icons/user-full.vue";
import Login from "./login.vue";
import Profile from "./profile.vue";
import SyncDialog from "./sync-dialog.vue";
import {
	shared,
	showLoginDialog,
	showSyncDialog,
} from "./utils";

import "virtual:uno.css";

// 浏览器侧协议事件与数据服务的类型增强:send()/store 的类型来自
// @koishi-ce/client 内置的 "@koishi-ce/plugin-console" 手写垫片(见
// packages/web/client/client/shims.d.ts),因此这里增强的是该垫片模块,
// 与服务端 src/index.ts 对 "@koishi-ce/console" 的增强一一对应。
interface AuthData extends Auth {
	tokens: Omit<LoginToken, "token" | "id">[];
	bindings: Omit<Binding, "aid">[];
}

declare module "@koishi-ce/plugin-console" {
	interface Events {
		"login/platform"(
			platform: string,
			pid: string,
		): Promise<UserLogin>;
		"login/password"(name: string, password: string): void;
		"login/token"(id: number, token: string): void;
		"user/delete-token"(inc: number): void;
		"user/unbind"(platform: string, pid: string): void;
		"user/update"(data: UserUpdate): void;
		"user/logout"(): void;
	}

	namespace Console {
		export interface Services {
			user: DataService<AuthData>;
		}
	}
}

icons.register("at", At);
icons.register("check", Check);
icons.register("lock", Lock);
icons.register("sign-in", SignIn);
icons.register("sign-out", SignOut);
icons.register("user-full", UserFull);

export default (ctx: Context) => {
	// 本地登录态的 id/token/expiredAt 由同一批 pick 写入,同时存在。
	// 刷新页面后用未过期的令牌向服务端静默续期登录
	const { token, id, expiredAt } = shared.value;
	if (
		token &&
		id !== undefined &&
		expiredAt !== undefined &&
		expiredAt > Date.now()
	) {
		send("login/token", id, token).catch((e) =>
			message.error(e.message),
		);
	}

	// 声明各活动（页面）的可见性：要求权限高于当前登录态时隐藏
	ctx.on("activity", (data) => {
		const authority = data.authority ?? 0;
		return (
			authority > 0 &&
			(!store.user || store.user.authority < authority)
		);
	});

	// 全局路由守卫：需要登录（声明 authority 或依赖 user 数据）的页面
	// 在未登录时重定向到 /login；已登录但权限不足则阻断并提示
	ctx.scope.disposables.push(
		router.beforeEach((route) => {
			const { activity } = route.meta;
			if (!activity) return;
			if (
				(activity.authority ||
					(activity.fields ?? []).includes("user")) &&
				!store.user
			) {
				// 处理浏览器返回：上一页就是登录页时回到首页，避免返回键在两页间打转
				return history.state.forward === "/login"
					? "/"
					: "/login";
			}

			if (
				activity.authority &&
				store.user &&
				activity.authority > store.user.authority
			) {
				message.error("权限不足。");
				return false;
			}
		}),
	);

	// 登录页：已登录时从活动列表隐藏
	ctx.page({
		path: "/login",
		name: "登录",
		icon: "sign-in",
		position: "bottom",
		order: 500,
		disabled: () => !!store.user,
		component: Login,
	});

	// 个人资料页：依赖 user 数据服务（须登录）
	ctx.page({
		path: "/profile",
		name: "用户资料",
		icon: "user-full",
		fields: ["user"],
		position: "bottom",
		order: 500,
		component: Profile,
	});

	// 两个全局对话框：绑定平台账户 / 配置同步冲突
	ctx.slot({
		type: "global",
		component: BindDialog,
	});

	ctx.slot({
		type: "global",
		component: SyncDialog,
	});

	// "用户设置"面板：配置同步开关（shared 持久化到 localStorage）
	ctx.settings({
		id: "user",
		title: "用户设置",
		component: defineComponent(
			() => () =>
				h(resolveComponent("k-form"), {
					schema: Schema.object({
						sync: Schema.boolean().description(
							"在多个客户端间同步设置。",
						),
					}).description("同步设置"),
					initial: shared.value,
					modelValue: shared.value,
					"onUpdate:modelValue": (
						value: typeof shared.value,
					) => (shared.value = value),
				}),
		),
	});

	const config = useConfig();

	/** 比较本地与云端的用户配置，不一致时弹出同步选择框。 */
	function checkSync() {
		// 两处调用点均已确保 store.user 存在,此处仅作收窄守卫
		if (!store.user) return;
		if (deepEqual(store.user.config, config.value)) return;
		showSyncDialog.value = true;
	}

	// 本地配置变化且已开启同步：自动上传云端
	ctx.on(
		"dispose",
		watch(
			config,
			async (value) => {
				if (!value || !store.user || !shared.value.sync)
					return;
				await send("user/update", { config: value });
			},
			{ deep: true },
		),
	);

	// 开启同步的瞬间立即比对一次本地与云端
	ctx.on(
		"dispose",
		watch(
			() => shared.value.sync,
			async (value) => {
				if (value && store.user) checkSync();
			},
		),
	);

	// 登录态变化：登出时回登录页；登录成功时记忆令牌（供下次静默续期）、
	// 按需比对同步配置，并跳转到来路页面或个人资料页
	ctx.on(
		"dispose",
		watch(
			() => store.user,
			(value, oldValue) => {
				showLoginDialog.value = false;
				if (!value) {
					return router.push("/login");
				}

				if (shared.value.sync) checkSync();
				if (oldValue) return;
				Object.assign(
					shared.value,
					pick(value, ["id", "name", "token", "expiredAt"]),
				);
				message.success(
					`欢迎回来，${value.name || "Koishi 用户"}！`,
				);
				const from =
					router.currentRoute.value.redirectedFrom;
				if (from && !from.path.startsWith("/login")) {
					router.push(from);
				} else {
					router.push("/profile");
				}
			},
		),
	);
};
