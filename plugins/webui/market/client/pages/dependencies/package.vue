<template>
  <!-- Card mode -->
  <article
    :class="['dep-package-card', statusClass, { expandable: canExpandCard, expanded: editing }]"
    :style="cardStyle"
    @click="toggleCardActions"
  >
    <div class="dep-status-mark" aria-hidden="true">
      <market-icon :name="markIcon"></market-icon>
    </div>
    <div class="dep-card-header">
      <div class="dep-title">
        <div class="dep-title-line">
          <h3 :title="name">{{ displayName }}</h3>
          <span v-if="showIdentityPill" class="dep-kind-pill">
            <span class="dep-kind-icon">
              <market-icon :name="identityIcon"></market-icon>
            </span>
            {{ identityText }}
          </span>
          <span v-if="showStatusBadge" :class="['dep-badge', statusClass]">
            <market-icon :name="badgeIcon"></market-icon>
            {{ statusLabel }}
          </span>
        </div>
        <span class="dep-full-name" :title="name">{{ name }}</span>
      </div>
      <div class="dep-header-actions" @click.stop>
        <el-button
          v-if="showInlineIgnoreUpdate"
          size="small"
          @click="$emit('open-ignore', name)"
        >
          {{ t('dependencyCard.actions.ignore') }}
        </el-button>
        <el-button v-if="showEditToggle" size="small" @click.stop="toggleEdit">
          {{ editToggleText }}
        </el-button>
      </div>
    </div>

    <p v-if="summaryText" class="dep-summary-text" :title="summaryText">
      {{ summaryText }}
    </p>

    <div class="dep-meta-row">
      <div class="dep-meta-item">
        <span>{{ t('common.labels.current') }}</span>
        <strong>{{ currentText }}</strong>
      </div>
      <div v-if="showTargetMeta" class="dep-meta-item">
        <span>{{ targetLabel }}</span>
        <strong :class="{ danger: pendingRemove }">{{ targetText }}</strong>
      </div>
      <div v-if="requestText" class="dep-meta-item">
        <span>{{ t('common.labels.range') }}</span>
        <strong>{{ requestText }}</strong>
      </div>
      <div v-if="showIdentityMeta" class="dep-meta-item dep-meta-kind">
        <span>{{ t('common.labels.type') }}</span>
        <strong>{{ identityText }}</strong>
      </div>
      <div v-if="showConfigMeta" class="dep-meta-item">
        <span>{{ t('common.labels.config') }}</span>
        <strong :class="{ warning: unconfigured }">{{ configText }}</strong>
      </div>
      <div v-if="showSourceMeta" class="dep-meta-item">
        <span>{{ t('common.labels.source') }}</span>
        <strong>{{ sourceText }}</strong>
      </div>
      <div v-if="versionSourceText" class="dep-meta-item">
        <span>{{ t('common.labels.versionSource') }}</span>
        <strong>{{ versionSourceText }}</strong>
      </div>
    </div>

    <p v-if="showDetailText" :class="['dep-status-text', { danger: statusClass === 'error' }]">
      {{ detailText }}
    </p>

    <div v-if="showCardActions" :class="['dep-card-actions', { floating: floatingActions }]" @click.stop>
      <el-select
        v-if="showVersionControl && data && (editing || versionControlReady)"
        ref="versionSelect"
        v-model="selectedVersion"
        size="small"
        class="market-version-select"
        :class="{ pending }"
        automatic-dropdown
        @visible-change="onVersionSelectVisible"
      >
        <el-option v-if="dep" :value="removeValue">{{ t('dependencyCard.actions.remove') }}</el-option>
        <template v-if="versionOptionsReady">
          <el-option v-for="({ result }, itemVersion) in data" :key="itemVersion" :value="itemVersion">
            {{ itemVersion }}
            <template v-if="itemVersion === dep?.resolved">{{ t('dependencyCard.actions.current') }}</template>
            <span :class="[result, 'theme-color', 'dot-hint']"></span>
          </el-option>
        </template>
      </el-select>
      <button
        v-else-if="showVersionControl && data"
        type="button"
        :class="['market-version-placeholder', { pending }]"
        @click.stop="activateVersionControl"
      >
        {{ versionPlaceholderText }}
      </button>
      <span v-else-if="showVersionControl" class="dep-muted">{{ compactStatusText }}</span>

      <div class="dep-card-buttons">
        <el-button
          v-if="showQuickUpdate"
          size="small"
          type="primary"
          @click="selectedVersion = latestVersion"
        >
          {{ t('dependencyCard.actions.updateLatest') }}
        </el-button>
        <el-button
          v-if="showRestoreUpdate"
          size="small"
          @click="restoreUpdate"
        >
          {{ t('dependencyCard.actions.restorePrompt') }}
        </el-button>
        <el-button
          v-if="showConfigure"
          size="small"
          type="primary"
          :loading="configuring"
          @click="configure"
        >
          {{ t('dependencyCard.actions.addConfig') }}
        </el-button>
        <el-button
          v-if="showBindLocal"
          size="small"
          type="primary"
          @click="$emit('open-binding', name)"
        >
          {{ t('dependencyCard.actions.bindLocal') }}
        </el-button>
        <el-button
          v-if="showRemoveDependency"
          class="dep-remove-button"
          size="small"
          @click="removeDependency"
        >
          {{ removeButtonText }}
        </el-button>
      <el-button v-if="pending" size="small" @click="clearOverride">{{ t('dependencyCard.actions.cancelChange') }}</el-button>
      </div>
    </div>
  </article>
