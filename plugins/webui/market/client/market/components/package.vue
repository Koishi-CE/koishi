<template>
  <!-- 卡片整体:整卡链接到项目主页 -->
  <a :class="['market-package flex flex-col gap-3', 'cat-' + resolveCategory(data.category), { 'bundle-card': bundlePackage }]" target="_blank" :href="homepage">
    <!-- 头部:类目图标 + 短名与徽章 + 活跃度心跳 + 右侧操作按钮插槽 -->
    <div class="header flex flex-row gap-4">
      <div :class="['left', 'shrink-0', 'flex', 'flex-row', 'justify-center', 'items-center', 'cat-' + resolveCategory(data.category)]">
        <market-icon :name="'outline:' + resolveCategory(data.category)"></market-icon>
      </div>
      <div class="main flex flex-col justify-around overflow-hidden">
        <h2 class="top">
          <span class="title truncate" :title="data.shortname">{{ data.shortname }}</span>
          <span
            v-if="badge"
            :class="['icon', badge.type]"
            :title="t(`badge.${badge.type}`)"
            @click.stop.prevent="$emit('query', badge.query)"
          >
            <market-icon :name="badge.icon || badge.type"></market-icon>
          </span>
        </h2>
        <div class="bottom">
          <span class="updated-meta" :style="updatedMetaStyle">
            <market-icon name="heart-pulse"></market-icon>{{ updatedAgo(data.updatedAt) }}
          </span>
        </div>
      </div>
      <div class="text-right grow-1 shrink-0">
        <slot name="action"></slot>
      </div>
    </div>
    <!-- 描述:含 markdown 语法的走 k-markdown(与原版一致),纯文本保持插值零成本 -->
    <k-markdown v-if="descriptionIsMarkdown" inline class="desc" :source="descriptionText"></k-markdown>
    <div v-else class="desc" :title="descriptionText">{{ descriptionText }}</div>
    <!-- 底部:版本/体积/下载量(或 license 兜底)与作者头像组 -->
    <div class="footer">
      <a class="truncate" target="_blank" :href="data.package.links.npm" :title="timeAgo(data.updatedAt)">
        <market-icon name="tag"></market-icon>{{ data.package.version }}
      </a>
      <template v-if="data.installSize">
        <span class="spacer"></span>
        <a class="truncate" target="_blank" :href="data.package.links.size">
          <market-icon name="file-archive"></market-icon>{{ formatSize(data.installSize) }}
        </a>
      </template>
      <template v-if="data.downloads">
        <span class="spacer"></span>
        <span class="truncate">
          <market-icon name="download"></market-icon>{{ data.downloads.lastMonth }}
        </span>
      </template>
      <!-- 体积与下载量都缺失时退化为展示 license -->
      <template v-if="!data.installSize && !data.downloads">
        <span class="spacer"></span>
        <span class="truncate">
          <market-icon name="balance"></market-icon>{{ data.license }}
        </span>
      </template>
      <span class="long-spacer"></span>
      <!-- 作者头像:点击带邮箱的头像可追加 email: 查询词 -->
      <div class="avatars">
        <span
          v-for="view in avatarViews"
          :key="view.key"
          class="avatar"
          :class="{ placeholder: !view.src }"
          :data-initial="view.initial"
          :title="view.label"
          @click.stop.prevent="view.user.email && $emit('query', 'email:' + view.user.email)"
        >
          <img
            v-if="view.src"
            :key="view.src"
            :src="view.src"
            loading="lazy"
            decoding="async"
            @error="handleAvatarRenderError(view)"
            @load="handleAvatarRenderLoad(view)"
          >
        </span>
      </div>
    </div>
  </a>
</template>

<script lang="ts" setup>
/**
 * @file 单个市场条目卡片组件(market 域)。
 *
 * 模块职责:渲染一张插件卡片——类目图标、短名、徽章、活跃度"心跳"
 * 指示(按更新时间新鲜度渐变)、版本/体积/下载量、作者头像组;点击
 * 徽章/头像向父级发出 query 事件追加查询词。
 *
 * 性能约定:卡片在虚拟滚动窗口内高频挂载/卸载,描述先经 looksLikeMarkdown
 * 廉价检测——纯文本走插值、仅含语法的描述才挂 k-markdown(marked 解析
 * + xss 净化,是描述渲染的必要成本而非可砍项);提示用原生 title 属性,
 * 禁止引入 el-tooltip/popper 等重组件。
 *
 * 关键设计:
 * - 头像多源回退:src 直接绑候选 URL,浏览器 <img> onerror 时记失败、
 *  切下一候选(avatar.ts 的失败缓存),onload 时再让服务端缓存一份;
 * - 空闲水合:无 src 的头像在 requestIdleCallback 里查服务端缓存,
 *  避免首屏渲染发大量请求;
 * - 时间显示以服务端时钟(store.market.serverNow)为基准,避免客户端
 *  时钟偏差导致"刚刚/几天前"错乱。
 */

