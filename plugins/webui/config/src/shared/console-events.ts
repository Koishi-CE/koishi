// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * config 插件的 manager/* 控制台事件签名（唯一权威定义）。
 *
 * 服务端（writer.ts）与浏览器端（client/components/utils.ts）分别对
 * "@koishi-ce/console" 与 "@koishi-ce/plugin-console" 做同名声明合并：
 * 浏览器端 tsconfig 无 paths，console 的类型来自宿主 shims 的手写环境
 * 声明，模块名必须分开挂载。Events 文本以本文件的 ManagerEvents 为
 * 唯一来源，两端经 extends 引用，避免双份镜像漂移。本文件须被两端
 * import（type-only 即可）才会进入各自的类型程序。
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

declare module "@koishi-ce/plugin-console" {
	interface Events extends ManagerEvents {}
}
