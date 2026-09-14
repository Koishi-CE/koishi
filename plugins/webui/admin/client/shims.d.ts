// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 浏览器端类型垫片（纯声明，无运行时代码）：
 *
 * 1. "@koishi-ce/plugin-console" 的 Events 镜像：本插件 node 侧的事件声明挂在
 *    "@koishi-ce/console"（见 src/index.ts 的 declare module），经 lib 产物 d.ts
 *    的跨文件 declare module 增强在浏览器端类型程序不可靠，group.vue 中 send()
 *    的事件名拿不到类型。在此按 src/index.ts 逐事件同签名镜像，两处须保持
 *    同步（与 plugins/webui/commands/client/utils.ts 为同一模式）。
 * 2. "throttle-debounce"：5.0.2 的包内不再附带类型声明（package.json 无
 *    types 字段、无 types 目录），按其 README 的 API 形态本地补齐。
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

declare module "throttle-debounce" {
	/** debounce 选项：atBegin 为 true 时改在延时窗口开头执行 */
	export interface DebounceSettings {
		atBegin?: boolean | undefined;
	}

	/** throttle 选项：可关掉尾部 / 头部调用，或切换为 debounce 行为 */
	export interface ThrottleSettings {
		noTrailing?: boolean | undefined;
		noLeading?: boolean | undefined;
		debounceMode?: boolean | undefined;
	}

	/**
	 * 生成防抖函数：延时窗口内多次调用只在窗口结束（或开头）执行一次。
	 * @param delay 延时毫秒数
	 * @param callback 防抖执行的回调
	 */
	export function debounce<A extends unknown[]>(
		delay: number,
		callback: (...args: A) => void,
		options?: DebounceSettings,
	): (...args: A) => void;

	/**
	 * 生成节流函数：以固定间隔最多执行一次。
	 * @param delay 节流间隔毫秒数
	 * @param callback 节流执行的回调
	 */
	export function throttle<A extends unknown[]>(
		delay: number,
		callback: (...args: A) => void,
		options?: ThrottleSettings,
	): (...args: A) => void;
}
