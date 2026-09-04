<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  虚拟列表组件（全局组件 virtual-list）：基于 el-scrollbar 长列表渲染。
  只渲染 Virtual 计算出的 [range.start, range.end) 区间，区间外用上下
  padding（wrapperStyle）撑出真实滚动高度；header / footer 为可选插槽，
  其尺寸同样纳入测量。支持贴底（pinned）、触顶 / 触底事件（threshold
  阈值）、滚动定位到指定 key（activeKey）与 keep-alive 激活时恢复位置。
-->
<template>
  <el-scrollbar ref="root" @scroll="onScroll" :max-height="maxHeight">
    <virtual-item v-if="$slots.header" @resize="virtual.saveSize('header', $event)">
      <div><slot name="header"></slot></div>
    </virtual-item>
    <component :is="tag" class="virtual-list-wrapper" :style="wrapperStyle">
      <virtual-item v-for="(item, index) in dataShown" :key="getKey(item)"
        @resize="virtual.saveSize(getKey(item), $event)">
        <slot v-bind="item" :index="index + range.start"></slot>
      </virtual-item>
    </component>
    <virtual-item v-if="$slots.footer" @resize="virtual.saveSize('footer', $event)">
      <div><slot name="footer"></slot></div>
    </virtual-item>
    <div ref="shepherd"></div>
  </el-scrollbar>
</template>

<script lang="ts" setup>
import type { ElScrollbar } from "element-plus";
import {
	computed,
	nextTick,
	onActivated,
	onMounted,
	type PropType,
	ref,
	watch,
} from "vue";
import VirtualItem from "./item";
import Virtual from "./virtual";

const emit = defineEmits([
	"item-click",
	"scroll",
	"top",
	"bottom",
	"update:activeKey",
]);

const props = defineProps({
	keyName: { type: String, default: "id" },
	data: { type: Array, required: true },
	count: { default: 50 },
	estimated: { default: 50 },
	tag: { default: "div" },
	pinned: Boolean,
	activeKey: { default: "" },
	threshold: { default: 0 },
	maxHeight: String,
	activate: {
		type: String as PropType<"top" | "bottom" | "current">,
		default: "bottom",
	},
});

// 实际渲染的数据切片（Virtual.range 决定的可视窗口）
const dataShown = computed(() =>
	props.data.slice(range.start, range.end),
);

const root = ref<typeof ElScrollbar>();

// 数据条数变化：贴底（pinned）或原本就在底部时回到底部，并同步 uid 与范围
watch(
	() => props.data.length,
	() => {
		const { scrollTop, clientHeight, scrollHeight } =
			root.value.wrapRef;
		if (
			!props.pinned ||
			Math.abs(scrollTop + clientHeight - scrollHeight) < 1
		) {
			nextTick(scrollToBottom);
		}
		virtual.updateUids(getUids());
		virtual.handleDataChange();
	},
);

// 外部设置 activeKey 时平滑滚动到对应项，随后清空避免重复触发
watch(
	() => props.activeKey,
	(value) => {
		if (!value) return;
		emit("update:activeKey", null);
		scrollToUid(value, true);
	},
);

// 列表末尾的「牧羊人」节点：始终渲染，用于探测真实底部位置
const shepherd = ref<HTMLElement>();

// 用前后占位 padding 撑出完整滚动高度（中段为真实渲染内容）
const wrapperStyle = computed(() => {
	const { padFront, padBehind } = range;
	return { padding: `${padFront}px 0px ${padBehind}px` };
});

// 核心计算模型：count 为可视条数，buffer 取其 1/3 作上下预渲染
const virtual = new Virtual({
	count: props.count,
	estimated: props.estimated,
	buffer: Math.floor(props.count / 3),
	uids: getUids(),
});

const range = virtual.range;

/** 全量数据的 uid 列表（Virtual 按它建立下标与尺寸的映射） */
function getUids() {
	return props.data.map(getKey);
}

/** 取单项的 key：keyName 支持点路径（如 "user.id"）逐层取值 */
function getKey(item: string) {
	const keys = props.keyName.split(".");
	return keys.reduce((obj, key) => obj[key], item);
}

// 初始定位：指定了 activeKey 则定位到该项，否则滚到底部
onMounted(() => {
	if (props.activeKey) {
		scrollToUid(props.activeKey);
	} else {
		scrollToBottom();
	}
});

/** 滚动到指定像素偏移；smooth 时带平滑动画 */
function scrollToOffset(offset: number, smooth = false) {
	if (smooth) {
		root.value.wrapRef.scrollTo({
			top: offset,
			behavior: "smooth",
		});
	} else {
		root.value.wrapRef.scrollTop = offset;
	}
}

// 把滚动位置设置到指定 uid 对应的项
function scrollToUid(uid: string, smooth = false) {
	scrollToOffset(virtual.getUidOffset(uid), smooth);
}

/** 滚动到底部；因虚拟渲染未必一次到位，需轮询重试直到真正贴底 */
function scrollToBottom() {
	if (shepherd.value) {
		const offset = shepherd.value.offsetTop;
		scrollToOffset(offset);

		// 检查是否真的滚到了底部：列表可能还没渲染并计算到
		// 最后一个范围，所以要在下一个事件循环里重试，直到真正贴底
		setTimeout(() => {
			const offset = Math.ceil(
				root.value.wrapRef.scrollTop,
			);
			const clientLength = Math.ceil(
				root.value.wrapRef.clientHeight,
			);
			const scrollLength = Math.ceil(
				root.value.wrapRef.scrollHeight,
			);
			if (offset + clientLength < scrollLength) {
				scrollToBottom();
			}
		}, 3);
	}
}

// 失活时的滚动位置，供 keep-alive 重新激活时恢复
let scrollTop = 0;

// keep-alive 激活时按 activate 策略定位：bottom 回到底部，current 回到原位
onActivated(() => {
	if (props.activate === "bottom") {
		scrollToBottom();
	} else if (props.activate === "current") {
		root.value.setScrollTop(scrollTop);
	}
});

function onScroll(ev: MouseEvent) {
	const offset = Math.ceil(
		(scrollTop = root.value.wrapRef.scrollTop),
	);
	const clientLength = Math.ceil(
		root.value.wrapRef.clientHeight,
	);
	const scrollLength = Math.ceil(
		root.value.wrapRef.scrollHeight,
	);

	// iOS 的回弹滚动会产出越界 offset，导致方向误判，直接忽略
	if (
		offset < 0 ||
		offset + clientLength > scrollLength + 1 ||
		!scrollLength
	) {
		return;
	}

	virtual.handleScroll(offset);
	emitEvent(offset, clientLength, scrollLength, ev);
}

/** 转发 scroll 事件，并在到达顶部 / 底部（含 threshold 阈值）时触发对应事件 */
function emitEvent(
	offset: number,
	clientLength: number,
	scrollLength: number,
	ev: MouseEvent,
) {
	emit("scroll", ev, virtual.range);
	if (
		virtual.direction < 0 &&
		props.data.length &&
		offset - props.threshold <= 0
	) {
		emit("top");
	} else if (
		virtual.direction > 0 &&
		offset + clientLength + props.threshold >= scrollLength
	) {
		emit("bottom");
	}
}
</script>
