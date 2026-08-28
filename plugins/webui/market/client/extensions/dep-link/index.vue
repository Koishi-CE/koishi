<template>
  <!-- 包名链接:点击打开 install 面板(active ref),后缀按状态提示 已加载/可配置/可添加 -->
  <span class="k-link" @click.stop="active = name">
    {{ name }}
  </span>
  <span v-if="store.packages[name]?.runtime?.id"> {{ t('extensions.dependency.clickLoaded') }}</span>
  <span v-else> {{ name in store.packages ? t('extensions.dependency.clickConfigure') : t('extensions.dependency.clickAdd') }}</span>
</template>

<script lang="ts" setup>
/**
 * @file 依赖包名链接(plugin-dependency 插槽的最小单元)。
 *
 * 点击包名把 shared/plugin-config 的 active 置为该包,弹出 install 面板;
 * 名称后按 packages 里的状态追加"已加载/可配置/可添加"提示。仅被
 * dependency.vue 使用。
 */

import { store } from "@koishi-ce/client";
import {} from "@koishi-ce/plugin-config";
import { active } from "../../shared/plugin-config";
import { useMarketNextI18n } from "../../shared/i18n";

defineProps<{
	name: string;
}>();

const { t } = useMarketNextI18n();
</script>