</template>

<script lang="ts" setup>

import { computed, nextTick, ref, watch } from 'vue'
import { useConfig, useContext } from '@koishi-ce/client'
import type { SearchObject } from '@koishi-ce/registry'
import { getPendingOverrides } from '../../shared/plugin-config'
import { activeBundle, ensureInstalledConfig, expandedDependency, pendingBundleUninstalls } from '../../shared/operations'
import MarketIcon from '../../market/icons'
import { useMarketNextI18n } from '../../shared/i18n'
import { restoreIgnoreUpdate, type IgnoreUpdateTarget } from './use-ignore-update'
import { usePackageCardMeta } from './use-package-card-meta'
import { usePackageCardState } from './use-package-card-state'
import { usePackageCardStatus } from './use-package-card-status'
import { usePackageVisibility } from './use-package-visibility'

type ItemKind = 'pending' | 'bundle' | 'unconfigured' | 'updatable' | 'ignored' | 'check-disabled' | 'invalid' | 'error' | 'local' | 'manual' | 'installed'

/**
 * 性能约定:本组件在依赖页卡片墙中被全量实例化(数百张),任何新增的
 * 子组件/对话框/下拉选项都会乘以卡片总数——对话框与重下拉选项一律
 * 由页面级单例或懒渲染承载;版本控件(el-select 含 popper 组件树)在
 * 卡片展开或用户点击占位前不挂载,平时以纯文本占位展示当前值。
 */
const props = defineProps<{
  name: string
  kind?: ItemKind
}>()

const emit = defineEmits<{
  /** 请求打开"忽略此更新"对话框(页面级单例,payload 为目标包名)。 */
  (event: 'open-ignore', name: string): void
  /** 请求打开"本地依赖绑定"对话框(页面级单例,payload 为目标包名)。 */
  (event: 'open-binding', name: string): void
  /** 请求打开"合包卸载"对话框(页面级单例,payload 为目标包名)。 */
  (event: 'open-bundle-uninstall', name: string): void
}>()

const removeValue = '__market_next_remove__'
const config = useConfig()
const ctx = useContext()
const { t } = useMarketNextI18n()
const configuring = ref(false)
/** 版本下拉是否已打开过(打开前不渲染版本 el-option,避免数百选项常驻)。 */
const versionOptionsReady = ref(false)
/** 版本控件是否已激活(激活前用纯文本占位,不挂 el-select 组件树)。 */
const versionControlReady = ref(false)
/** el-select 实例引用(激活占位后聚焦并展开下拉)。 */
const versionSelect = ref<{ focus?: () => void }>()
const editing = computed({
  get: () => expandedDependency.value === props.name,
  set: (value: boolean) => expandedDependency.value = value ? props.name : '',
})

const state = usePackageCardState(props, config, ctx)
const status = usePackageCardStatus(state, t, editing)
const meta = usePackageCardMeta(state, t, editing, ctx, status.statusClass)
const visibility = usePackageVisibility({
  state,
  t,
  statusClass: status.statusClass,
  configText: meta.configText,
  sourceText: meta.sourceText,
  statusIcon: status.statusIcon,
  identityIcon: meta.identityIcon,
  detailText: status.detailText,
  editing,
})

