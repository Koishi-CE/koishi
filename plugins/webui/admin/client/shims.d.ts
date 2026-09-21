// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 浏览器端类型垫片（纯声明，无运行时代码）：
 *
 * "@koishi-ce/plugin-console" 的 Events 镜像：本插件 node 侧的事件声明挂在
 * "@koishi-ce/console"（见 src/index.ts 的 declare module），经 lib 产物 d.ts
 * 的跨文件 declare module 增强在浏览器端类型程序不可靠，group.vue 中 send()
 * 的事件名拿不到类型。在此按 src/index.ts 逐事件同签名镜像，两处须保持
 * 同步（与 plugins/webui/commands/client/utils.ts 为同一模式）。
 */

declare module "@koishi-ce/plugin-console" {
	interface Events {
		"admin/create-track"(name: string): Promise<number>;
		"admin/rename-track"(
			id: number,
			name: string,
		): Promise<void>;
		"admin/delete-track"(id: number): Promise<void>;
		"admin/update-track"(
			id: number,
			permissions: string[],
		): Promise<void>;
		"admin/create-group"(name: string): Promise<number>;
		"admin/rename-group"(
			id: number,
			name: string,
		): Promise<void>;
		"admin/delete-group"(id: number): Promise<void>;
		"admin/update-group"(
			id: number,
			permissions: string[],
		): Promise<void>;
		"admin/add-user"(
			gid: number,
			platform: string,
			aid: string,
		): Promise<void>;
		"admin/remove-user"(
			gid: number,
			platform: string,
			aid: string,
		): Promise<void>;
	}
}
