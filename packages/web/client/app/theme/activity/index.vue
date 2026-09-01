<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  活动栏（最左侧图标栏）：分 top / bottom 两区渲染活动项，
  项与项之间的分隔槽（activity-separator）同时充当拖拽排序的落点。
  空间不足时放不下的活动项折叠进 "..." 溢出组；
  整条栏支持右键菜单（theme.activity，如"重置活动栏"）。
-->
<template>
  <nav
    class="layout-activity flex flex-col justify-evenly"
    @contextmenu.stop="trigger($event, null)">
    <template v-for="(data, index) in groups.top" :key="data[0].id">
      <activity-separator position="top" :index="index" />
      <activity-item placement="right" :children="data"></activity-item>
    </template>
    <activity-separator position="top" :index="groups.top.length" />
    <activity-item v-if="groups.hidden" placement="bottom" :children="groups.hidden"></activity-item>
    <div v-else class="spacer"></div>
    <activity-separator position="bottom" :index="groups.top.length" />
    <template v-for="(data, index) in groups.bottom" :key="data.id">
      <activity-item placement="right" :children="data"></activity-item>
      <activity-separator position="bottom" :index="index" />
    </template>
  </nav>
</template>

<script lang="ts" setup>
import {
	type Activity,
	useConfig,
	useContext,
	useMenu,
} from "@koishi-ce/client";
import { useWindowSize } from "@vueuse/core";
import { computed, provide } from "vue";
import ActivityItem from "./item.vue";
import ActivitySeparator from "./separator.vue";

const ctx = useContext();
const config = useConfig();
const trigger = useMenu("theme.activity");
const { height, width } = useWindowSize();

// 计算最终的活动栏分组：{ top, bottom, hidden（溢出折叠组，可能为空） }
const groups = computed(() => {
	let hidden: Activity[];
	// 单个活动项占位（与 CSS 中 --activity-width / --activity-padding 对应）
	const unit = width.value <= 768 ? 52 : 56;
	// 可用总高度：视口高度减去上下留白（窄屏 4px / 宽屏 8px）
	const total = height.value - (width.value <= 768 ? 4 : 8);
	// 初始分组表：每个未禁用页面各自成一组（值为 Activity 数组）
	const available = Object.fromEntries(
		Object.entries(ctx.$router.pages)
			.filter(([, data]) => !data.disabled())
			.map(([key, data]) => [key, [data]]),
	);
	// 应用用户的覆盖配置：hidden 的直接移除；声明 parent 的并入父项所在组
	for (const id of Object.keys(available)) {
		const override = config.value.activities?.[id];
		if (!override) continue;
		if (override.hidden) {
			delete available[id];
			continue;
		}
		Object.assign(available[id][0], override);
		const parent = available[override.parent];
		if (parent) {
			parent.push(available[id][0]);
			delete available[id];
		}
	}
	const list = Object.values(available).sort(([a], [b]) => a.order - b.order);
	// 放不下时：从头部取出溢出项折叠成一个组，top 位优先、同位再按 order 排，
	// 并以 "..." 图标作为该组的展示入口
	if (list.length * unit > total) {
		hidden = list
			.splice(0, list.length + 1 - Math.floor(total / unit))
			.sort(([a], [b]) => {
				const scale = a.position === "top" ? -1 : 1;
				if (a.position === b.position) {
					return scale * (a.order - b.order);
				}
				return scale;
			})
			.flat();
		hidden.unshift({ icon: "activity:ellipsis" } as Activity);
	}
	// top 区按 order 逆序输出（order 大者靠上），bottom 区保持正序
	const top = list.filter(([data]) => data.position !== "bottom").reverse();
	const bottom = list.filter(([data]) => data.position === "bottom");
	return { top, bottom, hidden };
});

// 供 separator 子组件注入，用于拖拽落点计算
provide("groups", groups);
</script>

<style lang="scss" scoped>

.marker {
  position: absolute;
}

.layout-activity {
  position: fixed;
  box-sizing: border-box;
  z-index: 100;
  top: 0;
  bottom: 0;
  width: var(--activity-width);
  background-color: var(--k-activity-bg);
  border-right: var(--k-activity-divider, var(--k-color-divider-dark)) 1px solid;
  transition: var(--color-transition);

  .spacer {
    flex: 1 0 auto;
  }
}

</style>
