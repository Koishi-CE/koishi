<template>
  <!-- 头部插槽:统计行 / 缓存提示 / 调试面板,绑定 all、packages 与 hasFilter -->
  <div v-if="$slots.header" ref="header" class="market-list-header">
    <slot name="header" v-bind="{ all, packages, hasFilter: hasFilter(modelValue) }"></slot>
  </div>
  <template v-if="packages.length">
    <!-- 列表体:只渲染可视窗口内的卡片,上下 spacer 撑起虚拟滚动高度 -->
    <div ref="list" :class="['package-list', { settled }]">
      <div v-if="topSpacer" class="virtual-spacer" :style="{ height: topSpacer + 'px' }"></div>
      <market-package
        v-for="data in renderedPackages"
        v-memo="[data.package.name, gravatar]"
        :key="data.package.name"
        class="k-card"
        :data="data"
        :gravatar="gravatar"
        @query="onQuery"
      >
        <template #action>
          <slot name="action" v-bind="data"></slot>
        </template>
      </market-package>
      <div v-if="bottomSpacer" class="virtual-spacer" :style="{ height: bottomSpacer + 'px' }"></div>
    </div>
    <!-- 触底加载:哨兵元素进入视口(预载 240px)或点击按钮加载下一批 -->
    <div v-if="hasMore" ref="sentinel" class="load-more">
      <el-button text @click="loadMore">{{ t('marketPage.list.loadMore') }}</el-button>
    </div>
    <!-- 加载完毕:无过滤条件时展示 Koishi 彩蛋文案,有过滤时显示命中计数 -->
    <div v-else :class="['load-complete', { 'market-end-easter': !hasFilter(modelValue) }]">
      <template v-if="!hasFilter(modelValue)">
        <k-icon name="koishi" class="market-end-easter__icon" aria-hidden="true"></k-icon>
        <span>{{ t('marketPage.easter.marketEnd') }}</span>
      </template>
      <template v-else>
        {{ t('marketPage.list.complete', { count: packages.length }) }}
      </template>
    </div>
  </template>
  <!-- 空态:过滤后没有任何命中 -->
  <k-empty v-else>
    {{ t('marketPage.list.empty') }}
  </k-empty>
</template>

<script lang="ts" setup>
/**
 * @file 市场卡片列表组件:过滤/排序管线 + 虚拟滚动 + 触底加载(market 域)。
 *
 * 模块职责:
 * - 对 props.data 跑前端过滤管线(getVisible → getFiltered →
 *  getSortedPrepared),结果写入 shallowRef(all/packages);
 * - 自实现虚拟滚动:按列数/行高计算可视窗口,窗口外用 spacer 占位,
 *  只渲染窗口内(含 overscan 4 行)的卡片;触底或点击"加载更多"时
 *  按 batchSize 扩大已加载数量;
 * - debug 模式下统计过滤/排序/虚拟化耗时,经 debug 事件上报给页面。
 *
 * 关键设计:
 * - 过滤在 requestAnimationFrame 里调度,连续输入只跑最后一帧;
 * - 布局测量(measureLayout)从 DOM 实测列数(卡片宽 336px)与行高,
 *  resize/滚动经 ResizeObserver + passive scroll 监听驱动虚拟窗口更新;
 * - settled 标记:数据更新后 700ms 无新变化才置 true,供 CSS 做入场动画。
 */

import type { SearchObject } from "@koishi-ce/registry";
import {
	computed,
	inject,
	nextTick,
	onMounted,
	onUnmounted,
	ref,
	shallowRef,
	watch,
} from "vue";
import { useMarketNextI18n } from "../../shared/i18n";
import {
	getFiltered,
	getSortedPrepared,
	getVisible,
	hasFilter,
	kConfig,
} from "../utils";
import MarketPackage from "./package.vue";

const props = defineProps<{
	/** 查询词表(过滤条件来源,变化时重置分页)。 */
	modelValue: string[];
	/** 全量(或已做可见性过滤的)市场数据。 */
	data: SearchObject[];
	/** gravatar 镜像配置,透传给卡片。 */
	gravatar?: string;
	/** 调试模式:输出耗时统计并透传给页面调试面板。 */
	debug?: boolean;
	/** data 已由父级做过 getVisible(跳过组件内的可见性过滤)。 */
	visibilityPrepared?: boolean;
}>();

const { t } = useMarketNextI18n();

