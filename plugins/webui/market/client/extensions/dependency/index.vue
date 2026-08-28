<template>
  <!-- peer 依赖提示:按 已加载(绿)/必需未装(黄)/可选(蓝) 分色,链接可打开 install 面板 -->
  <k-comment
    v-for="({ required, active }, name) in env.peer" :key="name"
    :type="active ? 'success' : required ? 'warning' : 'primary'">
    <p>
      {{ required ? t('extensions.dependency.requiredDependency') : t('extensions.dependency.optionalDependency') }}: <k-dep-link :name="name"></k-dep-link>
    </p>
  </k-comment>
  <k-comment
    v-for="({ required }, name) in env.using" :key="name"
    :type="name in store.services ? 'success' : required ? 'warning' : 'primary'">
    <p>
      {{ required ? t('extensions.dependency.requiredService') : t('extensions.dependency.optionalService') }}: {{ name }}
      <span v-if="name in store.services">{{ t('extensions.dependency.clickLoaded') }}</span>
      <span v-else-if="available[name].length">({{ t('extensions.dependency.serviceHint') }})</span>
      <span v-else>({{ t('extensions.dependency.unavailable') }})</span>
    </p>
    <ul v-if="!(name in store.services) && available[name].length">
      <!-- 服务提供者候选列表:市场里声明实现该服务的插件,点击可装 -->
      <li v-for="shortname in available[name]" :key="shortname">
        <k-dep-link :name="shortname"></k-dep-link>
      </li>
    </ul>
  </k-comment>
</template>

<script lang="ts" setup>
/**
 * @file 插件详情页的依赖/服务状态展示(plugin-dependency 插槽)。
 *
 * 数据来自 config 插件注入的 plugin:env(peer 依赖与 using 服务):
 * peer 逐个渲染包名链接;服务未加载时列出市场里的提供者候选
 * (loadMarketServiceProviders 按服务名增量查询)。由 extensions/index.ts 注册。
 */

import { Dict, store } from '@koishi-ce/client'
import { computed, inject, ComputedRef, watch } from 'vue'
import { EnvInfo } from '@koishi-ce/plugin-config/client'
import KDepLink from '../dep-link/index.vue'
import { useMarketNextI18n } from '../../shared/i18n'
import { getMarketServiceProviders, loadMarketServiceProviders } from '../../market/state'

/** config 插件注入的插件环境信息(peer 依赖 + using 服务)。 */
const env = inject<ComputedRef<EnvInfo>>('plugin:env')
const { t } = useMarketNextI18n()

/** using 的服务名变化时按需拉取市场里实现该服务的插件列表。 */
watch(() => Object.keys(env.value?.using ?? {}), (services) => {
  void loadMarketServiceProviders(services).catch(error => {
    console.error('[market-next] failed to load service providers', error)
  })
}, { immediate: true })

/** 每个未加载服务在市场里的提供者候选包名列表。 */
const available = computed(() => {
  const available: Dict<string[]> = {}
  for (const name in env.value.using) {
    available[name] = getMarketServiceProviders(name)
  }
  return available
})

</script>
