<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <el-dialog
    :model-value="true"
    :title="t('dependencies.removeConfig.title')"
    width="26rem"
    append-to-body
    @update:model-value="$emit('close')"
  >
    <p>{{ t("dependencies.removeConfig.body") }}</p>
    <ul class="remove-config-list">
      <li v-for="name in names" :key="name">{{ name }}</li>
    </ul>
    <template #footer>
      <div class="remove-config-remember">
        <el-checkbox v-model="remember">
          {{ t("dependencies.removeConfig.remember") }}
          <k-hint>
            {{ t("dependencies.removeConfig.rememberHint") }}
          </k-hint>
        </el-checkbox>
      </div>
      <div class="remove-config-actions">
        <el-button type="danger" @click="confirm(true)">
          {{ t("dependencies.removeConfig.remove") }}
        </el-button>
        <el-button type="primary" @click="confirm(false)">
          {{ t("dependencies.removeConfig.keep") }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>


<script lang="ts" setup>
/**
 * 「是否同时删除配置」确认对话框:依赖页批量应用与市场页详情抽屉
 * (install.vue)共用,文案与 market.removeConfig 偏好键同源。
 *
 * 「记住我的选择」的写回在本组件内完成(语义与市场页一致:
 * boolean 写入偏好,undefined = 每次询问);父级经 confirm 事件拿到
 * 最终选择后自行执行安装与配置清理,本组件不触碰安装链。
 */

import { useConfig } from "@koishi-ce/client";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const emit = defineEmits<{
	(event: "close"): void;
	(event: "confirm", removeConfig: boolean): void;
}>();

// 影子 vue-tsc 对不接收返回值的 defineProps 类型参数不进 $props,须显式接收
const props = defineProps<{ names: string[] }>();

const { t } = useI18n();
const config = useConfig();

const remember = ref(false);

function confirm(removeConfig: boolean) {
	if (remember.value && config.value.market) {
		config.value.market.removeConfig = removeConfig;
	}
	emit("confirm", removeConfig);
}
</script>

<style lang="scss">
.remove-config-list {
	margin: 0.5rem 0 1rem;
	padding-left: 1.25rem;
	max-height: 10rem;
	overflow: auto;
	color: var(--fg1);
	font-size: 0.8125rem;
}

.el-dialog .remove-config-remember {
	margin-bottom: 0.75rem;
}

.el-dialog .remove-config-actions {
	display: flex;
	justify-content: flex-end;
	gap: 0.75rem;
}
</style>
