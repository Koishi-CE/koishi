<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  活动栏条目：children[0] 为组的主图标，其余为并入该组的子活动，
  悬停 tooltip 中列出组内成员。条目本身也是拖拽落点——
  把另一个活动拖到本条目上即并入（或互换）分组。
-->
<template>
  <div
    class="activity-item"
    :class="{ 'active': isActive, 'drag-over': hasDragOver }"
    @contextmenu.stop="trigger($event, children[0])"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    @dragover.prevent>
    <el-tooltip placement="right" :popper-class="`activity-item-tooltip`">
      <template #content>
        <div class="activity-info">
          <div class="title">{{ children[hoverIndex].name }}</div>
          <div class="desc" v-if="children[hoverIndex].desc">{{ children[hoverIndex].desc }}</div>
        </div>
        <div class="activity-group" v-if="children.length > 1">
          <div class="activity-group-item" v-for="(child, index) in children.slice(1)" :key="child.id">
            <activity-button
              :data="child"
              @mouseenter="hoverIndex = index + 1"
              @mouseleave="hoverIndex = 0"
            ></activity-button>
          </div>
        </div>
      </template>
      <activity-button :data="children[0]" :class="{ 'is-group': children.length > 1 }"></activity-button>
    </el-tooltip>
  </div>
</template>

<script lang="ts" setup>
import { type Activity, useConfig, useMenu } from "@koishi-ce/client";
import type { Placement } from "element-plus";
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import ActivityButton from "./button.vue";

const route = useRoute();

const props = defineProps<{
	children: Activity[];
	placement: Placement;
}>();

const isActive = computed(() => {
	// 组内任一成员命中当前路由即整组高亮
	return Object.values(props.children).some(
		(child) => route.meta?.activity?.id === child.id,
	);
});

const hasDragOver = ref(false);

const trigger = useMenu("theme.activity");

// tooltip 中当前悬停的成员下标（0 为主图标，其余对应组内子活动）
const hoverIndex = ref(0);

watch(
	() => props.children,
	() => {
		hoverIndex.value = 0;
	},
);

function handleDragEnter(event: DragEvent) {
	hasDragOver.value = true;
}

function handleDragLeave(event: DragEvent) {
	hasDragOver.value = false;
}

const config = useConfig();

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
	// 只响应活动栏自身的拖拽协议，忽略外部拖入内容
	if (!text.startsWith("activity:")) return;
	const id = text.slice(9);
	const target = props.children[0].id;
	// 拖到自身所在组上无需处理
	if (target === id) return;
	event.preventDefault();

	const override = ensureOverride(id);
	if (override.parent === target) {
		// 原本 id 已是 target 的子项：视为"拖出"，反转父子关系，
		// 并让原父项（及其它子项）改挂到新的父项 id 之下
		delete override.parent;
		ensureOverride(target).parent = id;
		for (const key in config.value.activities) {
			// 跳过原型链保留键：JSON 配置可携带自有 "__proto__" 属性，
			// 普通对象对其 [] 读取会命中原型链存取器
			if (UNSAFE_KEYS.has(key)) continue;
			const override = config.value.activities[key];
			if (override?.parent === target) {
				override.parent = id;
			}
		}
	} else {
		// 常规情形：把拖入项并到 target 组
		override.parent = target;
	}
}
</script>

<style lang="scss">

.activity-item {
  position: relative;
  box-sizing: border-box;
  width: var(--activity-width);
  padding: 0 var(--activity-padding);

  .layout-activity &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    width: var(--activity-marker-width);
    height: var(--activity-marker-height);
    transform: translateX(-100%) translateY(-50%);
    display: block;
    border-radius: 0 var(--activity-marker-width) var(--activity-marker-width) 0;
    background-color: var(--k-text-active);
    transition: all 0.3s ease;
  }

  .layout-activity &.active::before,
  .layout-activity &.drag-over::before {
    transform: translateY(-50%);
  }
}

.activity-item-tooltip {
  padding: 0;

  .activity-info {
    padding: 6px 11px;
    line-height: 1.6;

    .title {
      font-size: 13px;
      font-weight: 500;
    }

    .desc {
      font-size: 12px;
    }
  }

  .activity-group {
    display: flex;
    padding: var(--activity-padding);
    gap: 0 var(--activity-padding);
    border-top: 1px solid var(--k-color-divider);

    .activity-group-item {
      width: calc(var(--activity-width) - 2 * var(--activity-padding));
    }
  }
}

</style>
