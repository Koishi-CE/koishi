<template>
  <k-slot name="plugin-select-base">
    <template #title="{ packages }">
      <span class="title">{{ t(`category.${active}`) }} ({{ packages.length }})</span>
    </template>
    <template #tabs>
      <div class="tabs">
        <el-scrollbar>
          <span class="tab-item" v-for="key in extended" :key="key" @click.stop="active = key" :class="{ active: active === key }">
            <market-icon :name="'solid:' + key"></market-icon>
            <span class="title">{{ t(`category.${key}`) }}</span>
          </span>
        </el-scrollbar>
      </div>
    </template>
  </k-slot>
</template>

<script setup lang="ts">
/**
 * @file 插件选择器(添加插件页)的分类过滤(plugin-select 插槽)。
 *
 * 包裹宿主的 plugin-select-base 插槽,替换其标题为"分类名 (数量)",并在
 * tabs 区按市场分类(extended = all/other + 各分类)提供筛选:通过
 * provide('plugin-select-filter') 向宿主注入过滤函数,按 active 分类
 * 过滤包列表。由 extensions/index.ts 注册。
 */

import { store } from '@koishi-ce/client'
import { categories, MarketIcon, useMarketI18n, resolveCategory } from '../../market'
import { PackageProvider } from '@koishi-ce/plugin-config'
import { provide, ref, watch } from 'vue'
import { getMarketObject, loadMarketObjects } from '../../market/state'

/** 分类标签全集:all/other 打头 + 市场定义的分类列表。 */
const extended = ['all', 'other', ...categories]

const { t } = useMarketI18n()

/** 当前选中的分类标签 key。 */
const active = ref('all')

/** packages 列表变化时增量拉取各包的市场分类元数据。 */
watch(() => Object.keys(store.packages ?? {}), (names) => {
  void loadMarketObjects(names).catch(error => {
    console.error('[market-next] failed to load plugin category metadata', error)
  })
}, { immediate: true })

/** 注入给宿主 plugin-select-base 的过滤函数:all 放行,其余按市场分类(缺省归 other)匹配。 */
provide('plugin-select-filter', ({ name, manifest }: PackageProvider.Data) => {
  const category = getMarketObject(name)?.category || manifest?.category
  return active.value === 'all' || resolveCategory(category) === active.value
})

</script>
