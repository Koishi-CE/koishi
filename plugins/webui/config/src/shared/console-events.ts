// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * config 插件的 manager/* 控制台事件签名（唯一权威定义）。
 *
 * 本文件的 declare module 块把 ManagerEvents 合并进 "@koishi-ce/console"
 * 的 Events 接口，是 node 侧（writer.ts 经本文件获得 send 事件类型）与
 * 浏览器端（client/components/utils.ts 经 type-only import 拉入本文件）
 * 共用的唯一挂载点，避免双份镜像漂移。
 */

/** manager/* 事件的载荷签名（配置的重载 / 停用 / 移除 / 改名 / 拖拽）。 */
interface ManagerEvents {
	"manager/app-reload"(config: unknown): void;
	"manager/teleport"(
		source: string,
		key: string,
		target: string,
		index: number,
	): void;
	"manager/reload"(
		parent: string,
		key: string,
		config: unknown,
	): void;
	"manager/unload"(
		parent: string,
		key: string,
		config: unknown,
		index?: number,
	): void;
	"manager/remove"(parent: string, key: string): void;
	"manager/meta"(ident: string, config: unknown): void;
}

declare module "@koishi-ce/console" {
	interface Events extends ManagerEvents {}
}
