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
import { type Activity, useConfig, useContext } from "@koishi-ce/client";
import { type ComputedRef, inject, ref } from "vue";

type Position = "top" | "bottom";

const props = defineProps<{
	index: number;
	position: Position;
}>();

const groups = inject("groups") as ComputedRef<Record<Position, Activity[][]>>;

const hasDragOver = ref(false);

function handleDragEnter(event: DragEvent) {
	hasDragOver.value = true;
}

function handleDragLeave(event: DragEvent) {
	hasDragOver.value = false;
}

const config = useConfig();
const ctx = useContext();

// 原型链保留键：这类键在普通对象上会触发原型链存取器，禁止作为配置键读写
// （id 来自拖拽事件的 dataTransfer 文本，属外部输入）
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** 取某活动的覆盖配置（不存在则创建）；保留键返回一次性空对象，防原型污染。
 * 守卫须用显式字符串比较（Set.has 形式 CodeQL 无法识别为阻断） */
function ensureOverride(id: string): Record<string, unknown> {
	const activities = (config.value.activities ??= {});
	if (id === "__proto__" || id === "constructor" || id === "prototype") {
		return {};
	}
	return (activities[id] ??= {});
}

function handleDrop(event: DragEvent) {
	hasDragOver.value = false;
	const text = event.dataTransfer.getData("text/plain");
	// 只响应活动栏自身的拖拽协议
	if (!text.startsWith("activity:")) return;
	const id = text.slice(9);
	const list = groups.value[props.position].map(([item]) => item);
	const oldIndex = list.findIndex((item) => item.id === id);
	// 落点即原位（含紧邻原位的前一格）时无需移动
	if (
		oldIndex === props.index ||
		(oldIndex === props.index - 1 && oldIndex !== -1)
	)
		return;
	event.preventDefault();

	// 先在副本上完成移动，得到目标排列，再据此反推各项的 order 覆盖值
	let index = props.index;
	const item = ctx.$router.pages[id];
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
	const anchorL = list.findLastIndex(
		(item, i) => i < index && item.order === item.options.order,
	);
	const anchorR = list.findIndex(
		(item, i) => i > index && item.order === item.options.order,
	);
	if (anchorL === -1) {
		if (anchorR === -1) {
			delete override.order;
		} else {
			let order = list[anchorR].options.order;
			for (let index = anchorR - 1; index >= 0; index--) {
				const override = ensureOverride(list[index].id);
				override.order = order += 100;
			}
		}
	} else {
		if (anchorR === -1) {
			let order = list[anchorL].options.order;
			for (let index = anchorL + 1; index < list.length; index++) {
				const override = ensureOverride(list[index].id);
				override.order = order -= 100;
			}
		} else {
			let orderL = list[anchorL].options.order;
			let orderR = list[anchorR].options.order;
			for (let index = anchorL + 1; index < anchorR; index++) {
				const override = ensureOverride(list[index].id);
				override.order =
					orderL +
					((orderR - orderL) * (index - anchorL)) / (anchorR - anchorL);
			}
		}
	}

	// 覆盖配置为空对象时删除该键，避免残留无意义的配置项
	if (!Object.keys(override).length && !UNSAFE_KEYS.has(id)) {
		delete config.value.activities[id];
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