const emit = defineEmits(["update:modelValue", "update:page", "debug"]);

const config = inject(kConfig, {});

/** 可见性过滤后的全量列表(调试统计里的 all/total)。 */
const all = shallowRef<SearchObject[]>([]);

/** 过滤 + 排序后的最终列表(虚拟滚动的数据源)。 */
const packages = shallowRef<SearchObject[]>([]);

/** 每批加载数:词表里 limit:N 可覆盖,默认 24。 */
const batchSize = computed(() => {
	for (const word of props.modelValue) {
		if (word.startsWith("limit:")) {
			const size = parseInt(word.slice(6));
			if (size) return size;
		}
	}
	return 24;
});

/** 头部插槽容器元素(参与布局测量)。 */
const header = ref<HTMLElement>();
/** 触底加载哨兵元素(IntersectionObserver 观察目标)。 */
const sentinel = ref<HTMLElement>();
/** 列表体元素。 */
const list = ref<HTMLElement>();
/** 已加载(允许渲染)的条数,随触底递增。 */
const visible = ref(batchSize.value);
/** 当前列数(按 336px 卡片宽实测)。 */
const columns = ref(1);
/** 单行高度(卡片高 + gap,实测兜底 202)。 */
const rowHeight = ref(224);
/** 虚拟窗口起始/结束索引(含 overscan)。 */
const startIndex = ref(0);
const endIndex = ref(batchSize.value);
/** 窗口外的上下占位高度(px)。 */
const topSpacer = ref(0);
const bottomSpacer = ref(0);
/** 触底哨兵的 IntersectionObserver。 */
let observer: IntersectionObserver;
/** 实际滚动的父容器(el-scrollbar 的 wrap 或 window)。 */
let scrollParent: HTMLElement | Window;
/** 列表/头部尺寸变化的观察器。 */
let resizeObserver: ResizeObserver;
let observedList: HTMLElement | undefined;
let observedHeader: HTMLElement | undefined;
/** 虚拟滚动更新的 rAF 句柄。 */
let frame = 0;
/** 尺寸测量的 rAF 句柄,合并同一批 ResizeObserver 通知。 */
let measureFrame = 0;
/** 过滤管线的 rAF 句柄。 */
let filterFrame = 0;
/** settled 延迟定时器句柄。 */
let settledTimer = 0;
/** 虚拟化调试日志的上次输出时间(限流 250ms)。 */
let lastVirtualDebugAt = 0;
/** 列表顶部相对滚动容器的偏移(虚拟窗口换算基准)。 */
let listTop = 0;
/** 调试统计的累积状态(过滤/排序/虚拟化各阶段耗时与计数)。 */
let debugState = {
	timings: {} as Record<string, number>,
	total: 0,
	matched: 0,
	visible: 0,
	rendered: 0,
};

/** 已加载条目:packages 截断到 visible。 */
const loadedPackages = computed(() => packages.value.slice(0, visible.value));

/** 实际渲染条目:已加载条目的虚拟窗口切片。 */
const renderedPackages = computed(() =>
	loadedPackages.value.slice(startIndex.value, endIndex.value),
);

/** 是否还有未加载的条目。 */
const hasMore = computed(() => visible.value < packages.value.length);

/** 布局是否已稳定(数据变更后 700ms 无新变化置 true,驱动入场动画)。 */
const settled = ref(false);

/** 重置 settled 定时器:每次 packages 变化后延迟置回 true。 */
function markSettled() {
	clearTimeout(settledTimer);
	settledTimer = window.setTimeout(() => {
		settled.value = true;
	}, 700);
}

watch(
	() => packages.value,
	() => {
		settled.value = false;
		markSettled();
	},
);

/** 哨兵元素/hasMore 变化后重新挂载 IntersectionObserver。 */
function updateObserver() {
	if (!observer || !sentinel.value) return;
	observer.disconnect();
	if (hasMore.value) observer.observe(sentinel.value);
}

/** 加载下一批:visible 增加一个 batchSize 并刷新虚拟窗口。 */
function loadMore() {
	if (!hasMore.value) return;
	visible.value = Math.min(
		visible.value + batchSize.value,
		packages.value.length,
	);
	nextTick(() => {
		updateObserver();
		updateVirtual();
	});
}

