// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * auth 浏览器端的跨组件共享状态。
 *
 * shared 是 localStorage 持久化的登录偏好（登录方式、上次输入的账号与
 * 令牌等，供刷新后静默续期）；两个对话框开关由各处触发、对应组件消费。
 */

import { useStorage } from "@koishi-ce/client";
import type { LoginToken } from "@koishi-ce/plugin-auth";
import { ref } from "vue";

/** 给客户端配置补充 auth 插件的自定义字段（配置同步开关）。 */
declare module "@koishi-ce/client" {
	interface Config {
		sync?: boolean;
	}
}

/** 本地持久化的登录相关状态（令牌字段在登录成功后写入）。 */
interface SharedConfig extends Partial<LoginToken> {
	sync?: boolean;
	name?: string;
	authType: 0 | 1;
	platform?: string;
	userId?: string;
	password?: string;
}

/** localStorage("auth") 的响应式包装：跨页面刷新保留的登录状态。 */
export const shared = useStorage<SharedConfig>(
	"auth",
	2,
	() => ({
		authType: 0,
	}),
);

/** 登录对话框开关（个人资料页"添加绑定"时唤起）。 */
export const showLoginDialog = ref(false);
/** 配置同步冲突对话框开关（本地与云端配置不一致时唤起）。 */
export const showSyncDialog = ref(false);