import { computed, inject, onUnmounted, ref, watch } from "vue";
import { SearchObject } from "@koishi-ce/registry";
import { useI18nText } from "@koishi-ce/client";
import { store } from "@koishi-ce/client";
import {
	badges,
	cacheAvatarFailure,
	fetchAndCacheAvatar,
	fetchCachedAvatar,
	getCachedAvatarFromCandidates,
	getUserAvatarCandidates,
	getUserKey,
	getUsers,
	isAvatarFailureCached,
	isBundleSearchObject,
	resolveCategory,
	useMarketI18n,
	validate,
} from "../utils";
import { kConfig } from "../utils";
import { looksLikeMarkdown } from "../inline-markdown";
import MarketIcon from "../icons";

defineEmits(["query"]);

const props = defineProps<{
	/** 该卡片对应的市场条目。 */
	data: SearchObject;
	/** gravatar 镜像配置(透传给头像候选生成)。 */
	gravatar?: string;
}>();

const config = inject(kConfig, {});
/** 已水合的头像:user key → data: URI。 */
const avatars = ref<Record<string, string>>({});
/** 各头像已失败的候选游标(下次取候选从这里开始)。 */
const avatarCursor = ref<Record<string, number>>({});
/** 进行中的头像任务去重表。 */
const avatarTasks = new Map<string, Promise<void>>();
/** 空闲水合任务句柄(idle callback 或 setTimeout)。 */
let avatarHydrationTask = 0;

/** manifest 描述的 i18n 文本翻译器。 */
const tt = useI18nText();

/** 描述文案(i18n 翻译后的最终文本)。 */
const descriptionText = computed(
	() => tt(props.data.manifest?.description) ?? "",
);

/** 描述是否含 markdown 语法特征:决定走 k-markdown 还是纯文本插值。 */
const descriptionIsMarkdown = computed(() =>
	looksLikeMarkdown(descriptionText.value),
);

/** 整卡跳转地址:homepage 优先,否则用 repository(去掉 git+ 前缀与 .git 后缀)。 */
const homepage = computed(() => {
	const { homepage, repository } = props.data.package.links;
	if (homepage) return homepage;
	if (repository) return repository.replace(/^git\+/, "").replace(/\.git$/, "");
});

/** 标题旁的徽章:合包优先;否则取第一个命中查询条件且未隐藏的徽章。 */
const badge = computed(() => {
	if (bundlePackage.value) {
		return {
			type: "bundle",
			query: "is:bundle",
			negate: "not:bundle",
			icon: "file-archive",
		};
	}
	for (const type in badges) {
		if (badges[type].hidden?.(config, "card")) continue;
		if (validate(props.data, badges[type].query))
			return { type, ...badges[type] };
	}
});

/** 该条目是否为合包(koishi.bundle 清单存在)。 */
const bundlePackage = computed(() => isBundleSearchObject(props.data));

type MarketUser = ReturnType<typeof getUsers>[number];

/** 单个作者头像的渲染视图(候选链 + 当前选中候选 + 缓存状态)。 */
interface AvatarView {
	key: string;
	user: MarketUser;
	label: string;
	initial: string;
	src: string;
	candidates: ReturnType<typeof getUserAvatarCandidates>;
	signature: string;
	candidate?: ReturnType<typeof getUserAvatarCandidates>[number];
	cached: boolean;
}

/** 全部作者的头像视图:按需选择缓存命中或第一个未失败候选。 */
const avatarViews = computed<AvatarView[]>(() => {
	return getUsers(props.data).map((user, index) => {
		const candidates = getUserAvatarCandidates(user, props.gravatar);
		const key = getAvatarIdentity(user, candidates, index);
		const cached =
			avatars.value[key] || getCachedAvatarFromCandidates(candidates);
		const candidate = cached ? undefined : getAvatarSource(key, candidates);
		return {
			key,
			user,
			label: user.name || user.username || user.email || key,
			initial: getAvatarInitial(user),
			src: cached || candidate?.url || "",
			candidates,
			signature: getAvatarSignature(candidates),
			candidate,
			cached: !!cached,
		};
	});
});

/** 头像的稳定标识:用户 key 优先,退化为首个候选的缓存 key 或包名+序号。 */
function getAvatarIdentity(
	user: MarketUser,
	candidates: ReturnType<typeof getUserAvatarCandidates>,
	index: number,
) {
	return (
		getUserKey(user) ||
		candidates[0]?.cacheKey ||
		`${props.data.package.name}:${index}`
	);
}

