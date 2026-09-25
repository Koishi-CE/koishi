// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

import type { ComputedRef, WatchSource } from "vue";
import { computed, reactive, watch } from "vue";

/**
 * 图片查看的共享变换状态：用户缩放 / 旋转量。由容器内查看器
 * （viewer.vue）与全屏查看器（overlay.vue）共用，是两套查看器此前
 * 各自重复实现的部分（审计 P1-11 的合流点）。
 */
export interface ImageTransformState {
	/** 缩放倍率（1 为原始大小） */
	scale: number;
	/** 旋转角度（度，正值为顺时针） */
	rotate: number;
}

/**
 * 变换控制器：状态 + 工具条按钮对应的操作方法。整体作为 props 传入
 * 共享工具条（toolbar.vue），按钮经方法驱动而非直接赋值——既避免
 * vue/no-mutating-props，也让「工具条能做什么」在类型上自描述。
 */
export interface ImageTransformController {
	state: ImageTransformState;
	/** 缩放增减（负值缩小），叠加在当前倍率上 */
	zoom(delta: number): void;
	/** 旋转增减（度，负值为逆时针） */
	rotateBy(delta: number): void;
	/** 复原：缩放与旋转归位 */
	resetTransform(): void;
}

/**
 * 创建图片变换控制器与合成 transform 串。
 * @param reset 自动复位触发源：触发即把缩放与旋转归位（换图 / 关闭
 *   查看器），仅监听变化、不关心新旧值
 */
export function useImageTransform(
	reset: WatchSource<unknown>,
): ImageTransformController & {
	transform: ComputedRef<string>;
} {
	const state = reactive<ImageTransformState>({
		scale: 1,
		rotate: 0,
	});

	const transform = computed(() => {
		return `scale(${state.scale}) rotate(${state.rotate}deg)`;
	});

	watch(reset, () => {
		state.scale = 1;
		state.rotate = 0;
	});

	return {
		state,
		transform,
		zoom: (delta) => {
			state.scale += delta;
		},
		rotateBy: (delta) => {
			state.rotate += delta;
		},
		resetTransform: () => {
			state.scale = 1;
			state.rotate = 0;
		},
	};
}