/** 重置分页与虚拟窗口;scroll=true 时通知父级回到第 1 页(滚回顶部)。 */
function resetVisible(scroll = true) {
	visible.value = batchSize.value;
	if (scroll) emit("update:page", 1);
	startIndex.value = 0;
	endIndex.value = batchSize.value;
	topSpacer.value = 0;
	bottomSpacer.value = 0;
	nextTick(() => {
		bindList();
		measureLayout();
		updateObserver();
		updateVirtual();
	});
}

// 过滤词变化:重置已加载数量与虚拟窗口
watch(
	() => props.modelValue.join("\n"),
	() => resetVisible(),
	{ deep: true },
);

// 数据或过滤词变化:rAF 内重跑过滤/排序管线
watch(
	() => [props.data, props.modelValue.join("\n")] as const,
	() => {
		schedulePackageUpdate();
	},
	{ immediate: true },
);

// 结果列表长度变化:把 visible 收敛到合法区间并重新测量布局
watch(
	() => packages.value.length,
	() => {
		visible.value = Math.min(
			Math.max(visible.value, batchSize.value),
			packages.value.length || batchSize.value,
		);
		nextTick(() => {
			bindList();
			measureLayout();
			updateObserver();
			updateVirtual();
		});
	},
);

onMounted(() => {
	// 哨兵进入视口前 240px 即预加载下一批
	observer = new IntersectionObserver(
		(entries) => {
			if (entries.some((entry) => entry.isIntersecting)) loadMore();
		},
		{ rootMargin: "240px 0px" },
	);
	resizeObserver = new ResizeObserver(() => {
		cancelAnimationFrame(measureFrame);
		measureFrame = requestAnimationFrame(() => {
			if (measureLayout()) scheduleVirtual();
		});
	});
	resetVisible(false);
});

onUnmounted(() => {
	observer?.disconnect();
	resizeObserver?.disconnect();
	removeScrollListener();
	cancelAnimationFrame(frame);
	cancelAnimationFrame(measureFrame);
	cancelAnimationFrame(filterFrame);
	clearTimeout(settledTimer);
});

/**
 * 过滤/排序管线(在 rAF 中执行,合并连续变更):
 * 可见性过滤(父级已做则跳过)→ 查询词过滤 → 排序,结果写入 all/packages;
 * debug 模式额外记录各阶段耗时并 emit。
 */
function schedulePackageUpdate() {
	cancelAnimationFrame(filterFrame);
	filterFrame = requestAnimationFrame(() => {
		const start = props.debug ? performance.now() : 0;
		const visible = props.visibilityPrepared
			? props.data
			: getVisible(props.data, props.modelValue);
		const filtered = getFiltered(visible, props.modelValue, config);
		const sortedAt = props.debug ? performance.now() : 0;
		all.value = visible;
		packages.value = getSortedPrepared(filtered, props.modelValue, config);
		if (props.debug) {
			emitDebug({
				timings: {
					frontendFilter: sortedAt - start,
					frontendSort: performance.now() - sortedAt,
				},
				total: visible.length,
				matched: packages.value.length,
			});
		}
	});
}

/** 找到实际滚动的父容器:el-scrollbar 内部的 wrap 元素,否则 window。 */
function getScrollParent() {
	return (
		(list.value
			?.closest(".el-scrollbar")
			?.querySelector(".el-scrollbar__wrap") as HTMLElement) || window
	);
}

/** (重新)绑定列表与头部的 resize/scroll 监听(元素或滚动容器变化时)。 */
function bindList() {
	if (!list.value) return;
	if (observedList === list.value && scrollParent) return;
	removeScrollListener();
	if (observedList) resizeObserver?.unobserve(observedList);
	if (observedHeader) resizeObserver?.unobserve(observedHeader);
	observedList = list.value;
	observedHeader = header.value;
	scrollParent = getScrollParent();
	resizeObserver?.observe(observedList);
	if (observedHeader) resizeObserver?.observe(observedHeader);
	addScrollListener();
}

/** 挂 passive 滚动监听(触发虚拟窗口更新)。 */
function addScrollListener() {
	scrollParent?.addEventListener("scroll", scheduleVirtual, { passive: true });
}

/** 解绑滚动监听(容器可能已更换)。 */
function removeScrollListener() {
	scrollParent?.removeEventListener("scroll", scheduleVirtual);
}

