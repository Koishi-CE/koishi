<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  市场插件卡片（本地化 fork 自 @koishijs/market 4.2.10 的
  client/components/package.vue，逻辑 utils 仍从该包导入）。
  视觉重设计参考 marketn：类目色渐变图标块、胶囊徽章、
  心跳新鲜度指示（替代评分星）、头像首字母占位。
-->

<template>
  <a
    class="market-package flex flex-col gap-3"
    :class="'cat-' + resolveCategory(data.category)"
    target="_blank"
    :href="homepage"
  >
    <div class="header flex flex-row gap-4">
      <div class="left shrink-0 flex flex-row justify-center items-center">
        <market-icon :name="'outline:' + resolveCategory(data.category)"></market-icon>
      </div>
      <div class="main flex flex-col justify-around overflow-hidden">
        <h2 class="top">
          <span class="title truncate" :title="data.shortname">{{ data.shortname }}</span>
        </h2>
        <div class="bottom">
          <el-tooltip :content="new Date(data.updatedAt).toLocaleString()" placement="right">
            <div class="heartbeat" :style="heartStyle">
              <market-icon name="heart-pulse"></market-icon>
              <span>{{ timeAgo(data.updatedAt) }}</span>
            </div>
          </el-tooltip>
        </div>
      </div>
      <div class="text-right grow-1 shrink-0">
        <slot name="action"></slot>
      </div>
    </div>
    <k-markdown inline class="desc" :source="tt(data.manifest?.description) ?? ''"></k-markdown>
    <div v-if="badge" class="badge-float">
      <el-tooltip placement="top" :content="badge.query">
        <span
          :class="['badge-pill', badge.type]"
          @click.stop.prevent="$emit('query', badge.query)"
        >
          <market-icon :name="badge.type"></market-icon>
          <span>{{ t(`badge.${badge.type}`) }}</span>
        </span>
      </el-tooltip>
    </div>
    <div class="footer">
      <el-tooltip :content="timeAgo(data.updatedAt)" placement="top">
        <a class="truncate" target="_blank" :href="data.package.links.npm">
          <market-icon name="tag"></market-icon>{{ data.package.version }}
        </a>
      </el-tooltip>
      <template v-if="data.installSize">
        <span class="spacer"></span>
        <a class="truncate" target="_blank" :href="data.package.links.size">
          <market-icon name="file-archive"></market-icon>{{ formatSize(data.installSize) }}
        </a>
      </template>
      <template v-if="data.downloads">
        <span class="spacer"></span>
        <span class="truncate">
          <market-icon name="download"></market-icon>{{ formatValue(data.downloads.lastMonth) }}
        </span>
      </template>
      <template v-if="!data.installSize && !data.downloads">
        <span class="spacer"></span>
        <span class="truncate">
          <market-icon name="balance"></market-icon>{{ data.license }}
        </span>
      </template>
      <span class="long-spacer"></span>
      <div class="avatars">
        <el-tooltip
          v-for="({ email, name }) in getUsers(data)"
          :key="name"
          :content="name"
          placement="top"
        >
          <span
            class="avatar"
            :class="{ fallback: failedAvatars.has(name) }"
            :data-initial="(name?.[0] ?? '?').toUpperCase()"
            @click.stop.prevent="$emit('query', 'email:' + email)"
          >
            <img
              v-if="!failedAvatars.has(name)"
              :src="getAvatar(email)"
              alt=""
              @error="failedAvatars.add(name)"
            >
          </span>
        </el-tooltip>
      </div>
    </div>
  </a>
</template>

<script lang="ts" setup>
import type { SearchObject } from "@koishi-ce/registry";
import { useI18nText } from "@koishijs/components";
import {
	badges,
	getUsers,
	kConfig,
	MarketIcon,
	resolveCategory,
	useMarketI18n,
	validate,
} from "@koishijs/market";
import * as md5 from "spark-md5";
import { computed, inject, reactive } from "vue";

defineEmits(["query"]);

const props = defineProps<{
	data: SearchObject;
	gravatar?: string;
}>();

const config = inject(kConfig, {});

const tt = useI18nText();

