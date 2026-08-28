<template>
  <!-- 本地包上传面板:隐藏 file input + 拖拽区(空闲/上传中/预览三态) + 脚本警告 -->
  <section class="local-package-panel" :aria-busy="busy">
    <input
      ref="fileInput"
      class="local-package-input"
      type="file"
      accept=".tgz,application/gzip,application/x-gzip"
      @change="onFileInput"
    >
    <div
      :class="['local-package-dropzone', { dragging, busy, ready: !!preview, failed: !!error }]"
      role="button"
      tabindex="0"
      :aria-disabled="busy"
      @click="openFilePicker"
      @keydown.enter.prevent="openFilePicker"
      @keydown.space.prevent="openFilePicker"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <template v-if="preview">
        <div class="local-package-preview-icon" aria-hidden="true">
          <market-icon name="file-archive"></market-icon>
        </div>
        <div class="local-package-preview-main">
          <div class="local-package-preview-heading">
            <strong>{{ preview.name }}</strong>
            <span class="local-package-operation">
              {{ t(`operations.manual.operation.${preview.operation}`) }}
            </span>
          </div>
          <div class="local-package-version-change">
            <span>{{ preview.currentVersion || t('operations.manual.notInstalled') }}</span>
            <k-icon name="arrow-right"></k-icon>
            <strong>{{ preview.version }}</strong>
          </div>
          <p v-if="preview.description">{{ preview.description }}</p>
          <div class="local-package-meta">
            <span>{{ preview.filename }}</span>
            <span>{{ formatBytes(preview.size) }}</span>
            <span>SHA-256 {{ preview.hash.slice(0, 12) }}</span>
          </div>
        </div>
      </template>
      <template v-else-if="uploading">
        <div class="local-package-upload-icon uploading" aria-hidden="true">
          <k-icon name="market-next:upload"></k-icon>
        </div>
        <strong>{{ t('operations.manual.uploading') }}</strong>
        <span class="local-package-filename">{{ selectedFilename }}</span>
        <el-progress :percentage="uploadProgress" :stroke-width="8" :show-text="false"></el-progress>
        <small>{{ formatBytes(uploadedBytes) }} / {{ formatBytes(selectedSize) }}</small>
      </template>
      <template v-else>
        <div class="local-package-upload-icon" aria-hidden="true">
          <k-icon name="market-next:upload"></k-icon>
        </div>
        <strong>{{ t('operations.manual.dropTitle') }}</strong>
        <span>{{ t('operations.manual.dropHint') }}</span>
        <small>{{ t('operations.manual.dropLimit') }}</small>
      </template>
    </div>

    <p class="local-package-status" aria-live="polite">
      <span v-if="error" class="local-package-error" role="alert">{{ error }}</span>
      <span v-else-if="uploading">{{ t('operations.manual.uploading') }} {{ uploadProgress }}%</span>
    </p>

    <k-comment v-if="preview?.scripts.length" type="warning" class="local-package-script-warning">
      <p>{{ t('operations.manual.scriptWarning', { scripts: preview.scripts.join(', ') }) }}</p>
    </k-comment>
  </section>
</template>

<script lang="ts" setup>
/**
 * @file 本地包上传的展示组件(纯 UI,manual.vue 的 local 页签)。
 *
 * 只负责交互与展示:文件选择(点击/键盘/拖拽,仅接受单个 .tgz)、上传
 * 进度、服务端预检结果(包名/版本变化/哈希/安装脚本警告)。真正的上传
 * 状态机在 use-local-package-upload.ts,本组件通过 props 接收、把
 * select/error 事件抛回去。
 */
import type { LocalPackageUploadPreview } from "@koishi-ce/plugin-marketn/shared";
import { ref } from "vue";
import { useMarketNextI18n } from "../../shared/i18n";
import MarketIcon from "../../market/icons";

const props = defineProps<{
	busy: boolean;
	error: string;
	preview?: LocalPackageUploadPreview;
	selectedFilename: string;
	selectedSize: number;
	uploadedBytes: number;
	uploading: boolean;
	uploadProgress: number;
}>();

const emit = defineEmits<{
	error: [message: string];
	select: [file: File];
}>();

const { t } = useMarketNextI18n();
/** 隐藏 file input 的元素引用。 */
const fileInput = ref<HTMLInputElement>();
/** 拖拽高亮状态;dragDepth 计数避免子元素 dragleave 误熄高亮。 */
const dragging = ref(false);
let dragDepth = 0;

/** 点击/键盘打开系统文件选择器(busy 时禁用)。 */
function openFilePicker() {
	if (props.busy) return;
	fileInput.value?.click();
}

/** file input 的 change 处理:取首个文件后立即清空 value(允许重复选同一文件)。 */
function onFileInput(event: Event) {
	const target = event.target as HTMLInputElement;
	const file = target.files?.[0];
	target.value = "";
	if (file) emit("select", file);
}

/** dragenter 计数 +1 并点亮高亮。 */
function onDragEnter() {
	if (props.busy) return;
	dragDepth++;
	dragging.value = true;
}

/** dragleave 计数 -1,归零才熄灭高亮。 */
function onDragLeave() {
	dragDepth = Math.max(0, dragDepth - 1);
	if (!dragDepth) dragging.value = false;
}

/** drop 处理:只接受单个文件,多选报错,单个抛 select 事件。 */
function onDrop(event: DragEvent) {
	dragDepth = 0;
	dragging.value = false;
	if (props.busy) return;
	const files = [...(event.dataTransfer?.files ?? [])];
	if (files.length !== 1) {
		emit("error", t("operations.manual.singleFile"));
		return;
	}
	emit("select", files[0]);
}

/** 字节数人性化:B/KiB/MiB 自适应。 */
function formatBytes(value: number) {
	if (!value) return "0 B";
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024)
		return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KiB`;
	return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}
</script>

<style lang="scss" scoped src="./local-package-upload.scss"></style>
