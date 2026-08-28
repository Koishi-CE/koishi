<template>
  <el-dialog
    v-model="showLocalBindingDialog"
    append-to-body
    align-center
    :class="['market-dialog', 'market-dialog--small', 'dep-local-binding-dialog']"
    destroy-on-close
  >
    <template #header>{{ t('dependencyCard.localBinding.title') }}</template>
    <div class="dep-local-binding-body">
      <p>{{ t('dependencyCard.localBinding.description', { name: displayName }) }}</p>
      <k-comment type="warning">{{ t('dependencyCard.localBinding.note') }}</k-comment>
    </div>
    <template #footer>
      <el-button @click="showLocalBindingDialog = false">{{ t('dependencyCard.localBinding.cancel') }}</el-button>
      <el-button type="primary" :loading="bindingLocal" @click="confirmLocalBinding">{{ t('dependencyCard.localBinding.confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * 本地依赖绑定确认对话框:确认后向服务端请求版本请求串并写入 override。
 * 父组件通过 ref 调用 open() 打开。
 */

import { useMarketNextI18n } from '../../shared/i18n'
import { useLocalBinding } from './use-local-binding'

const props = defineProps<{
  name: string
  displayName: string
}>()

const { t } = useMarketNextI18n()
const { showLocalBindingDialog, bindingLocal, openLocalBinding, confirmLocalBinding } = useLocalBinding(props.name, t)

defineExpose({ open: openLocalBinding })
</script>
