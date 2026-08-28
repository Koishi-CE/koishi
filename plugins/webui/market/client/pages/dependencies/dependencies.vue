<template>
  <k-layout main="page-deps" menu="dependencies">
    <!-- 顶部工具栏:过滤下拉 / 预发布屏蔽 / 搜索框 / 分类计数摘要 -->
    <div class="deps-toolbar">
      <div class="deps-toolbar-row">
        <el-select v-model="filter" size="small" class="deps-filter-select">
          <el-option
            v-for="option in filterOptions"
            :key="option.value"
            :value="option.value"
            :label="option.label + (option.count ? ' (' + option.count + ')' : '')"
          >
            <span class="deps-filter-option">
              <market-icon :name="option.icon"></market-icon>
              <span>{{ option.label }}</span>
              <span v-if="option.count" class="deps-filter-count">({{ option.count }})</span>
            </span>
          </el-option>
        </el-select>
        <button
          :class="['deps-filter', 'deps-prerelease-toggle', { active: prereleaseBlocked }]"
          @click="togglePrereleaseFilter"
        >
          <market-icon name="tag"></market-icon>
          <span>{{ t('dependencies.toolbar.blockPreview') }}</span>
        </button>
        <div class="deps-search">
          <el-input ref="searchInput" v-model="keyword" clearable :placeholder="t('dependencies.toolbar.searchPlaceholder')"></el-input>
        </div>
        <div class="deps-summary">
          <span v-if="summary.pending" class="primary">{{ t('dependencies.filters.pending') }} {{ summary.pending }}</span>
          <span v-if="summary.updatable" class="success">{{ t('dependencies.filters.updatable') }} {{ summary.updatable }}</span>
          <span v-if="summary.unconfigured" class="warning">{{ t('dependencies.filters.unconfigured') }} {{ summary.unconfigured }}</span>
          <span v-if="summary.errors" class="danger">{{ t('dependencies.filters.error') }} {{ summary.errors }}</span>
          <span v-if="summary.invalid" class="warning">{{ t('dependencies.filters.invalid') }} {{ summary.invalid }}</span>
          <span v-if="refreshing" class="loading">{{ t('dependencies.toolbar.loading') }}</span>
        </div>
      </div>
    </div>

    <!-- 依赖分组列表:每组可折叠头 + 卡片网格 -->
    <el-scrollbar class="body-container">
      <div class="deps-content" :class="{ pending: summary.pending }">
        <template v-if="visibleGroups.length">
          <section v-for="group in visibleGroups" :key="group.key" :class="['deps-group', group.key, { collapsed: group.collapsed }]">
            <header
              :class="['deps-group-header', { collapsible: group.collapsible }]"
              :role="group.collapsible ? 'button' : undefined"
              :tabindex="group.collapsible ? 0 : undefined"
              :aria-expanded="group.collapsible ? String(!group.collapsed) : undefined"
              @click="group.collapsible && toggleGroup(group.key)"
              @keydown.enter.prevent="group.collapsible && toggleGroup(group.key)"
              @keydown.space.prevent="group.collapsible && toggleGroup(group.key)"
            >
              <div>
                <h2>
                  <market-icon :name="group.icon"></market-icon>
                  <span>{{ group.label }}</span>
                </h2>
                <p>{{ group.description }}</p>
              </div>
              <div class="deps-group-side">
                <span class="deps-group-count">{{ group.items.length }}</span>
                <market-icon
                  v-if="group.collapsible"
                  :class="['deps-group-chevron', { collapsed: group.collapsed }]"
                  name="asc"
                ></market-icon>
              </div>
            </header>
            <div v-if="!group.collapsed" class="deps-grid">
              <!-- v-memo:registry 微批/过滤重算导致父级重渲时,值未变的卡片
                   直接复用 vnode,跳过数百卡的重建与 diff;卡片自身订阅的
                   响应式数据(store.registry/override/展开态)变化不受影响 -->
              <package-view
                v-for="item in group.items"
                :key="item.name"
                v-memo="[item.name, item.kind]"
                :name="item.name"
                :kind="item.kind"
                @open-ignore="openIgnore"
                @open-binding="openBinding"
                @open-bundle-uninstall="openBundleUninstall"
              ></package-view>
            </div>
          </section>
        </template>
        <k-empty v-else>{{ t('dependencies.empty') }}</k-empty>
      </div>
    </el-scrollbar>
  </k-layout>

  <!-- 底部批量应用栏:有待应用变更时浮出,确认动作转交 confirm.vue -->
  <div v-if="summary.pending" :class="'deps-apply-bar'">
    <div>
      <strong>{{ t('dependencies.apply.count', { count: summary.pending }) }}</strong>
      <span>{{ t('dependencies.apply.description') }}</span>
    </div>
    <div class="deps-apply-actions">
      <el-button @click="clearChanges">{{ t('dependencies.apply.discard') }}</el-button>
      <el-button type="primary" @click="showConfirm = true">{{ t('dependencies.apply.apply') }}</el-button>
    </div>
  </div>

  <!-- 手动添加依赖对话框(本地包上传 / registry 查询两个页签) -->
  <manual-install/>

  <!-- 页面级单例对话框:数百张卡片共享一份实例,目标包状态由 use-dependency-dialogs 持有 -->
  <ignore-update-dialog
    v-if="ignoreTarget"
    ref="ignoreDialog"
    :display-name="ignoreDisplayName"
    :latest-version="ignoreLatestVersion"
    :target="ignoreTarget"
    :config="config"
  ></ignore-update-dialog>

  <local-binding-dialog
    v-if="bindingTargetName"
    ref="bindingDialog"
    :name="bindingTargetName"
    :display-name="bindingDisplayName"
  ></local-binding-dialog>

  <bundle-uninstall
    v-model="showBundleUninstall"
    :package-name="bundleUninstallTargetName"
    :record="bundleUninstallRecord"
  ></bundle-uninstall>
