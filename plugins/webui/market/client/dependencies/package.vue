<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <article :class="['dep-card', item.kind]">
    <div class="dep-card-head">
      <div class="dep-card-title">
        <h3 :title="item.name">{{ shortName }}</h3>
        <span class="dep-sub">{{ item.name }}</span>
      </div>
      <div class="dep-card-badges">
        <span v-if="item.ignored" class="dep-badge ignored">{{ t("dependencies.card.ignoredBadge") }}</span>
        <span :class="['dep-badge', item.kind]">{{ kindLabel }}</span>
      </div>
    </div>

    <div class="dep-card-meta">
      <span class="dep-meta-item">
        <label>{{ t("dependencies.card.current") }}</label>
        <strong>{{ dep?.resolved ?? "—" }}</strong>
      </span>
      <span v-if="latest" class="dep-meta-item">
        <label>{{ t("dependencies.card.latest") }}</label>
        <strong>{{ latest }}</strong>
      </span>
      <span v-if="dep?.request" class="dep-meta-item">
        <label>{{ t("dependencies.card.range") }}</label>
        <strong>{{ dep.request }}</strong>
      </span>
    </div>

    <p v-if="statusText" :class="['dep-card-status', item.kind]">{{ statusText }}</p>

    <div v-if="actionable" class="dep-card-actions" @click.stop>
      <el-select
        v-if="versionControlReady && versionList.length"
        ref="versionSelect"
        v-model="selectedVersion"
        class="dep-version-select"
        automatic-dropdown
        @visible-change="onSelectVisible"
      >
        <el-option v-if="dep" value="" :label="t('dependencies.card.remove')""></el-option>
        <el-option v-for="version in versionList" :key="version" :value="version" :label="version">
          {{ version }}
          <template v-if="version === dep?.resolved">({{ t("dependencies.card.currentMark") }})</template>
        </el-option>
      </el-select>
      <button
        v-else-if="versionList.length"
        type="button"
        class="dep-version-placeholder"
        @click="activateSelect"
      >
        {{ placeholderText }}
      </button>
      <span v-else class="dep-version-placeholder static">{{ placeholderText }}</span>

      <div class="dep-card-buttons">
        <el-button v-if="item.kind === 'updatable' && latest" size="small" type="primary" @click="applyUpdate">
          {{ t("dependencies.card.update") }}
        </el-button>
        <el-button v-if="item.kind === 'updatable'" size="small" @click="ignoreUpdate">
          {{ t("dependencies.card.ignore") }}
        </el-button>
        <el-button v-if="change" size="small" @click="cancelChange">
          {{ t("dependencies.card.cancelChange") }}
        </el-button>
      </div>
    </div>
  </article>
</template>

<script lang="ts" setup>
/**
 * 依赖卡片:数百张在卡片墙中全量实例化,任何常驻重控件都会乘以
 * 卡片总数——版本下拉(el-select 含 popper 组件树)默认以纯文本
 * 占位,点击才挂载,收起即回收;「移除依赖」以下拉空值表达,不引入
 * 魔法哨兵字符串(编解码见 dependency-helpers)。
 */

import { store, useConfig } from "@koishi-ce/client";
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { DependencyItem } from "./dependency-groups.ts";
import {
	decodeOverrideEntry,
	getShortName,
} from "./dependency-helpers.ts";
import { resolveLatest } from "./ignore-policy.ts";

const props = defineProps<{ item: DependencyItem }>();

const emit = defineEmits<{
	/** 请求打开「忽略更新」对话框(页面级单例)。 */
	// biome-ignore lint/style/useShorthandFunctionType: 调用签名风格保证影子 vue-tsc 对事件参数的跨组件推断
	(event: "ignore", name: string): void;
}>();

const { t } = useI18n();
const config = useConfig();

const dep = computed(
	() => store.dependencies?.[props.item.name],
);
const change = computed(() =>
	decodeOverrideEntry(
		config.value.market.override?.[props.item.name],
	),
);

const versionList = computed(() =>
	Object.keys(store.registry?.[props.item.name] ?? {}),
);
const latest = computed(() =>
	resolveLatest(
		versionList.value,
		config.value.market.blockPrerelease ?? false,
	),
);

const kindLabel = computed(() =>
	t(`dependencies.filters.${props.item.kind}`),
);
const shortName = computed(() =>
	getShortName(props.item.name),
);

const statusText = computed(() => {
	if (change.value?.type === "remove")
		return t("dependencies.card.pendingRemove");
	if (change.value?.type === "set")
		return t("dependencies.card.pendingSet", {
			version: change.value.version,
		});
	if (props.item.fetching)
		return t("dependencies.card.fetching");
	if (props.item.kind === "error") {
		return dep.value?.error === "not-found"
			? t("dependencies.card.errorNotFound")
			: t("dependencies.card.errorNetwork");
	}
	return undefined;
});

/** local / invalid / 拉取中的卡片为纯信息卡,不渲染动作区。 */
const actionable = computed(() => {
	const kind = props.item.kind;
	return (
		kind !== "local" &&
		kind !== "invalid" &&
		!props.item.fetching
	);
});

const selectedVersion = computed({
	get() {
		if (change.value?.type === "remove") return "";
		if (change.value?.type === "set")
			return change.value.version;
		return dep.value?.resolved ?? latest.value ?? "";
	},
	set(value: string) {
		const override = (config.value.market.override ??= {});
		if (!value) {
			// 已装包选空值 = 移除依赖;待装包(快照无此条目)清空选择
			if (dep.value) {
				override[props.item.name] = "";
			} else {
				delete override[props.item.name];
			}
		} else if (value === dep.value?.resolved) {
			// 选回当前已装版本 = 撤销暂存变更
			delete override[props.item.name];
		} else {
			override[props.item.name] = value;
		}
	},
});

const versionControlReady = ref(false);
const versionSelect = ref<{ focus?: () => void }>();

const placeholderText = computed(() => {
	if (change.value?.type === "remove")
		return t("dependencies.card.remove");
	const value = selectedVersion.value;
	return value || kindLabel.value;
});

/** 点击占位:挂载 el-select 并聚焦(automatic-dropdown 下聚焦即展开)。 */
function activateSelect() {
	versionControlReady.value = true;
	void nextTick(() => versionSelect.value?.focus?.());
}

/** 下拉收起即回收组件树,回到轻量占位。 */
function onSelectVisible(visible: boolean) {
	if (!visible) versionControlReady.value = false;
}

function applyUpdate() {
	if (!latest.value) return;
	const override = (config.value.market.override ??= {});
	override[props.item.name] = latest.value;
}

/** 请求打开忽略更新对话框(事件转发经具名函数,规避内联 emit 的类型摩擦)。 */
function ignoreUpdate() {
	emit("ignore", props.item.name);
}

function cancelChange() {
	const override = config.value.market.override;
	if (override) delete override[props.item.name];
}
</script>