const homepage = computed(() => {
	const { homepage, repository } = props.data.package.links;
	if (homepage) return homepage;
	if (repository)
		return repository
			.replace(/^git\+/, "")
			.replace(/\.git$/, "");
});

const badge = computed(() => {
	for (const type in badges) {
		if (badges[type].hidden?.(config, "card")) continue;
		if (validate(props.data, badges[type].query))
			return { type, ...badges[type] };
	}
});

// 心跳新鲜度：更新越近心越红越亮，14 天内附加辉光（75 天指数半衰）
const heartStyle = computed(() => {
	const age =
		Date.now() - new Date(props.data.updatedAt).getTime();
	const freshness = Math.exp(
		-age / (1000 * 3600 * 24 * 75),
	);
	return {
		"--heart-mix": `${Math.round(82 * freshness)}%`,
		"--heart-opacity": (0.44 + 0.46 * freshness).toFixed(2),
		"--heart-glow":
			freshness > Math.exp(-14 / 75) ? "1" : "0",
	} as Record<string, string>;
});

// 头像加载失败后以类目色首字母占位，避免裂图
const failedAvatars = reactive(new Set<string>());

function getAvatar(email: string) {
	return (
		(props.gravatar || "https://s.gravatar.com") +
		"/avatar/" +
		(email ? md5.hash(email.toLowerCase()) : "") +
		".png?d=mp"
	);
}

function formatValue(value: number) {
	return value >= 100
		? +value.toFixed()
		: +value.toFixed(1);
}

function formatSize(value: number) {
	if (value >= (1 << 20) * 1000) {
		return formatValue(value / (1 << 30)) + " GB";
	} else if (value >= (1 << 10) * 1000) {
		return formatValue(value / (1 << 20)) + " MB";
	} else {
		return formatValue(value / (1 << 10)) + " KB";
	}
}

const { t } = useMarketI18n();

function timeAgo(time: string) {
	const now = new Date();
	const input = new Date(time);
	const diff = now.getTime() - input.getTime();
	if (diff < 30000) return t("time.just-now");
	if (diff < 3600000)
		return t("time.minutes-ago", [
			Math.floor(diff / 60000),
		]);
	if (diff < 86400000)
		return t("time.hours-ago", [
			Math.floor(diff / 3600000),
		]);
	if (diff < 604800000)
		return t("time.days-ago", [
			Math.floor(diff / 86400000),
		]);
	return input.toLocaleDateString();
}
</script>

<style lang="scss" scoped>

