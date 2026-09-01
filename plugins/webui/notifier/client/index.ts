// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * notifier 插件（浏览器侧入口）。
 *
 * - 把 config.vue 注册为"插件详情页"的扩展插槽（展示该插件的常驻通知）；
 * - 监听 node 侧广播的 notifier/message 即时通知，转成控制台消息条弹出，
 *   离开当前路由时自动关闭（effect 清理）。
 */
import { type Context, message } from "@koishi-ce/client";
import type {} from "@koishi-ce/plugin-notifier";
import Config from "./config.vue";

import "virtual:uno.css";

/** 即时通知事件的载荷（type 语义与 node 侧 Notifier.Type 一致）。 */
interface NotifierMessage {
	content: string;
	type: "success" | "warning" | "error" | "primary";
}

declare module "@koishi-ce/client" {
	interface Events<C> {
		"notifier/message"(this: C, payload: NotifierMessage): void;
	}
}

export default (ctx: Context) => {
	ctx.slot({
		type: "plugin-details",
		component: Config,
		order: 0,
	});

	ctx.on("notifier/message", ({ content, type }) => {
		ctx.effect(() => {
			const handler = message({
				message: content,
				type: type === "primary" ? "info" : type,
			});
			return () => handler.close();
		});
	});
};