/** 候选链签名:用户/gravatar 配置变化导致候选变化时触发重新水合。 */
function getAvatarSignature(
	candidates: ReturnType<typeof getUserAvatarCandidates>,
) {
	return candidates
		.map(
			(candidate) =>
				`${candidate.cacheKey}\n${candidate.source}\n${candidate.url}`,
		)
		.join("\n---\n");
}

/** 无图头像的占位首字母。 */
function getAvatarInitial(user: MarketUser) {
	return (
		(user.name || user.username || user.email || "?")
			.trim()
			.slice(0, 1)
			.toUpperCase() || "?"
	);
}

/** 从游标处起取第一个未处于失败冷却期的候选;全部失败返回 undefined。 */
function getAvatarSource(
	key: string,
	candidates: ReturnType<typeof getUserAvatarCandidates>,
) {
	if (!candidates.length) return;
	const start = Math.max(0, avatarCursor.value[key] || 0);
	for (let index = start; index < candidates.length; index++) {
		const candidate = candidates[index];
		if (!isAvatarSourceFailed(candidate)) return candidate;
	}
	return;
}

/** 候选是否处于失败冷却期。 */
function isAvatarSourceFailed(
	candidate: ReturnType<typeof getUserAvatarCandidates>[number],
) {
	return isAvatarFailureCached(getAvatarSourceKey(candidate));
}

/** 失败缓存的粒度是"缓存 key + 具体 URL"(同一 gravatar 哈希的多个镜像分开记)。 */
function getAvatarSourceKey(
	candidate: ReturnType<typeof getUserAvatarCandidates>[number],
) {
	return `${candidate.cacheKey}:${candidate.url}`;
}

/** <img> 加载失败:记录失败、游标前移、尝试回落到本地缓存的其他候选。 */
function handleAvatarRenderError(view: AvatarView) {
	const candidate = view.candidate;
	if (!candidate) return;
	cacheAvatarFailure(getAvatarSourceKey(candidate));
	const currentIndex = Math.max(
		0,
		view.candidates.findIndex(
			(item) =>
				item.url === candidate.url && item.cacheKey === candidate.cacheKey,
		),
	);
	avatarCursor.value = { ...avatarCursor.value, [view.key]: currentIndex + 1 };
	const cached = getCachedAvatarFromCandidates(view.candidates);
	if (cached) avatars.value = { ...avatars.value, [view.key]: cached };
}

/** <img> 加载成功:让服务端把该 URL 抓下来缓存(不记失败,浏览器已证明可用)。 */
function handleAvatarRenderLoad(view: AvatarView) {
	if (!view.candidate) return;
	const taskKey = `${view.key}:${view.signature}:${view.candidate.url}`;
	if (avatarTasks.has(taskKey)) return;
	const task = fetchAndCacheAvatar(
		view.candidate.cacheKey,
		view.candidate.url,
		false,
	).finally(() => {
		avatarTasks.delete(taskKey);
	});
	avatarTasks.set(taskKey, task);
}

/**
 * 空闲水合:对还没有 src 的头像,按首个候选的 cacheKey 查服务端缓存
 * (fetchCachedAvatar),命中则补上;期间用户/候选已变化的跳过。
 */
function hydrateCachedAvatars() {
	avatarHydrationTask = 0;
	for (const view of avatarViews.value) {
		if (!view.candidates.length || view.cached) continue;
		const first = view.candidates[0];
		const taskKey = `${view.key}:${view.signature}:cache`;
		if (avatarTasks.has(taskKey)) continue;
		const task = fetchCachedAvatar(first.cacheKey)
			.then((src) => {
				const current = avatarViews.value.some((item) => {
					return (
						item.key === view.key &&
						item.signature === view.signature &&
						!item.src
					);
				});
				if (!current) return;
				if (src) avatars.value = { ...avatars.value, [view.key]: src };
			})
			.finally(() => {
				avatarTasks.delete(taskKey);
			});
		avatarTasks.set(taskKey, task);
	}
}

/** 调度空闲水合:优先 requestIdleCallback(700ms 兜底),退化为 120ms 定时。 */
function scheduleAvatarHydration() {
	cancelAvatarHydration();
	const idle = (
		window as typeof window & {
			requestIdleCallback?: (
				callback: () => void,
				options?: { timeout?: number },
			) => number;
		}
	).requestIdleCallback;
	if (idle) {
		avatarHydrationTask = idle(hydrateCachedAvatars, { timeout: 700 });
	} else {
		avatarHydrationTask = window.setTimeout(hydrateCachedAvatars, 120);
	}
}

