<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  活动栏条目间的分隔槽：平时不可见，拖拽悬停时显示横线提示，
  松手即把被拖项移动到该位置（拖拽排序的核心落点组件）。
-->
<template>
  <div
    class="separator"
    :class="{ 'drag-over': hasDragOver }"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    @dragover.prevent
  ></div>
</template>

<script lang="ts" setup>
import {
	type Activity,
	useConfig,
	useContext,
} from "@koishi-ce/client";
import { type ComputedRef, inject } from "vue";
import {
	createOverrideAccessor,
	parseActivityDrag,
	UNSAFE_KEYS,
	useDragOver,
} from "./utils";

type Position = "top" | "bottom";

const props = defineProps<{
	index: number;
	position: Position;
}>();

const groups = inject("groups") as ComputedRef<
	Record<Position, Activity[][]>
>;

const { hasDragOver, handleDragEnter, handleDragLeave } =
	useDragOver();

const config = useConfig();
const ctx = useContext();
const ensureOverride = createOverrideAccessor(config);

function handleDrop(event: DragEvent) {
	hasDragOver.value = false;
	const id = parseActivityDrag(event);
	if (id === undefined) return;
	// 每组按约定必有首个成员；filter 仅收窄类型（空组在运行时不存在）
	const list = groups.value[props.position]
		.map(([item]) => item)
		.filter((item): item is Activity => item !== undefined);
	const oldIndex = list.findIndex((item) => item.id === id);
	// 落点即原位（含紧邻原位的前一格）时无需移动
	if (
		oldIndex === props.index ||
		(oldIndex === props.index - 1 && oldIndex !== -1)
	)
		return;
	event.preventDefault();

	// 拖拽协议携带的 id 必为已注册页面；缺页时放弃本次落点处理
	const item = ctx.$router.pages[id];
	if (!item) return;

	// 先在副本上完成移动，得到目标排列，再据此反推各项的 order 覆盖值
	let index = props.index;
	if (oldIndex < 0) {
		list.splice(index, 0, item);
	} else {
		// 原位置在落点之前时，移除自身会使落点前移一格，需补偿
		if (oldIndex < index) index--;
		list.splice(oldIndex, 1);
		list.splice(index, 0, item);
	}

	const override = ensureOverride(id);
	// 拖拽落在条目之间意味着脱离原分组，清除父项；
	// 位置（top / bottom）与注册默认不同才记录覆盖，相同则删掉以保持配置干净
	delete override.parent;
	if (item.options.position !== props.position) {
		override.position = props.position;
	} else {
		delete override.position;
	}

	// 左右最近的"未改序"条目（order 仍等于注册默认值）作为锚点，
	// 介于两锚点之间的项按线性插值重算 order；
	// 只有一侧锚点时按步长 100 单向递增 / 递减；两侧都没有则恢复默认
	// （lib 目标不含 findLastIndex，此处以反向遍历等价实现）
	let anchorL = -1;
	for (let i = index - 1; i >= 0; i--) {
		const anchor = list[i];
		if (anchor && anchor.order === anchor.options.order) {
			anchorL = i;
			break;
		}
	}
	const anchorR = list.findIndex(
		(item, i) =>
			i > index && item.order === item.options.order,
	);
	if (anchorL === -1) {
		if (anchorR === -1) {
			delete override.order;
		} else {
			// 锚点由 findIndex 得到，必为有效索引；判空仅通过空安全检查；
			// order 在 Activity 构造时已兜底为 0，?? 0 与运行时实际值一致
			const anchorItem = list[anchorR];
			if (anchorItem) {
				let order = anchorItem.options.order ?? 0;
				for (let index = anchorR - 1; index >= 0; index--) {
					const entry = list[index];
					if (!entry) continue;
					ensureOverride(entry.id).order = order += 100;
				}
			}
		}
	} else {
		if (anchorR === -1) {
			const anchorItem = list[anchorL];
			if (anchorItem) {
				let order = anchorItem.options.order ?? 0;
				for (
					let index = anchorL + 1;
					index < list.length;
					index++
				) {
					const entry = list[index];
					if (!entry) continue;
					ensureOverride(entry.id).order = order -= 100;
				}
			}
		} else {
			const anchorLeft = list[anchorL];
			const anchorRight = list[anchorR];
			if (anchorLeft && anchorRight) {
				// order 在 Activity 构造时已兜底为 0，?? 0 与运行时实际值一致
				let orderL = anchorLeft.options.order ?? 0;
				let orderR = anchorRight.options.order ?? 0;
				for (
					let index = anchorL + 1;
					index < anchorR;
					index++
				) {
					const entry = list[index];
					if (!entry) continue;
					ensureOverride(entry.id).order =
						orderL +
						((orderR - orderL) * (index - anchorL)) /
							(anchorR - anchorL);
				}
			}
		}
	}

	// 覆盖配置为空对象时删除该键，避免残留无意义的配置项
	// （activities 已由上方 ensureOverride 惰性创建，可选链仅通过空安全检查）
	if (
		!Object.keys(override).length &&
		!UNSAFE_KEYS.has(id)
	) {
		delete config.value.activities?.[id];
	}
}
</script>

<style lang="scss" scoped>

.separator {
  position: relative;
  height: var(--activity-padding);

  &::before {
    position: absolute;
    content: '';
    top: 50%;
    left: var(--activity-padding);
    right: var(--activity-padding);
    height: 2px;
    border-radius: 2px;
    transform: translateY(-50%);
    transition: var(--color-transition);
    background-color: transparent;
  }

  &.drag-over::before {
    background-color: var(--k-text-active);
  }
}

</style>
