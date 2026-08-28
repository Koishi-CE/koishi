<template>
  <el-dialog v-model="showIgnoreDialog" :class="'dep-ignore-dialog'" append-to-body destroy-on-close>
    <template #header>{{ t('dependencyCard.ignore.title') }}</template>
    <div class="dep-ignore-body">
      <p>
        {{ t('dependencyCard.ignore.intro', { name: displayName }) }}
        <template v-if="latestVersion">{{ t('dependencyCard.ignore.versionIntro', { version: latestVersion }) }}</template>
      </p>
      <el-checkbox v-model="ignorePackagePermanently">
        {{ t('dependencyCard.ignore.permanent') }}
      </el-checkbox>
      <template v-if="!ignorePackagePermanently">
        <label class="dep-ignore-field">
          <span>{{ t('dependencyCard.ignore.duration') }}</span>
          <el-radio-group v-model="ignoreDurationPreset">
            <el-radio-button value="forever">{{ t('dependencyCard.ignore.forever') }}</el-radio-button>
            <el-radio-button value="1d">{{ t('dependencyCard.ignore.day', { count: 1 }) }}</el-radio-button>
            <el-radio-button value="7d">{{ t('dependencyCard.ignore.day', { count: 7 }) }}</el-radio-button>
            <el-radio-button value="30d">{{ t('dependencyCard.ignore.day', { count: 30 }) }}</el-radio-button>
            <el-radio-button value="custom">{{ t('dependencyCard.ignore.custom') }}</el-radio-button>
          </el-radio-group>
        </label>
        <label v-if="ignoreDurationPreset === 'custom'" class="dep-ignore-field inline">
          <span>{{ t('dependencyCard.ignore.customDays') }}</span>
          <el-input-number v-model="ignoreCustomDays" :min="1" :max="3650" :step="1" controls-position="right"></el-input-number>
        </label>
        <label class="dep-ignore-field inline">
          <span>{{ t('dependencyCard.ignore.versionCount') }}</span>
          <el-input-number v-model="ignoreCount" :min="1" :max="20" :step="1" controls-position="right"></el-input-number>
        </label>
      </template>
      <p class="dep-ignore-note">
        <template v-if="ignorePackagePermanently">
          {{ t('dependencyCard.ignore.permanentNote') }}
        </template>
        <template v-else>
          {{ t('dependencyCard.ignore.durationNote') }}
        </template>
      </p>
    </div>
    <template #footer>
      <el-button @click="showIgnoreDialog = false">{{ t('dependencyCard.ignore.cancel') }}</el-button>
      <el-button type="primary" :loading="ignoreSaving" @click="confirmIgnoreUpdate">{{ t('dependencyCard.ignore.confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * "忽略此更新"对话框:永久禁检或按时长/次数忽略,确认后双写策略。
 * 父组件通过 ref 调用 open() 打开(打开时按当前策略初始化预设)。
 */

import { useMarketNextI18n } from '../../shared/i18n'
import { useIgnoreUpdate, type IgnoreUpdateTarget } from './use-ignore-update'

const props = defineProps<{
  displayName: string
  latestVersion?: string
  target: IgnoreUpdateTarget
  config: { value: unknown }
}>()

const { t } = useMarketNextI18n()
const {
  showIgnoreDialog, ignoreDurationPreset, ignoreCustomDays, ignoreCount,
  ignorePackagePermanently, ignoreSaving, openIgnoreDialog, confirmIgnoreUpdate,
} = useIgnoreUpdate(props.target, props.config, t)

defineExpose({ open: openIgnoreDialog })
</script>