/** 取消挂起的空闲水合任务。 */
function cancelAvatarHydration() {
	if (!avatarHydrationTask) return;
	const idle = (
		window as typeof window & {
			cancelIdleCallback?: (handle: number) => void;
		}
	).cancelIdleCallback;
	if (idle) idle(avatarHydrationTask);
	else clearTimeout(avatarHydrationTask);
	avatarHydrationTask = 0;
}

/** 数值展示归一:≥100 取整,否则保留一位小数。 */
function formatValue(value: number) {
	return value >= 100 ? +value.toFixed() : +value.toFixed(1);
}

/** 字节数 → KB/MB/GB 文案。 */
function formatSize(value: number) {
	if (value >= (1 << 20) * 1000) {
		return formatValue(value / (1 << 30)) + " GB";
	} else if (value >= (1 << 10) * 1000) {
		return formatValue(value / (1 << 20)) + " MB";
	} else {
		return formatValue(value / (1 << 10)) + " KB";
	}
}

const { t, locale } = useMarketI18n();

/** 相对时间换算的时间单位。 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 超过 7 天改用绝对日期展示。 */
const ABSOLUTE_DATE_THRESHOLD = 7 * DAY;

/** 参考时钟:优先服务端下发的 serverNow,避免客户端时钟偏差。 */
function getReferenceNow() {
	const serverNow = Number(store.market?.serverNow);
	return Number.isFinite(serverNow) && serverNow > 0 ? serverNow : Date.now();
}

/** 绝对日期展示(当前 locale)。 */
function formatAbsoluteDate(timestamp: number) {
	return new Date(timestamp).toLocaleDateString(locale.value, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
}

/** 相对时间:刚刚/N 分钟前/N 小时前/N 天前,超过 7 天转绝对日期。 */
function timeAgo(time?: string) {
	const timestamp = Date.parse(time || "");
	if (!Number.isFinite(timestamp)) return t("time.unknown");
	const diff = Math.max(0, getReferenceNow() - timestamp);
	if (diff < MINUTE) return t("time.just-now");
	if (diff < HOUR)
		return t("time.minutes-ago", [Math.max(1, Math.floor(diff / MINUTE))]);
	if (diff < DAY) return t("time.hours-ago", [Math.floor(diff / HOUR)]);
	if (diff < ABSOLUTE_DATE_THRESHOLD)
		return t("time.days-ago", [Math.floor(diff / DAY)]);
	return formatAbsoluteDate(timestamp);
}

/** "N 天前更新"包装文案。 */
function updatedAgo(time?: string) {
	return t("time.updated-ago", [timeAgo(time)]);
}

/**
 * 心跳图标的 CSS 变量:新鲜度 = exp(-年龄/75 天) → 红色占比与不透明度;
 * 14 天内额外加辉光。日期无效时用低透明度灰。
 */
const updatedMetaStyle = computed<Record<string, string>>(() => {
	const timestamp = Date.parse(props.data.updatedAt || "");
	if (!Number.isFinite(timestamp)) {
		return {
			"--update-heart-color": "var(--fg3, var(--k-text-light, #888))",
			"--update-heart-opacity": "0.44",
			"--update-heart-glow-color": "transparent",
			"--update-heart-glow-size": "0px",
		};
	}

	const age = Math.max(0, getReferenceNow() - timestamp);
	const freshness = Math.exp(-age / (75 * DAY));
	const redMix = Math.round(82 * freshness);
	const opacity = (0.44 + freshness * 0.46).toFixed(2);
	const glow = Math.max(0, 0.12 * (1 - age / (14 * DAY)));
	const glowSize = glow ? (0.8 + glow / 0.1).toFixed(1) : "0";
	return {
		"--update-heart-color": `color-mix(in srgb, #eb4d55 ${redMix}%, var(--fg3, var(--k-text-light, #888)))`,
		"--update-heart-opacity": opacity,
		"--update-heart-glow-color": glow
			? `rgb(223 93 98 / ${glow.toFixed(2)})`
			: "transparent",
		"--update-heart-glow-size": `${glowSize}px`,
	};
});

// 条目或 gravatar 配置变化:清空头像状态重新开始候选回退
watch(
	() => [props.data.package.name, props.gravatar],
	() => {
		cancelAvatarHydration();
		avatarCursor.value = {};
		avatarTasks.clear();
		avatars.value = {};
	},
);

// 头像视图出现无 src 的条目时调度空闲水合
watch(
	() =>
		avatarViews.value.map(
			(view) => `${view.key}:${view.signature}:${view.src ? "1" : "0"}`,
		),
	() => {
		scheduleAvatarHydration();
	},
	{ immediate: true },
);

onUnmounted(() => {
	cancelAvatarHydration();
	avatarTasks.clear();
});
</script>

<style lang="scss" scoped src="./package.scss"></style>
