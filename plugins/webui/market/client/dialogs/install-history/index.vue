<template>
  <el-dialog
    v-model="showInstallHistory"
    append-to-body
    destroy-on-close
    :class="'install-history-dialog'"
    :title="t('operations.history.title')"
    width="min(1040px, calc(100vw - 24px))"
  >
    <!-- 顶部工具栏:记录数量/同步状态 + 刷新按钮 -->
    <div class="history-toolbar">
      <span>{{ loading ? t('operations.history.syncing') : t('operations.history.count', { count: entries.length }) }}</span>
      <el-button :loading="loading" @click="loadHistory(true)">{{ t('operations.history.refresh') }}</el-button>
    </div>

    <!-- 主体双栏:左侧记录列表,右侧选中记录明细 -->
    <div class="history-layout">
      <!-- 记录列表:状态点 + 标题/包名/时间 + 状态标签 -->
      <aside class="history-sidebar">
        <div class="list-heading">
          <span>{{ t('operations.history.records') }}</span>
          <span>{{ entries.length }}</span>
        </div>
        <div class="history-list" :class="{ loading }">
          <button
            v-for="entry in entries"
            :key="entry.id"
            type="button"
            :class="['history-row', { active: entry.id === selectedId }]"
            @click="selectEntry(entry.id)"
          >
            <span :class="['status-dot', entry.status]"></span>
            <span class="row-main">
              <span class="row-title">{{ historyTitle(entry) }}</span>
              <span class="row-packages">{{ historyPackages(entry) }}</span>
              <span class="row-meta">
                {{ formatDate(entry.startedAt) }}
                <template v-if="entry.duration != null"> · {{ formatDuration(entry.duration) }}</template>
              </span>
            </span>
            <span :class="['status-label', entry.status]">{{ statusText(entry.status) }}</span>
          </button>

          <div v-if="loading && !entries.length" class="history-state">{{ t('operations.history.reading') }}</div>
          <div v-else-if="loadError && !entries.length" class="history-state error">{{ loadError }}</div>
          <div v-else-if="!entries.length" class="history-state">{{ t('operations.history.empty') }}</div>
        </div>
      </aside>

      <!-- 记录明细:头部(状态/时间/复制日志) + 元信息 + 版本变更清单 -->
      <section class="history-detail">
        <div v-if="detailLoading" class="history-state">{{ t('operations.history.readingLog') }}</div>
        <div v-else-if="detailError" class="history-state error">{{ detailError }}</div>
        <template v-else-if="detail">
          <header class="detail-header">
            <div class="detail-title">
              <div class="detail-status">
                <span :class="['status-dot', detail.status]"></span>
                <span :class="['status-label', detail.status]">{{ statusText(detail.status) }}</span>
              </div>
              <h3>{{ historyTitle(detail) }}</h3>
              <p>
                {{ formatDate(detail.startedAt) }}
                <template v-if="detail.duration != null"> · {{ formatDuration(detail.duration) }}</template>
              </p>
            </div>
            <div class="detail-actions">
              <el-button size="small" @click="copyLog">{{ t('operations.history.copyLog') }}</el-button>
            </div>
          </header>

          <dl class="detail-meta">
            <div><dt>{{ t('operations.history.dependencyCount') }}</dt><dd>{{ detail.changes.length || t('operations.history.unknown') }}</dd></div>
            <div><dt>{{ t('operations.history.source') }}</dt><dd :title="detail.installEndpoint">{{ formatEndpoint(detail.installEndpoint) }}</dd></div>
            <div><dt>{{ t('operations.history.logSize') }}</dt><dd>{{ formatSize(detail.size) }}</dd></div>
          </dl>

          <section v-if="detail.changes.length" class="versions-section">
            <div class="section-heading">
              <span>{{ t('operations.history.versionChanges') }}</span>
              <span>{{ t('operations.history.items', { count: detail.changes.length }) }}</span>
            </div>
            <div class="change-list">
              <div v-for="change in detail.changes" :key="change.name" class="change-row">
                <strong :title="change.name">{{ change.name }}</strong>
                <span class="version-value" :title="beforeVersion(change)">
                  <span class="version-text">{{ beforeVersion(change) }}</span>
                </span>
                <span class="version-arrow">→</span>
                <span class="version-value after" :title="afterVersion(change)">
                  <span class="version-text">{{ afterVersion(change) }}</span>
                </span>
              </div>
            </div>
          </section>

          <p v-if="detail.truncated" class="truncated-note">{{ t('operations.history.truncated') }}</p>
        </template>
        <div v-else class="history-state">{{ t('operations.history.selectRecord') }}</div>
      </section>
    </div>

    <template #footer>
      <el-button @click="showInstallHistory = false">{{ t('operations.history.close') }}</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * @file 安装历史对话框(只读回放)。
 *
 * 左侧为最近 20 条安装记录列表(状态点 + 标题 + 耗时),右侧展示选中记录的
 * 明细:元信息、版本变更清单、完整包管理器日志(可复制)。数据全部来自
 * market/install-history 与 market/install-history-detail 两个 RPC。
 * 由 app/pages.ts 全局挂载,开关是 shared/operations 导出的 showInstallHistory。
 *
 * 关键设计:明细请求用自增 serial 标记,快速切换记录时丢弃过期响应。
 */

