// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Context 工厂槽位（断环用）。
 *
 * context/runtime.ts 的 Service.setup 需要值侧创建全新的 root Context；
 * 若直接值导入 context/index.ts 的 Context 类，会与该文件对 runtime.ts 的
 * re-export 形成模块环（上游单体 context.ts 无此问题，CE 拆分后才出现）。
 * 因此把"创建 Context"收敛为可注入的工厂槽：本模块是零依赖叶子，
 * runtime.ts 值导入本模块、仅类型导入 index.ts，index.ts 在 Context 类
 * 定义完成后注册工厂。任何 Koishi Service 子类实例化都发生在模块加载期
 * 之后，故注册时机恒早于首次调用。
 */
import type { Context } from "./index.ts";

export const contextFactory: { create: () => Context } = {
	create: () => {
		throw new Error(
			"context factory not registered — @koishi-ce/core 尚未加载",
		);
	},
};