// 模板按名消费,此处平铺解构(script setup 的绑定要求)
const {
  dep, local, localDependency, marketData, bundleRecord, displayName, data,
  latestVersion, pending, pendingRemove, updatable, bundlePackage, unconfigured, overrideValue,
} = state
const {
  statusClass, statusLabel, badgeIcon, currentText, targetText, targetLabel,
  detailText, compactStatusText, versionSourceText,
} = status
const {
  configText, sourceText, removeButtonText, requestText, identityIcon,
  identityText, cardStyle, summaryText, editToggleText,
} = meta
const {
  markIcon, showIdentityPill, showIdentityMeta, showStatusBadge, showConfigMeta, showSourceMeta,
  showTargetMeta, showDetailText, showVersionControl, showEditToggle, canExpandCard,
  showQuickUpdate, showInlineIgnoreUpdate, showRestoreUpdate, showConfigure, showBindLocal,
  showRemoveDependency, showCardActions, floatingActions,
} = visibility

const selectedVersion = computed({
  get() {
    if (pendingRemove.value) return removeValue
    if (overrideValue.value) return overrideValue.value
    return dep.value?.resolved ?? latestVersion.value ?? ''
  },
  set(value: string) {
    const override = getPendingOverrides()
    if (value === removeValue) {
      override[props.name] = ''
    } else if (value === dep.value?.resolved || !value && !dep.value) {
      delete override[props.name]
    } else {
      override[props.name] = value
    }
    state.setOverride(override)
  },
})

/** 版本下拉首次展开后才渲染全部版本选项(此前只显示当前值文本)。 */
function onVersionSelectVisible(visible: boolean) {
  if (visible) versionOptionsReady.value = true
}

/** 版本控件占位文本:与 el-select 的显示一致(移除标记转文案,空值退状态摘要)。 */
const versionPlaceholderText = computed(() => {
  if (pendingRemove.value) return t('dependencyCard.actions.remove')
  return selectedVersion.value || compactStatusText.value
})

/** 点击占位:挂载 el-select 并聚焦(automatic-dropdown 下聚焦即展开下拉)。 */
function activateVersionControl() {
  versionControlReady.value = true
  void nextTick(() => versionSelect.value?.focus?.())
}

// 卡片收起时回收 el-select,回到轻量占位(编辑态本身即激活条件)
watch(editing, (value) => {
  if (!value) versionControlReady.value = false
})

/** "恢复更新":清忽略规则与禁检名单并双写持久化。 */
function restoreUpdate() {
  const target: IgnoreUpdateTarget = {
    name: props.name,
    getUpdatePolicy: state.getUpdatePolicy,
    getUpdateIgnored: state.getUpdateIgnored,
  }
  void restoreIgnoreUpdate(target, config, t)
}

function toggleCardActions() {
  if (!canExpandCard.value) return
  if (bundlePackage.value) {
    openBundlePanel()
    return
  }
  editing.value = !editing.value
}

function toggleEdit() {
  if (bundlePackage.value) {
    openBundlePanel()
    return
  }
  editing.value = !editing.value
}

function openBundlePanel() {
  const entry = marketData.value
  if (entry) {
    activeBundle.value = entry
    return
  }
  activeBundle.value = {
    package: {
      name: props.name,
      version: dep.value?.resolved ?? local.value?.package.version ?? latestVersion.value ?? '',
      keywords: [],
    },
    shortname: displayName.value,
  } as SearchObject
}

function clearOverride() {
  const pendingBundle = pendingBundleUninstalls.value[props.name]
  const override = getPendingOverrides()
  delete override[props.name]
  for (const member of pendingBundle?.members ?? []) {
    delete override[member]
  }
  state.setOverride(override)
  delete pendingBundleUninstalls.value[props.name]
}

function removeDependency() {
  if (bundleRecord.value) {
    emit('open-bundle-uninstall', props.name)
    return
  }
  selectedVersion.value = removeValue
}

async function configure() {
  configuring.value = true
  try {
    await ensureInstalledConfig(ctx, props.name, false)
  } finally {
    configuring.value = false
  }
}

</script>

<style lang="scss" src="./package.scss"></style>

<style lang="scss" scoped src="./package-scoped.scss"></style>
