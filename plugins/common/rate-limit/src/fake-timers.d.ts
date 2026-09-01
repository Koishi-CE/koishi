// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @sinonjs/fake-timers 的局部类型声明。
 *
 * Bun 把该包解析到 src 入口（fake-timers-src.js），包内又未随 src 提供
 * 可被 nodenext 消费的声明文件，故按测试实际用到的 API 局部声明。
 */
declare module "@sinonjs/fake-timers" {
	export interface InstalledClock {
		/** 当前假时钟时间（毫秒） */
		now: number;
		/** 推进假时钟并触发其间到期的定时器 */
		tick(milliseconds: number): number;
		/** 卸载假时钟，恢复全局时间函数 */
		uninstall(): void;
	}

	export function install(options?: {
		now?: number;
		/** 限制接管的全局函数名单；缺省接管全部时间相关函数 */
		toFake?: string[];
	}): InstalledClock;
}
