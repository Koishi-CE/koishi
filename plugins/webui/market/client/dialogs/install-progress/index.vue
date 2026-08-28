<template>
  <el-dialog
    v-model="installProgressState.visible"
    append-to-body
    :show-close="installProgressState.status !== 'running'"
    :before-close="handleBeforeClose"
    :class="'install-progress-dialog'"
    :title="installProgressState.title"
    width="min(800px, calc(100vw - 24px))"
  >
    <div class="progress-body">
      <!-- Status Banner -->
      <div :class="['status-banner', installProgressState.status]">
        <div class="status-indicator">
          <span v-if="installProgressState.status === 'running'" class="pulse-dot"></span>
          <market-icon v-else-if="installProgressState.status === 'success'" name="verified"></market-icon>
          <span v-else-if="installProgressState.status === 'error'" class="error-cross">×</span>
          <span>{{ statusText }}</span>
        </div>
      </div>

      <!-- Log Terminal -->
      <div class="terminal-container">
        <div class="terminal-header">
          <span class="term-title">{{ t('operations.progress.logTitle') }}</span>
        </div>
        <div class="terminal-viewport" ref="viewport">
          <div class="terminal-content">
            <template v-if="installProgressState.logs.length">
              <div
                v-for="(log, index) in installProgressState.logs"
                :key="index"
                :class="['log-line', log.type]"
              >
                <span class="line-prefix">$</span>
                <span class="line-text">{{ log.line }}</span>
              </div>
            </template>
            <div v-else class="empty-logs">
              <span class="loading-spinner"></span>
              {{ t('operations.progress.initializing') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <div v-if="installProgressState.fallbackCandidate" class="fallback-prompt">
          {{ t('operations.progress.fallbackPrefix') }}
          <strong>{{ installProgressState.fallbackCandidate.label }}</strong>
          {{ t('operations.progress.fallbackSuffix') }}
        </div>
        <el-button
          v-if="installProgressState.fallbackCandidate && installProgressState.retryFallback"
          type="primary"
          :loading="installProgressState.fallbackRunning"
          :disabled="installProgressState.fallbackRunning"
          @click="retryFallback"
        >
          {{ t('operations.progress.retryFallback') }}
        </el-button>
        <el-button
          :type="installProgressState.status === 'error' ? 'danger' : 'primary'"
          :disabled="installProgressState.status === 'running'"
          @click="close"
        >
          {{ installProgressState.status === 'running' ? t('operations.progress.executing') : t('operations.progress.close') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * @file 安装进度面板(终端风格日志窗口)。
 *
 * 纯展示组件:所有状态来自 shared/operations 的 installProgressState
 * (唯一状态源),install()/applyEnvironmentSnapshot()/bundle-install 都往
 * 里写。本组件负责状态横幅、日志终端(自动滚底)、fallback 镜像重试按钮
 * 与关闭控制(running 中禁止关闭)。由 app/pages.ts 全局挂载。
 */

import { useConfig } from "@koishi-ce/client";
import { computed, nextTick, ref, watch } from "vue";
import MarketIcon from "../../market/icons";
import { useMarketNextI18n } from "../../shared/i18n";
import { installProgressState } from "../../shared/operations";

const config = useConfig();
const { t } = useMarketNextI18n();

/** 日志视口元素引用,用于自动滚底。 */
const viewport = ref<HTMLElement>();

/** 状态横幅文案:按 环境回滚/自更新/普通安装 × running/success/error 组合取 i18n。 */
// 场景×状态的文案二维查表,switch/三元即映射表本身
// fallow-ignore-next-line complexity
const statusText = computed(() => {
	if (installProgressState.environmentRestore) {
		switch (installProgressState.status) {
			case "running":
				return t("operations.progress.runningEnvironment");
			case "success":
				return t("operations.progress.successEnvironment");
			case "error":
				return t("operations.progress.errorEnvironment");
			default:
				return t("operations.progress.ready");
		}
	}
	const selfUpdateText = installProgressState.selfUpdate;
	switch (installProgressState.status) {
		case "running":
			return selfUpdateText
				? t("operations.progress.runningSelf")
				: t("operations.progress.runningDependencies");
		case "success":
			return selfUpdateText
				? t("operations.progress.successSelf")
				: t("operations.progress.successDependencies");
		case "error":
			return selfUpdateText
				? t("operations.progress.errorSelf")
				: t("operations.progress.errorDependencies");
		default:
			return t("operations.progress.ready");
	}
});

// Auto-scroll logs to bottom
watch(
	() => installProgressState.logs.length,
	() => {
		nextTick(() => {
			if (!viewport.value) return;
			viewport.value.scrollTop = viewport.value.scrollHeight;
		});
	},
);

/** 关闭前拦截:running 状态下不允许关闭(点 X / 遮罩都走这里)。 */
function handleBeforeClose(done: () => void) {
	if (installProgressState.status !== "running") {
		done();
	}
}

/** 底部"关闭/执行中"按钮:仅在非 running 状态可点。 */
function close() {
	installProgressState.visible = false;
}

/** fallback 镜像重试按钮:执行 shared 挂上来的 retryFallback 回调。 */
function retryFallback() {
	void installProgressState.retryFallback?.();
}
</script>

<style lang="scss" src="./index.scss"></style>
