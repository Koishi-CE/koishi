// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 配置页「卸载插件」的状态机纯函数层。
 *
 * 卸载 = 向 override 暂存区写入移除标记(空串,与依赖页「移除依赖」
 * 同一编解码协议)后走既有安装链;本模块只做可单测的状态推导与载荷
 * 构造,RPC 调用与组件状态在 version.vue。解码侧见
 * dependencies/dependency-helpers.ts 的 decodeOverrideEntry。
 */

import type { Dict } from "@koishi-ce/client";

/** 卸载按钮的展示形态。 */
export interface UninstallButtonState {
	/** cancel = 已暂存移除,点击撤销暂存;uninstall = 点击发起卸载 */
	mode: "cancel" | "uninstall";
	/** 危险样式(仅发起态为红色) */
	danger: boolean;
	/** 卸载执行中禁点 */
	disabled: boolean;
}

/** 卸载载荷:override 协议中空串即移除,node 侧据此删依赖声明。 */
export function buildUninstallPayload(
	name: string,
): Dict<string> {
	return { [name]: "" };
}

/** 向暂存区写入移除标记(依赖页的 pending 态即刻可见)。 */
export function stageRemoval(
	override: Dict<string>,
	name: string,
): void {
	override[name] = "";
}

/** 撤销暂存的移除标记(键本就不在时为无害空操作)。 */
export function cancelRemoval(
	override: Dict<string>,
	name: string,
): void {
	delete override[name];
}

/** 按钮形态:已暂存移除转「取消卸载」并退掉危险样式。 */
export function resolveButtonState(
	pendingRemove: boolean,
	uninstalling: boolean,
): UninstallButtonState {
	return {
		mode: pendingRemove ? "cancel" : "uninstall",
		danger: !pendingRemove,
		disabled: uninstalling,
	};
}
