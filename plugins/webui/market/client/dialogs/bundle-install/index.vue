<template>
  <el-dialog
    :model-value="!!activeBundle"
    append-to-body
    align-center
    :class="'bundle-install-panel'"
    width="min(880px, calc(100vw - 24px))"
    destroy-on-close
    @update:model-value="close"
  >
    <!-- 头部 hero:图标 + 合包标题(带 bundle 徽标) + 包名/版本 -->
    <template #header>
      <div class="bundle-hero">
        <div class="bundle-hero-icon">
          <k-icon name="cube"></k-icon>
        </div>
        <div class="bundle-hero-text">
          <div class="bundle-hero-title">
            <span>{{ title }}</span>
            <span class="bundle-badge">
              <market-icon name="file-archive"></market-icon>
              {{ t('bundle.label') }}
            </span>
          </div>
          <div v-if="activeBundle" class="bundle-hero-meta">
            <span>{{ activeBundle.package.name }}</span>
            <span class="dot">·</span>
            <span>{{ bundleVersion }}</span>
          </div>
        </div>
      </div>
    </template>

    <template v-if="activeBundle">
      <!-- 加载/错误态:清单拉取中转圈,失败展示红色错误 -->
      <div v-if="loading" class="bundle-loading">
        <span class="bundle-loading-spinner"></span>
        {{ t('bundle.loading') }}
      </div>
      <k-comment v-else-if="error" type="danger">
        <p>{{ error }}</p>
      </k-comment>

      <template v-else-if="bundle">
        <p v-if="bundle.description" class="bundle-description">{{ bundle.description }}</p>

        <!-- Stats row: visual progress + counts -->
        <div class="bundle-stats">
          <div class="bundle-stat">
            <span class="bundle-stat-num">{{ selectedMembers.length }}</span>
            <span class="bundle-stat-label">{{ t('bundle.stats.selected', { count: selectedMembers.length, total: members.length }) }}</span>
            <div class="bundle-stat-bar"><div class="bundle-stat-fill" :style="{ width: progressPercent + '%' }"></div></div>
          </div>
          <div class="bundle-stat">
            <span class="bundle-stat-num">{{ presetList.length }}</span>
            <span class="bundle-stat-label">{{ t('bundle.stats.presets') }}</span>
          </div>
          <div class="bundle-stat">
            <span class="bundle-stat-num">{{ moveList.length }}</span>
            <span class="bundle-stat-label">{{ t('bundle.stats.moved') }}</span>
          </div>
        </div>

        <k-comment v-if="validationErrors.length" type="danger">
          <p v-for="item in validationErrors" :key="item">{{ item }}</p>
        </k-comment>
        <k-comment v-if="validationWarnings.length" type="warning">
          <p v-for="item in validationWarnings" :key="item">{{ item }}</p>
        </k-comment>

        <!-- Global Bulk Operations Row -->
        <div class="bundle-bulk-row" v-if="selectedMembers.length">
          <span class="bulk-label">{{ t('bundle.bulk.label') }}</span>
          <button class="bundle-section-action" @click="batchSetCreateConfig(true)">{{ t('bundle.bulk.createAll') }}</button>
          <span class="bundle-section-spacer">|</span>
          <button class="bundle-section-action" @click="batchSetCreateConfig(false)">{{ t('bundle.bulk.skipAll') }}</button>
          <template v-if="selectedMembers.some(m => hasPreset(m))">
            <span class="bundle-section-spacer">|</span>
            <button class="bundle-section-action" @click="batchSetUsePreset(true)">{{ t('bundle.bulk.enablePresets') }}</button>
            <span class="bundle-section-spacer">|</span>
            <button class="bundle-section-action" @click="batchSetUsePreset(false)">{{ t('bundle.bulk.disablePresets') }}</button>
          </template>
        </div>

        <!-- Required members section -->
        <template v-if="requiredMembers.length">
          <div class="bundle-section-title">
            <k-icon name="check-full"></k-icon>
            {{ t('bundle.members.required') }} <span class="bundle-section-count">{{ requiredMembers.length }}</span>
          </div>
          <div class="bundle-member-list">
            <section
              v-for="member in requiredMembers"
              :key="member.package + ':' + member.plugin"
              :class="['bundle-member required', { selected: member.selected }]"
            >
              <div class="member-row">
                <div :class="['member-icon', 'cat-' + memberCategory(member.package)]">
                  <market-icon :name="'outline:' + memberCategory(member.package)"></market-icon>
                </div>
                <div class="member-main">
                  <div class="member-line">
                    <span class="member-name">{{ formatShortname(member.package) }}</span>
                    <span class="member-version">{{ member.version }}</span>
                    <span
                      v-for="tag in riskTags(member)"
                      :key="tag.label"
                      :class="['member-risk', tag.type]"
                    >{{ tag.label }}</span>
                  </div>
                  <div class="member-sub">
                    <span class="member-fullname">{{ member.package }}</span>
                    <span class="dot">·</span>
                    <span>{{ getInstalledText(member.package) }}</span>
                  </div>
                  <p v-if="getPackageDescription(member.package)" class="member-desc">
                    {{ getPackageDescription(member.package) }}
                  </p>
                </div>
                <div class="member-side">
                  <span class="member-required-pill">
                    <k-icon name="lock"></k-icon>
                    {{ t('bundle.members.requiredPill') }}
                  </span>
                </div>
              </div>

              <div class="member-options" v-if="member.selected" @click.stop>
                <el-checkbox v-model="member.createConfig" :disabled="member.conflict === 'same-group'">{{ t('bundle.members.createConfig') }}</el-checkbox>
                <el-checkbox
                  v-if="member.conflict === 'other-config'"
                  v-model="member.move"
                >{{ t('bundle.members.moveConfig') }}</el-checkbox>
                <el-checkbox v-model="member.usePreset" :disabled="!member.createConfig || member.move || !hasPreset(member)">{{ t('bundle.members.usePreset') }}</el-checkbox>
              </div>

              <!-- Conflict Warning Comments -->
              <k-comment v-if="member.conflict === 'package-mismatch' && member.selected" type="danger" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.version', { current: store.dependencies?.[member.package]?.resolved, range: member.version }) }}</p>
              </k-comment>

              <k-comment v-if="member.conflict === 'other-config' && member.selected" type="warning" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.config') }}</p>
              </k-comment>

              <k-comment v-if="member.conflict === 'same-group' && member.selected" type="info" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.sameGroup') }}</p>
              </k-comment>

              <!-- Sensitive fields in-place editing -->
              <div v-if="member.selected && member.usePreset && sensitiveFields(member).length" class="sensitive-fields-editor" @click.stop>
                <div class="editor-title">{{ t('bundle.editor.sensitive') }}</div>
                <div class="editor-grid">
                  <div v-for="field in sensitiveFields(member)" :key="field" class="editor-field-row">
                    <span class="field-label">{{ field }}:</span>
                    <el-input
                      size="small"
                      v-model="member.config[field]"
                      :placeholder="t('bundle.editor.placeholder', { field })"
                      show-password
                    ></el-input>
                  </div>
                </div>
              </div>

              <details v-if="hasPreset(member) && member.selected" class="member-config" @click.stop>
                <summary>{{ t('bundle.editor.viewPreset') }}</summary>
                <div class="json-editor-container">
                  <textarea
                    class="raw-json-editor"
                    :value="formatConfig(member.config)"
                    @input="onJsonInput(member, $event.target.value)"
                    rows="8"
                  ></textarea>
                  <div v-if="memberJsonErrors[getMemberKey(member)]" class="json-error-text">
                    {{ t('bundle.editor.jsonError', { error: memberJsonErrors[getMemberKey(member)] }) }}
                  </div>
                </div>
              </details>
            </section>
          </div>
        </template>

        <!-- Optional members section -->
        <template v-if="optionalMembers.length">
          <div class="bundle-section-title">
            <k-icon name="info-full"></k-icon>
            {{ t('bundle.members.optional') }} <span class="bundle-section-count">{{ optionalMembers.length }}</span>
            <button class="bundle-section-action" @click="toggleAllOptional">
              {{ allOptionalSelected ? t('bundle.members.optionalToggleNone') : t('bundle.members.optionalToggleAll') }}
            </button>
          </div>
          <div class="bundle-member-list">
            <section
              v-for="member in optionalMembers"
              :key="member.package + ':' + member.plugin"
              :class="['bundle-member optional', { selected: member.selected }]"
              role="checkbox"
              :aria-checked="String(member.selected)"
              tabindex="0"
              @click="toggleMember(member)"
              @keydown.enter.prevent="toggleMember(member)"
              @keydown.space.prevent="toggleMember(member)"
            >
              <div class="member-row">
                <el-checkbox :model-value="member.selected" @click.stop @change="toggleMember(member)" class="member-check"></el-checkbox>
                <div :class="['member-icon', 'cat-' + memberCategory(member.package)]">
                  <market-icon :name="'outline:' + memberCategory(member.package)"></market-icon>
                </div>
                <div class="member-main">
                  <div class="member-line">
                    <span class="member-name">{{ formatShortname(member.package) }}</span>
                    <span class="member-version">{{ member.version }}</span>
                    <span
                      v-for="tag in riskTags(member)"
                      :key="tag.label"
                      :class="['member-risk', tag.type]"
                    >{{ tag.label }}</span>
                  </div>
                  <div class="member-sub">
                    <span class="member-fullname">{{ member.package }}</span>
                    <span class="dot">·</span>
                    <span>{{ getInstalledText(member.package) }}</span>
                  </div>
                  <p v-if="getPackageDescription(member.package)" class="member-desc">
                    {{ getPackageDescription(member.package) }}
                  </p>
                </div>
              </div>

              <div class="member-options" v-if="member.selected" @click.stop>
                <el-checkbox v-model="member.createConfig" :disabled="member.conflict === 'same-group'">{{ t('bundle.members.createConfig') }}</el-checkbox>
                <el-checkbox
                  v-if="member.conflict === 'other-config'"
                  v-model="member.move"
                >{{ t('bundle.members.moveConfig') }}</el-checkbox>
                <el-checkbox v-model="member.usePreset" :disabled="!member.createConfig || member.move || !hasPreset(member)">{{ t('bundle.members.usePreset') }}</el-checkbox>
              </div>

              <!-- Conflict Warning Comments -->
              <k-comment v-if="member.conflict === 'package-mismatch' && member.selected" type="danger" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.version', { current: store.dependencies?.[member.package]?.resolved, range: member.version }) }}</p>
              </k-comment>

              <k-comment v-if="member.conflict === 'other-config' && member.selected" type="warning" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.config') }}</p>
              </k-comment>

              <k-comment v-if="member.conflict === 'same-group' && member.selected" type="info" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.sameGroup') }}</p>
              </k-comment>

              <!-- Sensitive fields in-place editing -->
              <div v-if="member.selected && member.usePreset && sensitiveFields(member).length" class="sensitive-fields-editor" @click.stop>
                <div class="editor-title">{{ t('bundle.editor.sensitive') }}</div>
                <div class="editor-grid">
                  <div v-for="field in sensitiveFields(member)" :key="field" class="editor-field-row">
                    <span class="field-label">{{ field }}:</span>
                    <el-input
                      size="small"
                      v-model="member.config[field]"
                      :placeholder="t('bundle.editor.placeholder', { field })"
                      show-password
                    ></el-input>
                  </div>
                </div>
              </div>

              <details v-if="hasPreset(member) && member.selected" class="member-config" @click.stop>
                <summary>{{ t('bundle.editor.viewPreset') }}</summary>
                <div class="json-editor-container">
                  <textarea
                    class="raw-json-editor"
                    :value="formatConfig(member.config)"
                    @input="onJsonInput(member, $event.target.value)"
                    rows="8"
                  ></textarea>
                  <div v-if="memberJsonErrors[getMemberKey(member)]" class="json-error-text">
                    {{ t('bundle.editor.jsonError', { error: memberJsonErrors[getMemberKey(member)] }) }}
                  </div>
                </div>
              </details>
            </section>
          </div>
        </template>

        <!-- Diff: visualized -->
        <div class="bundle-diff">
          <div class="bundle-diff-title">{{ t('bundle.diff.title') }}</div>
          <div class="bundle-diff-grid">
            <div class="bundle-diff-cell">
              <div class="bundle-diff-head"><k-icon name="cube"></k-icon> {{ t('bundle.diff.install') }} <strong>{{ installList.length }}</strong></div>
              <div class="bundle-diff-tags">
                <span v-for="item in installList" :key="item" class="bundle-diff-tag install">{{ item }}</span>
              </div>
            </div>
            <div class="bundle-diff-cell" v-if="configList.length || presetList.length">
              <div class="bundle-diff-head"><k-icon name="settings"></k-icon> {{ t('bundle.diff.config') }} <strong>{{ configList.length }}</strong></div>
              <div class="bundle-diff-tags">
                <span v-for="item in configList" :key="item" :class="['bundle-diff-tag config', { 'with-preset': presetList.includes(item) }]">
                  {{ item }}
                  <span v-if="presetList.includes(item)" class="preset-marker">{{ t('bundle.diff.preset') }}</span>
                </span>
              </div>
            </div>
            <div class="bundle-diff-cell" v-if="moveList.length">
              <div class="bundle-diff-head"><k-icon name="arrow-right"></k-icon> {{ t('bundle.diff.move') }} <strong>{{ moveList.length }}</strong></div>
              <div class="bundle-diff-tags">
                <span v-for="item in moveList" :key="item" class="bundle-diff-tag move">{{ item }}</span>
              </div>
            </div>
            <div class="bundle-diff-cell" v-if="skippedConfigList.length">
              <div class="bundle-diff-head"><k-icon name="info-full"></k-icon> {{ t('bundle.diff.skip') }} <strong>{{ skippedConfigList.length }}</strong></div>
              <div class="bundle-diff-tags">
                <span v-for="item in skippedConfigList" :key="item" class="bundle-diff-tag skip">{{ item }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- 底部操作栏:取消 / 安装(带勾选数,不可用时禁用) -->
    <template #footer>
      <el-button @click="close">{{ t('bundle.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="installing" :disabled="!canInstall" @click="confirmInstall">
        {{ t('bundle.actions.install') }} <span v-if="selectedMembers.length" class="footer-count">({{ selectedMembers.length }})</span>
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * @file 合包(bundle)安装对话框。
 *
 * 打开条件是 shared/operations 的 activeBundle ref 有值(市场页点开合包条目)。
 * 拉取 registry 元数据解析目标版本的 koishi.bundle 清单,把成员分成
 * 必装/可选两组逐个勾选;每个成员可决定 是否创建配置/使用预置配置/把组外
 * 配置移入分组,并展示与本地现状的三类冲突(same-group/other-config/
 * package-mismatch)。底部以 diff 网格汇总安装/配置/移动/跳过清单。
 *
 * 拆分:成员加载与勾选在 use-bundle-members,diff 清单与校验在
 * use-bundle-diff,安装执行在 use-bundle-install,展示辅助在 bundle-format。
 */

import { computed } from "vue";
import { store, useConfig } from "@koishi-ce/client";
import { activeBundle } from "../../shared/operations";
import { formatShortname } from "../../market/utils";
import MarketIcon from "../../market/icons";
import { useI18nText } from "@koishi-ce/client";
import { useMarketNextI18n } from "../../shared/i18n";
import {
	formatConfig,
	getInstalledText as installedStatusText,
	getPackageDescription as pickDescription,
	hasPreset,
	memberCategory,
	riskTags as collectRiskTags,
	sensitiveFields,
} from "./bundle-format";
import { useBundleMembers } from "./use-bundle-members";
import { useBundleDiff } from "./use-bundle-diff";
import { useBundleInstall } from "./use-bundle-install";

const config = useConfig();
const { t } = useMarketNextI18n();
const tt = useI18nText();

const membersState = useBundleMembers(t);
const diffState = useBundleDiff(membersState, t);
const installState = useBundleInstall(membersState, diffState, t);

// 模板按名消费,此处平铺解构(script setup 的绑定要求)
const {
	loading,
	error,
	bundle,
	members,
	memberJsonErrors,
	selectedMembers,
	requiredMembers,
	optionalMembers,
	allOptionalSelected,
	getMemberKey,
	onJsonInput,
	toggleMember,
	toggleAllOptional,
	batchSetCreateConfig,
	batchSetUsePreset,
} = membersState;
const {
	title,
	bundleVersion,
	validationErrors,
	validationWarnings,
	progressPercent,
	installList,
	configList,
	moveList,
	presetList,
	skippedConfigList,
} = diffState;
const { installing, canInstall, close, confirmInstall } = installState;

/** 展示辅助桥:把 tt/t 注入纯函数,保持模板调用名不变。 */
function getPackageDescription(name: string) {
	return pickDescription(name, tt);
}
function getInstalledText(name: string) {
	return installedStatusText(name, t);
}
function riskTags(member: any) {
	return collectRiskTags(member, t);
}
</script>

<style lang="scss" src="./index.scss"></style>
