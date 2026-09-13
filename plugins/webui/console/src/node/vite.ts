// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.
// upstream: koishijs/webui plugins/console/src/node/index.ts（createVite 段；nextFreePort 为本仓新增；上游为单文件，本仓拆分时抽离至本文件，同步时以其整体 diff 对照本目录）

/**
 * Vite 开发服务器集成（原 node/index.ts 的 createVite 方法拆出）。
 *
 * devMode 下创建 Vite 开发服务器并桥接到 server 的 /vite 路径，实现
 * 插件前端热更新；含 HMR WebSocket 端口的占用顺延探测。
 */

import net from "node:net";
import { resolve } from "node:path";
import type { Context } from "@koishi-ce/koishi";
import type { ServerOptions, ViteDevServer } from "vite";
import type NodeConsole from "./index.ts";

/** Vite HMR WebSocket 的缺省端口（Vite 内置值，middlewareMode 下独立监听）。 */
const defaultWsPort = 24678;

/**
 * 自 start 起找到首个空闲端口：以一次性探测 server 逐个试听，占用
 * （EADDRINUSE）则递增重试，试探上限耗尽时直接返回起点交由 Vite 报错。
 */
function nextFreePort(
	start: number,
	attempts = 100,
): Promise<number> {
	if (!attempts) return Promise.resolve(start);
	return new Promise((resolve) => {
		const probe = net.createServer();
		probe.once("error", () =>
			resolve(nextFreePort(start + 1, attempts - 1)),
		);
		probe.listen(start, "127.0.0.1", () => {
			probe.close(() => resolve(start));
		});
	});
}

/**
 * 创建 Vite 开发服务器并桥接到 server：
 * /vite 前缀的请求转交 Vite 中间件处理（含 /vite/@fs/ 的按需编译），
 * 返回的实例由调用方（NodeConsole.createVite 薄委托）持有，插件卸载时
 * 关闭服务器。
 */
export async function createDevServer(
	ctx: Context,
	config: NodeConsole.Config,
): Promise<ViteDevServer> {
	const { cacheDir = "cache/vite", dev } = config;
	// 惰性动态加载：避免生产环境（非 devMode）加载 vite 依赖
	const { createServer } = await import(
		"@koishi-ce/client/lib"
	);

	// Vite 6.0.9 起 host 校验默认仅放行 localhost 与 IP 直连，域名访问
	// dev 控制台会被 403 拦截；dev.allowedHosts 透传 server.allowedHosts
	// 供显式放行。上游缺陷报告：
	// https://github.com/koishijs/koishi/issues/1492
	const server: ServerOptions = dev ? { fs: dev.fs } : {};
	if (dev?.allowedHosts)
		server.allowedHosts = dev.allowedHosts;
	// Vite 8 起 middlewareMode 下 HMR WebSocket 不再借宿主 HTTP 服务，
	// 而是独立监听 server.ws.port（缺省 24678）；并行第二个 dev 实例会
	// EADDRINUSE 且 HMR 失效（Bun 的此类错误缺 port 字段，Vite 打印成
	// 「Port undefined is already in use」）。显式配置优先，否则沿用
	// 宿主 server 的占用顺延策略
	const wsPort =
		dev?.wsPort ?? (await nextFreePort(defaultWsPort));
	if (wsPort !== defaultWsPort)
		ctx.logger.info(
			"HMR WebSocket 端口 %d 被占用，dev 控制台热更新改用 %d",
			defaultWsPort,
			wsPort,
		);
	server.ws = { port: wsPort };

	const vite = await createServer(ctx.baseDir, {
		cacheDir: resolve(ctx.baseDir, cacheDir),
		server,
	});

	ctx.server.all(
		"/vite(.*)",
		(ctx) =>
			new Promise((resolve) => {
				vite.middlewares(ctx.req, ctx.res, resolve);
			}),
	);

	ctx.on("dispose", () => vite.close());

	return vite;
}
