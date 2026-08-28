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
import { defineComponent, h, resolveComponent, watch } from "vue";
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
import { shared, showLoginDialog, showSyncDialog } from "./utils";

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
		"login/platform"(platform: string, pid: string): Promise<UserLogin>;
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
	// 本地登录态的 id/token/expiredAt 由同一批 pick 写入,同时存在
	if (shared.value.token && shared.value.expiredAt! > Date.now()) {
		send("login/token", shared.value.id!, shared.value.token).catch((e) =>
			message.error(e.message),
		);
	}

	ctx.on("activity", (data) => {
		const authority = data.authority ?? 0;
		return authority > 0 && (!store.user || store.user.authority < authority);
	});

	ctx.scope.disposables.push(
		router.beforeEach((route) => {
			const { activity } = route.meta;
			if (!activity) return;
			if (
				(activity.authority || (activity.fields ?? []).includes("user")) &&
				!store.user
			) {
				// handle router.back()
				return history.state.forward === "/login" ? "/" : "/login";
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

	ctx.page({
		path: "/login",
		name: "登录",
		icon: "sign-in",
		position: "bottom",
		order: 500,
		disabled: () => !!store.user,
		component: Login,
	});

	ctx.page({
		path: "/profile",
		name: "用户资料",
		icon: "user-full",
		fields: ["user"],
		position: "bottom",
		order: 500,
		component: Profile,
	});

	ctx.slot({
		type: "global",
		component: BindDialog,
	});

	ctx.slot({
		type: "global",
		component: SyncDialog,
	});

	ctx.settings({
		id: "user",
		title: "用户设置",
		component: defineComponent(
			() => () =>
				h(resolveComponent("k-form"), {
					schema: Schema.object({
						sync: Schema.boolean().description("在多个客户端间同步设置。"),
					}).description("同步设置"),
					initial: shared.value,
					modelValue: shared.value,
					"onUpdate:modelValue": (value: any) => (shared.value = value),
				}),
		),
	});

	const config = useConfig();

	function checkSync() {
		// 两处调用点均已确保 store.user 存在,此处仅作收窄守卫
		if (!store.user) return;
		if (deepEqual(store.user.config, config.value)) return;
		showSyncDialog.value = true;
	}

	ctx.on(
		"dispose",
		watch(
			config,
			async (value) => {
				if (!value || !store.user || !shared.value.sync) return;
				// biome-ignore lint/nursery/noFloatingPromises: 已在 async 回调中 await，nursery 规则对 send 调用的误报
				await send("user/update", { config: value });
			},
			{ deep: true },
		),
	);

	ctx.on(
		"dispose",
		watch(
			() => shared.value.sync,
			async (value) => {
				if (value && store.user) checkSync();
			},
		),
	);

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
				message.success(`欢迎回来，${value.name || "Koishi 用户"}！`);
				const from = router.currentRoute.value.redirectedFrom;
				if (from && !from.path.startsWith("/login")) {
					router.push(from);
				} else {
					router.push("/profile");
				}
			},
		),
	);
};