import { message, send, useConfig } from "@koishi-ce/client";
import type {
	InstallHistoryChange,
	InstallHistoryEntry,
	InstallLogDetail,
} from "@koishi-ce/plugin-marketn/shared";
import { computed, ref, watch } from "vue";
import { endpointHost } from "../../shared/format";
import { useMarketNextI18n } from "../../shared/i18n";
import { showInstallHistory } from "../../shared/operations";

const config = useConfig();
const { t, locale } = useMarketNextI18n();
/** 安装记录列表(左侧栏数据源)。 */
const entries = ref<InstallHistoryEntry[]>([]);
/** 当前选中的记录 id。 */
const selectedId = ref("");
/** 选中记录的明细(含完整日志)。 */
const detail = ref<InstallLogDetail>();
/** 列表加载中/明细加载中/各自错误文案。 */
const loading = ref(false);
const detailLoading = ref(false);
const loadError = ref("");
const detailError = ref("");
/** 明细请求序号:响应携带过期序号时丢弃,防止快速切换记录时旧响应覆盖新状态。 */
let detailSerial = 0;

/** 对话框打开时拉取最近 20 条安装记录。 */
watch(showInstallHistory, (visible) => {
	if (visible) void loadHistory();
});

/** 拉取记录列表并默认选中第一条;preserveSelection 供刷新时保住当前选择。 */
// 列表加载与默认选中链:优先级回退(上次选择>首条)即语义
// fallow-ignore-next-line complexity
async function loadHistory(preserveSelection = false) {
	if (loading.value) return;
	loading.value = true;
	loadError.value = "";
	try {
		const result = await (send("market/install-history", 20) ??
			Promise.resolve([]));
		entries.value = result ?? [];
		const target =
			preserveSelection &&
			entries.value.some((entry) => entry.id === selectedId.value)
				? selectedId.value
				: entries.value[0]?.id || "";
		if (target) {
			await selectEntry(target, true);
		} else {
			selectedId.value = "";
			detail.value = undefined;
		}
	} catch (error) {
		console.error(error);
		loadError.value = t("operations.history.loadFailed");
	} finally {
		loading.value = false;
	}
}

/** 拉取选中记录的明细(含日志全文);force 用于强制重拉。 */
// 明细拉取的串号守卫流程:serial 校验贯穿每个 await 之后,拆分会打散竞态防护
// fallow-ignore-next-line complexity
async function selectEntry(id: string, force = false) {
	if (!force && id === selectedId.value && detail.value) return;
	selectedId.value = id;
	detail.value = undefined;
	detailError.value = "";
	detailLoading.value = true;
	const serial = ++detailSerial;
	try {
		const result = await (send("market/install-history-detail", id) ??
			Promise.resolve(undefined));
		if (serial !== detailSerial) return;
		if (!result) throw new Error("install log not found");
		detail.value = result;
	} catch (error) {
		if (serial !== detailSerial) return;
		console.error(error);
		detailError.value = t("operations.history.detailFailed");
	} finally {
		if (serial === detailSerial) detailLoading.value = false;
	}
}

