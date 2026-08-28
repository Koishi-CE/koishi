<template>
  <el-dialog
    v-model="showEnvironmentVersions"
    append-to-body
    destroy-on-close
    :class="'environment-versions-dialog'"
    :title="t('environment.title')"
    width="min(1080px, calc(100vw - 24px))"
  >
    <!-- 顶部工具栏:快照数量/同步状态 + 刷新按钮 -->
    <div class="environment-toolbar">
      <span>{{ loading ? t('environment.syncing') : t('environment.count', { count: snapshots.length }) }}</span>
      <el-button :loading="loading" @click="loadSnapshots(true)">{{ t('environment.refresh') }}</el-button>
    </div>

    <!-- 主体双栏:左侧快照列表,右侧选中快照的 diff 预览 -->
    <div class="environment-layout">
      <!-- 快照列表(含"当前环境"伪快照,当前项带徽标) -->
      <aside class="snapshot-sidebar">
        <div class="snapshot-heading">
          <span>{{ t('environment.snapshots') }}</span>
          <span>{{ snapshots.length }}</span>
        </div>
        <div class="snapshot-list">
          <button
            v-for="snapshot in snapshots"
            :key="snapshot.id"
            type="button"
            :class="['snapshot-row', { active: snapshot.id === selectedId, current: snapshot.current }]"
            @click="selectSnapshot(snapshot.id)"
          >
            <span class="snapshot-icon">
              <market-icon :name="snapshot.current ? 'verified' : 'file-archive'"></market-icon>
            </span>
            <span class="snapshot-main">
              <strong>{{ snapshot.current ? t('environment.currentEnvironment') : t('environment.savedEnvironment') }}</strong>
              <span>{{ formatDate(snapshot.createdAt) }}</span>
              <small>{{ sourceText(snapshot.source) }} · {{ t('environment.dependencies', { count: snapshot.dependencyCount }) }}</small>
            </span>
            <span v-if="snapshot.current" class="current-pill">{{ t('environment.current') }}</span>
          </button>

          <div v-if="loading && !snapshots.length" class="environment-state">{{ t('environment.reading') }}</div>
          <div v-else-if="loadError && !snapshots.length" class="environment-state error">{{ loadError }}</div>
          <div v-else-if="!snapshots.length" class="environment-state">{{ t('environment.empty') }}</div>
        </div>
      </aside>

      <!-- 预览详情:头部摘要 + 范围警告 + 依赖 diff 列表 -->
      <section class="snapshot-detail">
        <div v-if="previewLoading" class="environment-state">{{ t('environment.readingPreview') }}</div>
        <div v-else-if="previewError" class="environment-state error">{{ previewError }}</div>
        <template v-else-if="preview">
          <header class="preview-header">
            <div>
              <span class="preview-eyebrow">{{ t('environment.targetEnvironment') }}</span>
              <h3>{{ preview.snapshot.current ? t('environment.currentEnvironment') : formatDate(preview.snapshot.createdAt) }}</h3>
              <p>{{ sourceText(preview.snapshot.source) }} · {{ t('environment.dependencies', { count: preview.snapshot.dependencyCount }) }}</p>
            </div>
            <div class="preview-summary">
              <span class="changed">{{ t('environment.changedCount', { count: changedCount }) }}</span>
              <span>{{ t('environment.unchangedCount', { count: unchangedCount }) }}</span>
              <span v-if="preview.unsupportedCount" class="blocked">{{ t('environment.unsupportedCount', { count: preview.unsupportedCount }) }}</span>
            </div>
          </header>

          <k-comment type="warning" class="scope-warning">
            {{ t('environment.scopeWarning') }}
          </k-comment>

          <div class="diff-list">
            <div class="diff-header">
              <span>{{ t('environment.dependency') }}</span>
              <span>{{ t('environment.currentVersion') }}</span>
              <span></span>
              <span>{{ t('environment.targetVersion') }}</span>
              <span>{{ t('environment.status') }}</span>
            </div>
            <div v-for="change in orderedChanges" :key="change.name" :class="['diff-row', change.status]">
              <strong :title="change.name">{{ change.name }}</strong>
              <span class="version-value" :title="versionText(change.currentVersion)">{{ versionText(change.currentVersion) }}</span>
              <span class="version-arrow">→</span>
              <span class="version-value target" :title="versionText(change.targetVersion)">{{ versionText(change.targetVersion) }}</span>
              <span :class="['change-status', change.status]">{{ statusText(change.status) }}</span>
              <small v-if="change.reason" class="change-reason">{{ reasonText(change.reason) }}</small>
            </div>
          </div>
        </template>
        <div v-else class="environment-state">{{ t('environment.selectSnapshot') }}</div>
      </section>
    </div>

    <template #footer>
      <el-button @click="showEnvironmentVersions = false">{{ t('common.actions.close') }}</el-button>
      <el-button type="primary" :disabled="!canApply" @click="confirmVisible = true">
        {{ preview?.snapshot.current ? t('environment.alreadyCurrent') : t('environment.restore') }}
      </el-button>
    </template>
  </el-dialog>

  <!-- 回滚二次确认:提示可执行变更数与移除警告 -->
  <el-dialog
    v-model="confirmVisible"
    append-to-body
    :class="'environment-confirm-dialog'"
    :title="t('environment.confirmTitle')"
    width="min(520px, calc(100vw - 24px))"
  >
    <p>{{ t('environment.confirmText', { count: preview?.actionableCount ?? 0 }) }}</p>
    <k-comment type="warning">{{ t('environment.scopeWarning') }}</k-comment>
    <k-comment v-if="removedCount" type="danger">
      {{ t('environment.removeWarning', { count: removedCount }) }}
    </k-comment>
    <template #footer>
      <el-button @click="confirmVisible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" @click="applySnapshot">{{ t('environment.confirmRestore') }}</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * @file 环境版本快照对话框(查看/回滚)。
 *
 * 左侧快照列表(含"当前环境"伪快照),右侧展示选中快照与当前环境的依赖
 * diff 预览;确认后调 shared/operations 的 applyEnvironmentSnapshot() 走
 * market/environment-snapshot-apply 回滚。由 app/pages.ts 全局挂载,
 * 开关是 shared/operations 导出的 showEnvironmentVersions。
 *
 * 关键设计:预览请求用自增 serial 标记,响应回来时若已有更新的请求则丢弃,
 * 避免快速切换快照时旧响应覆盖新状态。
 */
