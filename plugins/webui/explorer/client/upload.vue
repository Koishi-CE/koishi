<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <el-dialog v-model="showUploading" destroy-on-close>
    请将文件拖动到窗口内以上传。
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="uploading = null">取消</el-button>
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
import { uploading } from "./store";

const showUploading = computed({
	get: () => !!uploading.value,
	set: (v) => (uploading.value = null),
});

/** 遍历拖入/粘贴的数据项，把其中的文件读为 ArrayBuffer 后以 base64 写到目标目录。 */
function handleDataTransfer(event: Event, transfer: DataTransfer) {
	const prefix = uploading.value;
	for (const item of transfer.items) {
		if (item.kind !== "file") continue;
		event.preventDefault();
		const file = item.getAsFile();
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
	handleDataTransfer(event, event.dataTransfer);
});

// 粘贴：读取剪贴板中的文件（如截图）
useEventListener("paste", (event: ClipboardEvent) => {
	if (!uploading.value) return;
	handleDataTransfer(event, event.clipboardData);
});

// 阻止默认行为，否则浏览器会离开当前页面打开被拖入的文件
useEventListener("dragover", (event: DragEvent) => {
	if (!uploading.value) return;
	event.preventDefault();
});
</script>