/** 实测布局参数:列数(卡片宽 336 + gap)、行高(首卡高 + gap)、列表顶部偏移。 */
function measureLayout() {
	if (!list.value) return false;
	const style = getComputedStyle(list.value);
	const gap = parseFloat(style.columnGap) || parseFloat(style.gap) || 16;
	const width = list.value.clientWidth;
	const nextColumns = Math.max(1, Math.floor((width + gap) / (336 + gap)));
	const card = list.value.querySelector<HTMLElement>(".market-package");
	const nextRowHeight = (card?.offsetHeight || 202) + gap;
	const nextListTop = getListTop();
	const changed =
		columns.value !== nextColumns ||
		rowHeight.value !== nextRowHeight ||
		listTop !== nextListTop;
	if (columns.value !== nextColumns) columns.value = nextColumns;
	if (rowHeight.value !== nextRowHeight) rowHeight.value = nextRowHeight;
	if (listTop !== nextListTop) listTop = nextListTop;
	return changed;
}

/** 列表顶相对滚动容器的绝对偏移(窗口起点换算用)。 */
function getListTop() {
	if (!list.value || !scrollParent) return 0;
	const listRect = list.value.getBoundingClientRect();
	if (scrollParent instanceof Window) return listRect.top + window.scrollY;
	const scrollRect = scrollParent.getBoundingClientRect();
	return listRect.top - scrollRect.top + scrollParent.scrollTop;
}

/** rAF 合并滚动/resize 引发的虚拟窗口更新。 */
function scheduleVirtual() {
	cancelAnimationFrame(frame);
	frame = requestAnimationFrame(updateVirtual);
}

/**
 * 虚拟滚动核心:由滚动偏移算出可视行区间(上下各 overscan 4 行),
 * 写入渲染索引与 spacer 高度;接近底部(不足 4 行)时顺带预加载下一批。
 */
function updateVirtual() {
	if (!list.value) return;
	const start = props.debug ? performance.now() : 0;

	const scrollTop =
		scrollParent instanceof Window ? window.scrollY : scrollParent.scrollTop;
	const viewportHeight =
		scrollParent instanceof Window
			? window.innerHeight
			: scrollParent.clientHeight;
	const offset = Math.max(0, scrollTop - listTop);
	const totalRows = Math.ceil(loadedPackages.value.length / columns.value);
	const overscan = 4;
	const startRow = Math.max(0, Math.floor(offset / rowHeight.value) - overscan);
	const visibleRows =
		Math.ceil(viewportHeight / rowHeight.value) + overscan * 2;
	const endRow = Math.min(totalRows, startRow + visibleRows);

	const nextStartIndex = startRow * columns.value;
	const nextEndIndex = Math.min(
		loadedPackages.value.length,
		endRow * columns.value,
	);
	const nextTopSpacer = startRow * rowHeight.value;
	const nextBottomSpacer = Math.max(0, (totalRows - endRow) * rowHeight.value);
	if (startIndex.value !== nextStartIndex) startIndex.value = nextStartIndex;
	if (endIndex.value !== nextEndIndex) endIndex.value = nextEndIndex;
	if (topSpacer.value !== nextTopSpacer) topSpacer.value = nextTopSpacer;
	if (bottomSpacer.value !== nextBottomSpacer)
		bottomSpacer.value = nextBottomSpacer;

	// 距底部不足 4 行时预加载,避免滚到尽头才触发
	const loadedHeight = listTop + totalRows * rowHeight.value;
	if (
		hasMore.value &&
		scrollTop + viewportHeight > loadedHeight - rowHeight.value * 4
	) {
		loadMore();
	}
	if (props.debug) {
		const now = performance.now();
		if (now - lastVirtualDebugAt < 250) return;
		lastVirtualDebugAt = now;
		emitDebug({
			timings: {
				frontendVirtual: now - start,
			},
			visible: loadedPackages.value.length,
			rendered: renderedPackages.value.length,
		});
	}
}

/** 合并增量后 emit 调试统计(新值覆盖旧值,timings 浅合并)。 */
function emitDebug(value: Partial<typeof debugState>) {
	debugState = {
		...debugState,
		...value,
		timings: {
			...debugState.timings,
			...value.timings,
		},
	};
	emit("debug", debugState);
}

/** 卡片请求追加查询词(点徽章/头像等):去重后追加到词表末尾。 */
function onQuery(word: string) {
	const words = props.modelValue.slice();
	if (!words[words.length - 1]) words.pop();
	if (!words.includes(word)) words.push(word);
	words.push("");
	emit("update:modelValue", words);
}
</script>

<style lang="scss" scoped src="./list.scss"></style>