</template>

<script lang="ts" setup>
/**
 * @file 依赖管理页面(/dependencies 路由主体)。
 *
 * 汇总展示宿主全部依赖,逐包分类后按固定顺序分组成卡片墙;支持过滤下拉、
 * 预发布屏蔽开关、Ctrl+K 聚焦搜索与分组折叠记忆。
 * 存在待应用变更时底部浮出批量应用栏(确认动作交给全局 confirm.vue)。
 *
 * 拆分:包名全集与元数据预取在 use-dependency-names,分类与计数在
 * use-dependency-classify,分组/过滤视图在 use-dependency-groups,
 * classify 状态机与基础判定在 dependency-helpers。
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { message, router, useConfig, useContext } from '@koishi-ce/client'
import { useMarketNextI18n } from '../../shared/i18n'
import { getLatestVersion, getMarketNextConfig, getPendingOverrides, getWritableMarketNextPolicy, patchMarketNextConfig, patchMarketNextData } from '../../shared/plugin-config'
import { showConfirm } from '../../shared/operations'
import ManualInstall from './manual.vue'
import PackageView from './package.vue'
import IgnoreUpdateDialog from './ignore-update-dialog.vue'
import LocalBindingDialog from './local-binding-dialog.vue'
import BundleUninstall from '../../dialogs/bundle-uninstall/index.vue'
import MarketIcon from '../../market/icons'
import { getUpdatePolicy } from './dependency-helpers'
import { useDependencyNames } from './use-dependency-names'
import { useDependencyClassify } from './use-dependency-classify'
import { useDependencyGroups, type FilterKey } from './use-dependency-groups'
import { useDependencyDialogs } from './use-dependency-dialogs'

const config = useConfig()
const ctx = useContext()
const { t } = useMarketNextI18n()
/** 搜索关键字 / 当前过滤项 / 搜索框引用(Ctrl+K 聚焦用)。 */
const keyword = ref('')
const filter = ref<FilterKey>('all')
const searchInput = ref<{ focus?: () => void }>()

const { names, disposeNamesWatcher } = useDependencyNames(ctx, config)
const { items, updates, prereleaseBlocked, summary, refreshing } = useDependencyClassify(ctx, config, names)
const { filterOptions, toggleGroup, visibleGroups } = useDependencyGroups(items, summary, keyword, filter, t)
const {
  ignoreDialog, ignoreTarget, ignoreDisplayName, ignoreLatestVersion,
  bindingDialog, bindingTargetName, bindingDisplayName,
  showBundleUninstall, bundleUninstallTargetName, bundleUninstallRecord,
  openIgnore, openBinding, openBundleUninstall,
} = useDependencyDialogs(config)

/** 注册/注销全局 Ctrl+K 搜索快捷键。 */
onMounted(() => {
  window.addEventListener('keydown', onSearchShortcut)
})

onBeforeUnmount(() => {
  disposeNamesWatcher()
  window.removeEventListener('keydown', onSearchShortcut)
})

/** Ctrl/Cmd+K:仅在依赖页路由上拦截并聚焦搜索框。 */
function onSearchShortcut(event: KeyboardEvent) {
  if (router.currentRoute.value?.path !== '/dependencies') return
  if (event.key.toLowerCase() !== 'k') return
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  searchInput.value?.focus?.()
}

/** 丢弃全部待应用变更(底部应用栏"放弃")。 */
function clearChanges() {
  const override = getPendingOverrides()
  for (const key of Object.keys(override)) delete override[key]
  void patchMarketNextData({ override: { ...override } })
}

/** 切换"屏蔽预发布版本"策略并持久化;保存失败时回滚本地状态。 */
async function togglePrereleaseFilter() {
  const policy = getWritableMarketNextPolicy(config.value)
  const previous = !!policy.updateIgnorePrerelease
  policy.updateIgnorePrerelease = !previous
  const saved = await patchMarketNextConfig({ updateIgnorePrerelease: policy.updateIgnorePrerelease })
  if (!saved) {
    policy.updateIgnorePrerelease = previous
    message.error(t('common.messages.saveFailed'))
  }
}

/** 页级"全部升级"动作:把每个可更新包的最新版暂存进 override,待批量确认。 */
ctx.action('dependencies.upgrade', {
  disabled: () => !updates.value.length,
  async action() {
    for (const name of updates.value) {
      const version = getLatestVersion(name, getUpdatePolicy(config.value))
      if (!version) continue
      getPendingOverrides()[name] = version
    }
    void patchMarketNextData({ override: { ...getPendingOverrides() } })
  },
})

</script>

<style lang="scss" src="./dependencies.scss"></style>
