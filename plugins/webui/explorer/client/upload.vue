<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <el-dialog v-model="showUploading" destroy-on-close>
    {{ t('explorer.upload.hint') }}
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="uploading = null">{{ t('explorer.picker.cancel') }}</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * 全局上传对话框：uploading 非空时显示提示，
 * 接管整个窗口的 drop / paste 事件，把文件以 base64 写入目标目录。
 */
import { Binary, send } from "@koishi-ce/client";
import { useEventListener } from "@vueuse/core";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { uploading } from "./store";

const { t } = useI18n();

const showUploading = computed({
	get: () => !!uploading.value,
	// 关闭弹窗一律终止上传流程，setter 入参无用；为保持签名位置而下划线化
	set: (_v) => (uploading.value = null),
});

/** 遍历拖入/粘贴的数据项，把其中的文件读为 ArrayBuffer 后以 base64 写到目标目录。 */
function handleDataTransfer(
	event: Event,
	transfer: DataTransfer,
) {
	const prefix = uploading.value;
	// DataTransferItemList 未声明迭代器，经 ArrayLike 形态拷成数组再遍历
	for (const item of Array.from(transfer.items)) {
		if (item.kind !== "file") continue;
		event.preventDefault();
		// kind 为 file 时 getAsFile 正常返回非空;null 仅作防御跳过
		const file = item.getAsFile();
		if (!file) continue;
		const reader = new FileReader();
		reader.addEventListener(
			"load",
			() => {
				void send(
					"explorer/write",
					prefix + file.name,
					Binary.toBase64(reader.result as ArrayBuffer),
					true,
				);
			},
			false,
		);
		reader.readAsArrayBuffer(file);
	}
	uploading.value = null;
}

// 拖拽释放：读取拖入的文件
useEventListener("drop", (event: DragEvent) => {
	if (!uploading.value) return;
	// dataTransfer 可能为 null（异常拖拽），无载荷时无需处理
	if (event.dataTransfer)
		handleDataTransfer(event, event.dataTransfer);
});

// 粘贴：读取剪贴板中的文件（如截图）
useEventListener("paste", (event: ClipboardEvent) => {
	if (!uploading.value) return;
	// clipboardData 可能为 null（部分浏览器无剪贴板数据），无载荷时无需处理
	if (event.clipboardData)
		handleDataTransfer(event, event.clipboardData);
});

// 阻止默认行为，否则浏览器会离开当前页面打开被拖入的文件
useEventListener("dragover", (event: DragEvent) => {
	if (!uploading.value) return;
	event.preventDefault();
});
</script>
