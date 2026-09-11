// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 活动栏（activity bar）相关的类型扩充与拖拽共用工具：
 * - 为 ActionContext 补充 "theme.activity" 菜单的求值上下文类型；
 * - 为控制台 Config 声明 activities 覆盖配置（隐藏 / 归组 / 排序 / 上下位置）；
 * - item.vue（条目 / 归组落点）与 separator.vue（排序落点）共享的
 *   覆盖配置访问与拖拽状态处理。
 */

import type {
	Activity,
	Config,
	Dict,
} from "@koishi-ce/client";
import { type Ref, ref } from "vue";

declare module "@koishi-ce/client" {
	interface ActionContext {
		"theme.activity": Activity;
	}

	interface Config {
		// 运行时的默认配置(initial fallback)并不包含该字段,
		// 故声明为可选(exactOptionalPropertyTypes 下不显式赋 undefined)
		activities?: Dict<ActivityOverride>;
	}
}

// 单个活动项的覆盖配置：不声明的字段沿用页面注册时的默认值
export interface ActivityOverride {
	hidden?: boolean;
	parent?: string;
	order?: number;
	position?: "top" | "bottom";
}

// 原型链保留键：这类键在普通对象上会触发原型链存取器，禁止作为配置键读写
// （id 来自拖拽事件的 dataTransfer 文本，属外部输入）
export const UNSAFE_KEYS = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);

/**
 * 创建覆盖配置访问器：取某活动的覆盖配置（不存在则创建）；保留键返回
 * 一次性空对象，防原型污染。守卫须用显式字符串比较（Set.has 形式
 * CodeQL 无法识别为阻断）。
 */
export function createOverrideAccessor(
	config: Ref<Config>,
): (id: string) => ActivityOverride {
	return (id) => {
		const activities = (config.value.activities ??= {});
		if (
			id === "__proto__" ||
			id === "constructor" ||
			id === "prototype"
		) {
			return {};
		}
		return (activities[id] ??= {});
	};
}

/** 活动栏拖拽协议前缀（dataTransfer 文本形态为 `activity:<id>`） */
const DRAG_PREFIX = "activity:";

/** 解析拖拽事件携带的活动 id；非本协议的拖入内容返回 undefined。 */
export function parseActivityDrag(
	event: DragEvent,
): string | undefined {
	// 合成事件的 dataTransfer 可能为 null（真实拖拽事件恒有值），视为非本协议
	if (!event.dataTransfer) return undefined;
	const text = event.dataTransfer.getData("text/plain");
	if (!text.startsWith(DRAG_PREFIX)) return undefined;
	return text.slice(DRAG_PREFIX.length);
}

/** 拖拽悬停状态：dragenter 置位、dragleave / drop 复位，驱动落点高亮 */
export function useDragOver() {
	const hasDragOver = ref(false);
	return {
		hasDragOver,
		handleDragEnter: () => {
			hasDragOver.value = true;
		},
		handleDragLeave: () => {
			hasDragOver.value = false;
		},
	};
}
