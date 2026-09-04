// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 控制台前端宿主应用入口（scripts/client.ts 总装构建的主入口）。
 *
 * 依次注册内置的功能插件（首页 / 布局 / 设置 / 状态栏 / 全局样式 / 主题），
 * 启动应用根上下文后，在非静态模式下与 Koishi 服务端建立 WebSocket 连接。
 */

import { connect, global, root } from "@koishi-ce/client";
import home from "./home";
import layout from "./layout";
import settings from "./settings";
import status from "./status";
import styles from "./styles";
import theme from "./theme";

import "virtual:uno.css";
import "./index.scss";

root.plugin(home);
root.plugin(layout);
root.plugin(settings);
root.plugin(status);
root.plugin(styles);
root.plugin(theme);

root.start();

if (!global.static) {
	// global.static 为真表示纯静态构建（无后端），跳过连接
	const endpoint = new URL(
		global.endpoint,
		location.origin,
	).toString();
	connect(
		root,
		() => new WebSocket(endpoint.replace(/^http/, "ws")),
	);
}
