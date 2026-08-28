<template>
  <k-comment type="danger">
    <p>
      <span>{{ t('extensions.missing.notInstalled') }}</span>
      <span v-if="fullname" class="k-link" @click="active = fullname">{{ t('extensions.missing.quickInstall') }}</span>
      <span v-else class="k-link" @click="gotoMarket">{{ t('extensions.missing.goMarket') }}</span>
    </p>
  </k-comment>
</template>

<script setup lang="ts">
/**
 * @file 插件配置指向未安装包时的提示(plugin-missing 插槽)。
 *
 * 由配置插件注入的当前设置节点取名,猜测它对应的完整包名(官方/常规/
 * scoped 三种候选)并查市场元数据:查得到给"快速安装"链接(打开 install
 * 面板),查不到给"去市场搜索"链接。由 extensions/index.ts 注册。
 */

import { computed, inject, watch, WritableComputedRef } from 'vue'
import { useRouter } from 'vue-router'
import { active } from '../../shared/plugin-config'
import { useMarketNextI18n } from '../../shared/i18n'
import { getMarketObject, loadMarketObjects } from '../../market/state'

const router = useRouter()
const { t } = useMarketNextI18n()

/** config 插件注入的"当前正在查看的插件设置节点"。 */
const current = inject<WritableComputedRef<any>>('manager.settings.current')

/** 由插件短名猜完整包名候选:scoped 名补 koishi-plugin 段;普通名拼官方/常规两种前缀。 */
function getCandidates(name: string) {
  return name.startsWith('@')
    ? [name.replace(/\//, '/koishi-plugin-')]
    : [`@koishijs/plugin-${name}`, `koishi-plugin-${name}`]
}

/** 市场里能查到的第一个候选包名(查不到为 undefined,模板据此切换两种链接)。 */
const fullname = computed(() => {
  const { name } = current.value
  return getCandidates(name).find(name => !!getMarketObject(name))
})

/** 切换目标插件时按候选包名增量拉取市场元数据。 */
watch(() => current.value?.name, (name) => {
  if (!name) return
  void loadMarketObjects(getCandidates(name)).catch(error => {
    console.error('[market-next] failed to resolve missing plugin', error)
  })
}, { immediate: true })

/** 去市场页按插件名搜索。 */
function gotoMarket() {
  router.push('/market?keyword=' + current.value.name)
}

</script>
