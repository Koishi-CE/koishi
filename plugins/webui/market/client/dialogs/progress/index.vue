<template>
  <k-status v-if="isLoading">
    <el-progress :indeterminate="!store.market" :percentage="percentage">
      {{ t('marketPage.progress.loading') }}
    </el-progress>
  </k-status>
</template>

<script lang="ts" setup>
/**
 * @file 市场页顶部加载进度条(activity 槽)。
 *
 * 监听 store.market 的 total/progress 展示市场数据同步进度;无数据时显示
 * 不确定进度(50%)。ctx.bail('activity', ...) 允许其他扩展拦截隐藏该槽。
 * 由 app/pages.ts 挂载到市场页。
 */

import { store, useContext } from '@koishi-ce/client'
import { computed } from 'vue'
import { useMarketNextI18n } from '../../shared/i18n'

const ctx = useContext()
const { t } = useMarketNextI18n()

/** 是否展示进度条:activity 槽未被拦截,且市场数据未加载完(或尚未开始)。 */
const isLoading = computed(() => {
  if (ctx.bail('activity', ctx.$router.pages['market'])) return false
  return !store.market || store.market.total > store.market.progress
})

/** 进度百分比:尚无 total 数据时以 50% 展示不确定进度。 */
const percentage = computed(() => {
  if (!store.market) return 50
  return 100 * store.market.progress / store.market.total
})

</script>

<style lang="scss" src="./index.scss"></style>