import { computed, ref, watch } from "vue";
import { send, useConfig } from "@koishi-ce/client";
import type {
	EnvironmentChangeStatus,
	EnvironmentSnapshotChange,
	EnvironmentSnapshotPreview,
	EnvironmentSnapshotSource,
	EnvironmentSnapshotSummary,
} from "@koishi-ce/plugin-marketn/shared";
import {
	applyEnvironmentSnapshot,
	showEnvironmentVersions,
} from "../../shared/operations";
import { useMarketNextI18n } from "../../shared/i18n";
import MarketIcon from "../../market/icons";

const config = useConfig();
const { t, locale } = useMarketNextI18n();
/** 快照摘要列表(左侧栏数据源)。 */
const snapshots = ref<EnvironmentSnapshotSummary[]>([]);
/** 当前选中的快照 id。 */
const selectedId = ref("");
/** 选中快照的 diff 预览结果。 */
const preview = ref<EnvironmentSnapshotPreview>();
/** 列表加载中/预览加载中/各自错误文案。 */
const loading = ref(false);
const previewLoading = ref(false);
const loadError = ref("");
const previewError = ref("");
/** 二次确认弹窗开关。 */
const confirmVisible = ref(false);
/** 预览请求序号:响应携带过期序号时丢弃,防止快速切换快照时旧响应覆盖新状态。 */
let previewSerial = 0;

/** 对话框打开时拉取快照列表;关闭时收起二次确认弹窗。 */
watch(showEnvironmentVersions, (visible) => {
	if (visible) void loadSnapshots();
	else confirmVisible.value = false;
});

/** diff 行排序权重:不支持 > 移除 > 降级 > 升级 > 新增 > 版本变化 > 未变化,同级按包名。 */
const statusOrder: Record<EnvironmentChangeStatus, number> = {
	unsupported: 0,
	removed: 1,
	downgrade: 2,
	upgrade: 3,
	added: 4,
	changed: 5,
	unchanged: 6,
};

/** 预览变更按上述权重排序后的展示列表。 */
const orderedChanges = computed(() =>
	[...(preview.value?.changes ?? [])].sort((left, right) => {
		return (
			statusOrder[left.status] - statusOrder[right.status] ||
			left.name.localeCompare(right.name)
		);
	}),
);

