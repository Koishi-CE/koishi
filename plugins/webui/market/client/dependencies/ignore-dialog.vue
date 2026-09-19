<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <el-dialog
    :model-value="true"
    :title="t('dependencies.ignore.title', { name: getShortName(name) })"
    width="28rem"
    append-to-body
    @update:model-value="$emit('close')"
  >
    <el-radio-group v-model="preset" class="dep-ignore-options">
      <el-radio value="version" :disabled="!latest">
        {{ t("dependencies.ignore.version", { version: latest ?? "—" }) }}
      </el-radio>
      <el-radio value="days7">{{ t("dependencies.ignore.days7") }}</el-radio>
      <el-radio value="days30">{{ t("dependencies.ignore.days30") }}</el-radio>
      <el-radio value="forever">{{ t("dependencies.ignore.forever") }}</el-radio>
    </el-radio-group>
    <template #footer>
      <el-button @click="$emit('close')">{{ t("dependencies.ignore.cancel") }}</el-button>
      <el-button type="primary" @click="confirm">{{ t("dependencies.ignore.confirm") }}</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * 「忽略更新」对话框(页面级单例,卡片经 open-ignore 事件唤起)。
 * 确认后把规则写入 config.market.ignoreUpdates,由 console 的
 * 配置同步机制持久化;预发布屏蔽等判定见 ignore-policy。
 */

import { store, useConfig } from "@koishi-ce/client";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getShortName } from "./dependency-helpers.ts";
import {
	createIgnoreRule,
	type IgnorePreset,
} from "./ignore-policy.ts";

const props = defineProps<{ name: string }>();

const emit = defineEmits<(event: "close") => void>();

const { t } = useI18n();
const config = useConfig();

/** 目标包当前生效的最新版本(规则构造与「忽略此版本」选项消费)。 */
const latest = computed(
	() => store.dependencies?.[props.name]?.latest,
);

const preset = ref<IgnorePreset>("version");

function confirm() {
	const rules = (config.value.market.ignoreUpdates ??= {});
	rules[props.name] = createIgnoreRule(
		preset.value,
		latest.value,
	);
	emit("close");
}
</script>