/** 复制完整日志:优先 Clipboard API,非安全上下文降级为隐藏 textarea + execCommand。 */
async function copyLog() {
	if (!detail.value?.content) return;
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(detail.value.content);
		} else {
			const textarea = document.createElement("textarea");
			textarea.value = detail.value.content;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand("copy");
			textarea.remove();
		}
		message.success(t("operations.history.copied"));
	} catch (error) {
		console.error(error);
		message.error(t("operations.history.copyFailed"));
	}
}

/** 记录状态文案:进行中/成功/失败/未知。 */
function statusText(status: InstallHistoryEntry["status"]) {
	switch (status) {
		case "running":
			return t("operations.history.statusRunning");
		case "success":
			return t("operations.history.statusSuccess");
		case "error":
			return t("operations.history.statusError");
		default:
			return t("operations.history.statusUnknown");
	}
}

/** 列表行标题:按变更统计生成"安装 N/更新 N/卸载 N";单一类别只显示该类别,混合显示"变更 N 项"。 */
// 变更统计到标题文案的分支映射:计数循环与文案拼装同属一个展示语义
// fallow-ignore-next-line complexity
function historyTitle(entry: InstallHistoryEntry) {
	if (!entry.changes.length) return t("operations.history.operation");
	let installed = 0;
	let removed = 0;
	let updated = 0;
	for (const change of entry.changes) {
		if (!change.beforeRequest && change.afterRequest) installed++;
		else if (change.beforeRequest && !change.afterRequest) removed++;
		else updated++;
	}
	const groups = [
		installed && t("operations.history.install", { count: installed }),
		updated && t("operations.history.update", { count: updated }),
		removed && t("operations.history.uninstall", { count: removed }),
	].filter(Boolean);
	if (groups.length === 1) return groups[0];
	return t("operations.history.changed", { count: entry.changes.length });
}

/** 列表行副标题:参与变更的包名列表(无变更记录时回退原始 deps 字段)。 */
function historyPackages(entry: InstallHistoryEntry) {
	if (!entry.changes.length) return entry.deps;
	return entry.changes
		.map((change) => change.name)
		.join(t("common.format.listSeparator"));
}

/** 变更行"变更前"版本:优先实际解析版本,其次请求范围,都没有则显示"未安装"。 */
function beforeVersion(change: InstallHistoryChange) {
	return (
		change.beforeResolved ||
		change.beforeRequest ||
		t("operations.history.notInstalled")
	);
}

/** 变更行"变更后"版本:同上,空值表示已卸载。 */
function afterVersion(change: InstallHistoryChange) {
	return (
		change.afterResolved ||
		change.afterRequest ||
		t("operations.history.uninstalled")
	);
}

/** 时间戳转本地可读时间;非法/缺失值显示"时间未知"。 */
function formatDate(value: number) {
	if (!Number.isFinite(value) || value <= 0)
		return t("operations.history.unknownTime");
	return new Date(value).toLocaleString(locale.value);
}

/** 毫秒耗时人性化:<1s 显示 ms,<1min 显示秒,否则"分+秒"。 */
function formatDuration(value: number) {
	if (value < 1000) return `${Math.max(0, Math.round(value))} ms`;
	if (value < 60000)
		return t("common.time.seconds", {
			count: (value / 1000).toFixed(value < 10000 ? 1 : 0),
		});
	const minutes = Math.floor(value / 60000);
	const seconds = Math.round((value % 60000) / 1000);
	return t("common.time.minutesSeconds", { minutes, seconds });
}

/** 安装端点展示:只取 host;未记录端点显示"默认源"。 */
function formatEndpoint(endpoint?: string) {
	if (!endpoint) return t("operations.history.defaultSource");
	return endpointHost(endpoint);
}

/** 日志体积:B/KB/MB 自适应。 */
function formatSize(value: number) {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<style lang="scss" src="./index.scss"></style>
