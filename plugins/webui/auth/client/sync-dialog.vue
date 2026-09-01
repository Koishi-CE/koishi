<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <el-dialog
    class="sync-dialog"
    @close="config.sync ??= false"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    v-model="showSyncDialog">
    <p class="text-center">检测到你本地的配置与云端不同步，是否同步配置？</p>
    <el-button-group class="text-center">
      <el-button @click="setMode('upload')">上传当前配置</el-button>
      <el-button @click="setMode('download')">下载云端配置</el-button>
      <el-button @click="setMode()">关闭配置同步</el-button>
    </el-button-group>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * 配置同步冲突对话框：本地配置与云端（用户配置）不一致时弹出，
 * 由用户选择上传本地、下载云端或关闭同步。对话框不可点击遮罩关闭，
 * 强制用户做出选择（关闭即视为关闭同步）。
 */
import {
	type Config,
	message,
	send,
	store,
	useConfig,
} from "@koishi-ce/client";
import { shared, showSyncDialog } from "./utils";

const config = useConfig();

/** 处理用户选择：关闭同步；upload 上传本地配置，download 用云端覆盖本地。 */
async function setMode(value?: "upload" | "download") {
	shared.value.sync = !!value;
	showSyncDialog.value = false;
	if (!value) return;
	if (value === "download") {
		// 云端 user.config 服务端透传存储,此处按客户端配置形状收窄使用
		config.value = store.user.config as Config;
		return;
	}
	try {
		await send("user/update", { config: config.value });
	} catch (e) {
		message.error(e.message);
	}
}
</script>

<style lang="scss" scoped>

.el-button-group.text-center {
  display: flex;
  justify-content: center;
}

</style>