/** 变更数/未变更数/将被移除数,驱动头部摘要与二次确认里的移除警告。 */
const changedCount = computed(
	() =>
		preview.value?.changes.filter((change) => change.status !== "unchanged")
			.length ?? 0,
);
const unchangedCount = computed(
	() =>
		preview.value?.changes.filter((change) => change.status === "unchanged")
			.length ?? 0,
);
const removedCount = computed(
	() =>
		preview.value?.changes.filter((change) => change.status === "removed")
			.length ?? 0,
);
/** 可回滚条件:有预览、目标不是当前环境、存在可执行变更且无不受支持的变更。 */
const canApply = computed(
	() =>
		!!preview.value &&
		!preview.value.snapshot.current &&
		preview.value.actionableCount > 0 &&
		preview.value.unsupportedCount === 0,
);

/** 拉取快照列表并选中默认项(优先非当前的最近快照);preserveSelection 供刷新时保住当前选择。 */
// 快照列表加载与默认选中链:优先级回退(上次选择>非当前>首个)即语义
// fallow-ignore-next-line complexity
async function loadSnapshots(preserveSelection = false) {
	if (loading.value) return;
	loading.value = true;
	loadError.value = "";
	try {
		snapshots.value = await (send("market/environment-snapshots") ??
			Promise.resolve([]));
		const previous =
			preserveSelection &&
			snapshots.value.some((snapshot) => snapshot.id === selectedId.value)
				? selectedId.value
				: "";
		const target =
			previous ||
			snapshots.value.find((snapshot) => !snapshot.current)?.id ||
			snapshots.value[0]?.id ||
			"";
		if (target) await selectSnapshot(target, true);
		else {
			selectedId.value = "";
			preview.value = undefined;
		}
	} catch (error) {
		console.error(error);
		loadError.value = t("environment.loadFailed");
	} finally {
		loading.value = false;
	}
}

/** 请求选中快照的 diff 预览;force 用于强制重拉(同一快照默认有缓存则跳过)。 */
// 预览拉取的串号守卫流程:serial 校验贯穿每个 await 之后,拆分会打散竞态防护
// fallow-ignore-next-line complexity
async function selectSnapshot(id: string, force = false) {
	if (!force && id === selectedId.value && preview.value) return;
	selectedId.value = id;
	preview.value = undefined;
	previewError.value = "";
	previewLoading.value = true;
	const serial = ++previewSerial;
	try {
		const result = await (send("market/environment-snapshot-preview", id) ??
			Promise.resolve(undefined));
		if (serial !== previewSerial) return;
		if (!result) throw new Error("environment snapshot not found");
		preview.value = result;
	} catch (error) {
		if (serial !== previewSerial) return;
		console.error(error);
		previewError.value = t("environment.previewFailed");
	} finally {
		if (serial === previewSerial) previewLoading.value = false;
	}
}

/** 执行回滚:检测本插件自身是否也在变更列表里(是则按自更新场景传参),交给 applyEnvironmentSnapshot。 */
function applySnapshot() {
	if (!canApply.value || !preview.value) return;
	const id = preview.value.snapshot.id;
	const selfUpdate = preview.value.changes.some((change) => {
		return (
			change.name === "@koishi-ce/plugin-marketn" &&
			change.status !== "unchanged"
		);
	});
	confirmVisible.value = false;
	void applyEnvironmentSnapshot(id, selfUpdate);
}

/** 时间戳转本地可读时间;非法/缺失值显示"时间未知"。 */
function formatDate(value: number) {
	if (!Number.isFinite(value) || value <= 0)
		return t("common.messages.timeUnknown");
	return new Date(value).toLocaleString(locale.value);
}

/** 快照来源文案:启动时自动保存/安装操作后保存/外部(手动等)。 */
function sourceText(source: EnvironmentSnapshotSource) {
	switch (source) {
		case "startup":
			return t("environment.sourceStartup");
		case "operation":
			return t("environment.sourceOperation");
		default:
			return t("environment.sourceExternal");
	}
}

/** 版本号缺省时展示"未安装"。 */
function versionText(version?: string) {
	return version || t("environment.notInstalled");
}

function statusText(status: EnvironmentChangeStatus) {
	return t(`environment.change.${status}`);
}

function reasonText(reason: NonNullable<EnvironmentSnapshotChange["reason"]>) {
	return t(`environment.reason.${reason}`);
}
</script>

<style lang="scss" src="./index.scss"></style>
