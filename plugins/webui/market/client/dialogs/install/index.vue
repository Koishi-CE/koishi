<template>
  <!-- 安装面板模板:头部/peer 列表/本地形态多视图切换,分支即面板形态 -->
  <!-- fallow-ignore-next-line complexity -->
  <el-dialog :model-value="!!active" @update:model-value="closePanel" :class="'install-panel'" destroy-on-close>
    <!-- 头部:包名(本地形态带标记) + 目标版本下拉(每项带红黄绿点) -->
    <template v-if="active" #header="{ titleId, titleClass }">
      <span :id="titleId" :class="titleClass">
        {{ active + (localSelection ? ` (${t('dependencyCard.current.local')})` : '') }}
      </span>
      <el-select
        v-if="data"
        v-model="selectVersion"
        class="market-version-select"
        :disabled="localSelection"
      >
        <el-option v-for="({ result }, version) in data" :key="version" :value="version">
          {{ version }}
          <template v-if="version === current">{{ t('dependencyCard.actions.current') }}</template>
          <span :class="[result, 'theme-color', 'dot-hint']"></span>
        </el-option>
      </el-select>
    </template>

    <!-- 警示区:弃用/不安全(红)、跨大版本升级(黄)、registry 拉取状态、已装但版本异常的修复提示 -->
    <k-comment class="danger" v-if="danger" type="danger">{{ danger }}</k-comment>
    <k-comment class="warning" v-if="warning" type="warning">{{ warning }}</k-comment>

    <div v-if="!data && active && !localSelection">
      <k-comment :type="registryStatus?.error ? 'danger' : 'info'">{{ registryStatusText }}</k-comment>
    </div>

    <k-comment v-if="store.dependencies?.[active] && !current" type="danger">
      {{ t('operations.install.installErrorHint') }}
    </k-comment>

    <!-- peer 兼容性表格:每个 peer 期望范围 vs 实际版本,不兼容的可就地改选版本 -->
    <el-scrollbar v-if="data?.[version] && Object.keys(data[version].peers).length" class="peer-table-scroll">
      <table class="peer-table">
        <colgroup>
          <col class="peer-name-col">
          <col class="peer-range-col">
          <col class="peer-current-col">
          <col class="peer-status-col">
        </colgroup>
        <thead>
          <tr>
            <th>{{ t('operations.install.peerName') }}</th>
            <th>{{ t('operations.install.peerRange') }}</th>
            <th>{{ t('operations.install.peerCurrent') }}</th>
            <th>{{ t('operations.install.peerAvailability') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(peer, name) in data[version].peers" :key="name">
            <td class="text-left">{{ name }}</td>
            <td>{{ peer.request }}</td>
            <td>
              <span class="wrapper" v-if="shouldShowPeerVersionSelect(peer, name)">
                <span class="shadow">{{ getVersion(name) || t('operations.install.select') }}</span>
                <el-select
                  class="frameless market-version-select"
                  :model-value="getVersion(name)"
                  @update:model-value="setVersion(name, $event)"
                >
                    <el-option value="">{{ t('dependencyCard.actions.remove') }}</el-option>
                  <el-option v-for="(_, version) in store.registry[name]" :key="version" :value="version">
                    {{ version }}
                    <template v-if="version === current">{{ t('dependencyCard.actions.current') }}</template>
                  </el-option>
                </el-select>
              </span>
              <span v-else class="peer-version" :class="{ workspace: !!getWorkspaceVersion(name), missing: !getPeerResolvedVersion(peer, name) }">
                {{ getPeerResolvedVersion(peer, name) || t('operations.confirm.notInstalled') }}
                <template v-if="getWorkspaceVersion(name)">{{ t('dependencyCard.current.workspace') }}</template>
              </span>
            </td>
            <td :class="['theme-color', peer.result]">
              <span class="inline-flex items-center gap-1">
                <k-icon :name="getResultIcon(peer.result)"></k-icon>
                {{ getResultText(peer, name) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </el-scrollbar>

    <!-- 操作栏:左侧批量模式开关;右侧按形态给 配置/移除/添加/卸载/安装-更新-修复 按钮 -->
    <template v-if="active && !global.static" #footer>
      <div class="left">
        <el-checkbox v-model="bulkMode">
          {{ t('operations.install.bulkMode') }}
          <k-hint>
            {{ t('operations.install.bulkModeHint') }}
          </k-hint>
        </el-checkbox>
      </div>
      <div class="right">
        <el-button v-if="local" type="primary" @click="configure()">{{ t('dependencyCard.actions.configure') }}</el-button>
        <template v-if="localSelection">
          <el-button v-if="showRemoveButton" @click="installDep('', true)" type="danger">{{ t('operations.install.remove') }}</el-button>
          <el-button v-else-if="workspace" @click="installDep(workspace)" type="success">{{ t('operations.install.add') }}</el-button>
        </template>
        <template v-else-if="data">
          <el-button v-if="showRemoveButton" @click="requestRemove()" type="danger">{{ t('operations.install.uninstall') }}</el-button>
          <el-button :type="result" @click="installDep(version)" :disabled="unchanged">
            {{ current ? t('operations.install.update') : store.dependencies?.[active] ? t('operations.install.repair') : t('operations.install.install') }}
          </el-button>
        </template>
      </div>
    </template>
  </el-dialog>

  <!-- 卸载询问弹窗:是否连带移除插件配置,可记住选择 -->
  <el-dialog v-model="showRemoveDialog" class="market-remove-dialog" destroy-on-close>
    {{ t('operations.install.removeConfigQuestion') }}
    <template #footer>
      <div class="left">
        <el-checkbox v-model="saveChoice">
          {{ t('operations.install.rememberChoice') }}
          <k-hint>
            {{ t('operations.install.rememberChoiceHint') }}
          </k-hint>
        </el-checkbox>
      </div>
      <div class="right">
        <el-button type="danger" @click="installDep('', false, true)">{{ t('operations.install.delete') }}</el-button>
        <el-button type="primary" @click="installDep('', false, false)">{{ t('operations.install.keep') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 合包卸载对话框:普通卸载遇到合包目标时转交到这里 -->
  <bundle-uninstall
    v-model="showBundleUninstallDialog"
    :package-name="bundleUninstallTarget"
    :record="bundleUninstallRecord"
  ></bundle-uninstall>
</template>

<script lang="ts" setup>
/**
 * @file 依赖安装/卸载面板(市场条目与依赖卡片共用的版本选择对话框)。
 *
 * 打开条件是 shared/plugin-config 的 active ref 有值(包名)。面板内:
 * 头部选目标版本,主体用 analyzeVersions 展示该版本 peerDependencies 的
 * 兼容性表格(每个 peer 可手动改选版本),底部按钮执行安装/更新/修复/卸载。
 * 卸载目标若是合包,转交 bundle-uninstall 对话框按成员粒度处理。
 *
 * 拆分:版本选择与 peer 分析在 use-install-versions,判定与警示文案在
 * use-install-decision,执行编排(批量 override/install/卸载询问)在
 * use-install-flow。
 */

import { computed, ref } from 'vue'
import { global, store, useConfig, useContext } from '@koishi-ce/client'
import { active } from '../../shared/plugin-config'
import BundleUninstall from '../bundle-uninstall/index.vue'
import { useMarketNextI18n } from '../../shared/i18n'
import { useInstallVersions } from './use-install-versions'
import { useInstallDecision } from './use-install-decision'
import { useInstallFlow } from './use-install-flow'

const ctx = useContext()
const config = useConfig()
const { t } = useMarketNextI18n()

const versionsState = useInstallVersions()
const {
  bulkMode, version, selectVersion, localSelection, data,
  getVersion, setVersion, shouldShowPeerVersionSelect, getPeerResolvedVersion,
} = versionsState

/** 合包卸载对话框的目标包名(flow 与 decision 共用,解开两者的相互依赖)。 */
const bundleUninstallTarget = ref('')
const decisionState = useInstallDecision(versionsState, t, bundleUninstallTarget, config)
const flowState = useInstallFlow(versionsState, decisionState.workspace, decisionState.dep, t, ctx, config)
const {
  current, local, workspace, unchanged, showRemoveButton, bundleUninstallRecord,
  registryStatus, registryStatusText, danger, warning, result, getResultIcon, getResultText,
} = decisionState
const {
  saveChoice, showRemoveDialog, showBundleUninstallDialog,
  closePanel, configure, installDep, requestRemove,
} = flowState

</script>

<style lang="scss" src="./index.scss"></style>
