<template>
  <el-dialog v-model="visible" class="market-config-remove-dialog" :title="title" destroy-on-close>
    <template v-if="target">
      {{ content }}
    </template>
    <template #footer>
      <el-button @click="visible = false">{{ t('extensions.actions.cancel') }}</el-button>
      <el-button type="danger" :loading="removing" @click="remove">{{ t('common.actions.confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * @file 插件配置节点移除确认对话框(全局插槽)。
 *
 * 监听 config-remove.ts 的 configRemoveTarget:确认后调宿主 config 插件的
 * manager/remove RPC 删除节点(分组或单个配置),成功后跳回父级配置页。
 * 由 extensions/index.ts 注册为 global 插槽。
 */

import { computed, ref } from 'vue'
import { message, router, send } from '@koishi-ce/client'
import { configRemoveTarget } from './index.ts'
import { useMarketNextI18n } from '../../shared/i18n'

/** 移除请求执行中标记。 */
const removing = ref(false)
const { t } = useMarketNextI18n()

/** 目标节点(模块级 ref 的本地只读代理)。 */
const target = computed(() => configRemoveTarget.value)

/** 对话框开关代理:target 有值即开,置空 target 即关。 */
const visible = computed({
  get: () => !!configRemoveTarget.value,
  set: (value) => {
    if (!value) configRemoveTarget.value = undefined
  },
})

/** 弹窗标题:目标是分组(有 children)还是单个配置。 */
const title = computed(() => {
  return target.value?.children ? t('extensions.actions.removeGroupTitle') : t('extensions.actions.removeConfigTitle')
})

/** 确认文案:分组用 label/path,配置用 label/name。 */
const content = computed(() => {
  const item = target.value
  if (!item) return ''
  if (item.children) {
    return t('extensions.messages.removeGroupConfirm', { name: item.label || item.path })
  }
  return t('extensions.messages.removeConfigConfirm', { name: item.label || item.name })
})

/** 执行移除:以父分组路径 + 节点 id 调 manager/remove,成功后关窗并跳回父级配置页。 */
async function remove() {
  const item = target.value
  if (!item || removing.value) return
  removing.value = true
  try {
    await send('manager/remove', item.parent?.path ?? '', item.id)
    configRemoveTarget.value = undefined
    await router.replace('/plugins/' + (item.parent?.path ?? ''))
  } catch (error) {
    console.error(error)
    message.error(t('extensions.messages.configRemoveFailed'))
  } finally {
    removing.value = false
  }
}

</script>