// 15 类分类色板（Tailwind-400 系，明暗模式通用）
.cat-adapter { --c: #38bdf8; }
.cat-general { --c: #4ade80; }
.cat-extension { --c: #a78bfa; }
.cat-webui { --c: #fb923c; }
.cat-manage { --c: #facc15; }
.cat-preset { --c: #60a5fa; }
.cat-image { --c: #f472b6; }
.cat-media { --c: #e879f9; }
.cat-tool { --c: #94a3b8; }
.cat-life { --c: #34d399; }
.cat-ai { --c: #818cf8; }
.cat-meme { --c: #fbbf24; }
.cat-game { --c: #f87171; }
.cat-gametool { --c: #c084fc; }
.cat-other { --c: #64748b; }

.market-package {
  position: relative;
  width: 100%;
  max-width: 540px;
  height: calc(12.5rem + 2px);
  margin: 0;
  padding: 1rem 1.25rem;
  box-sizing: border-box;
  border-radius: 12px;
  background-color: var(--k-card-bg);
  border: 1px solid var(--k-color-border);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
  contain: layout paint style;

  &:hover {
    border-color: var(--k-color-primary);
    box-shadow: 0 4px 12px rgb(0 0 0 / 6%);
  }

  .market-icon {
    height: 1em;
    display: inline;
  }

  .header, .footer {
    flex: 0 0 auto;
  }

  .header {
    position: relative;

    // 类目色渐变图标块
    .left {
      width: 3.5rem;
      height: 3.5rem;
      border-radius: 10px;
      box-sizing: border-box;
      border: 1px solid color-mix(in srgb, var(--c) 35%, var(--k-color-border));
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--c) 18%, var(--k-card-bg)),
        color-mix(in srgb, var(--c) 10%, var(--k-card-bg))
      );
      transition: var(--color-transition);

      svg {
        height: 1.75rem;
        color: var(--c);
      }
    }

    h2 {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 0;
      line-height: 1.2;
      display: flex;
      align-items: center;

      .title {
        flex: 0 1 auto;
        line-height: 1.5rem;
        display: inline-block;
      }
    }

    // 心跳新鲜度：颜色与不透明度由 --heart-* 变量驱动
    .heartbeat {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 1.5rem;
      font-size: 12px;
      color: var(--k-text-light);

      .market-icon {
        height: 12px;
        width: 12px;
        flex: 0 0 auto;
        color: color-mix(in srgb, #eb4d55 var(--heart-mix, 0%), var(--k-text-light));
        opacity: var(--heart-opacity, 0.5);
        filter: drop-shadow(0 0 calc(var(--heart-glow, 0) * 4px) rgb(235 77 85 / calc(var(--heart-glow, 0) * 0.45)));
        transition: color 0.3s ease, opacity 0.3s ease;
      }
    }
  }

  // 认证徽章：悬浮于头像列正上方，不占布局空间，避免与长插件名挤压折行
  .badge-float {
    position: absolute;
    right: 1.25rem;
    bottom: 2.5rem;
  }

  // 胶囊徽章：语义色 10% 底 / 20% 边
  .badge-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 20px;
    line-height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--k-color-success) 20%, transparent);
    background-color: color-mix(in srgb, var(--k-color-success) 10%, transparent);
    color: var(--k-color-success);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    user-select: none;

    .market-icon {
      height: 12px;
      width: 12px;
    }

    &.preview {
      border-color: color-mix(in srgb, var(--k-color-warning) 20%, transparent);
      background-color: color-mix(in srgb, var(--k-color-warning) 10%, transparent);
      color: var(--k-color-warning);
    }

    &.insecure {
      border-color: color-mix(in srgb, var(--k-color-danger) 20%, transparent);
      background-color: color-mix(in srgb, var(--k-color-danger) 10%, transparent);
      color: var(--k-color-danger);
    }
  }

  .desc {
    margin: 0;
    font-size: 14px;
    flex: 1 1 auto;
    line-height: 1.6;
    color: var(--k-text-light);
    overflow: hidden;
    word-break: break-word;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  .footer {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    height: 1.5rem;
    margin-bottom: -0.25rem;
    cursor: default;
    font-size: 13px;
    color: var(--k-text-light);
    transition: color 0.3s ease;
    overflow: hidden;

    > * {
      flex: 0 0 auto;
    }

    .spacer {
      flex: 0 2 0.5rem;
    }

    .long-spacer {
      flex: 1 1 auto;
    }

    .market-icon {
      height: 12px;
      width: 16px;
      margin-right: 6px;
      vertical-align: -1px;
    }

    .avatars {
      display: flex;
      gap: 0.25rem;

      .avatar {
        cursor: pointer;
        height: 1.5rem;
        width: 1.5rem;
        border-radius: 100%;

        img {
          height: 1.5rem;
          width: 1.5rem;
          border-radius: 100%;
          vertical-align: middle;
        }

        // 加载失败：类目色渐变底 + 首字母占位
        &.fallback {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--c) 30%, var(--k-card-bg)),
            color-mix(in srgb, var(--c) 12%, var(--k-card-bg))
          );
          color: color-mix(in srgb, var(--c) 80%, var(--k-text-dark));
          font-size: 0.68rem;
          font-weight: 700;

          &::before {
            content: attr(data-initial);
          }
        }
      }
    }
  }
}

@media (max-width: 420px) {
  .market-package {
    height: auto;
    min-height: 11rem;
    padding: 0.82rem 0.9rem;

    .header .left {
      width: 3rem;
      height: 3rem;
    }

    h2 {
      font-size: 1rem;
    }

    .badge-float {
      right: 0.9rem;
      bottom: 2.3rem;
    }

    .footer {
      flex-wrap: wrap;
      height: auto;

      .long-spacer {
        display: none;
      }
    }
  }
}

</style>
