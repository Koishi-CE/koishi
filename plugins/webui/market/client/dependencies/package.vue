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
      <!-- 分类信息由所在分组的词头承载(分组与分类一一对应),卡片不再重复渲染;
           「已忽略」与分组正交,保留徽标 -->
      <div class="dep-card-badges">
        <span v-if="item.ignored" class="dep-badge ignored">{{ t("dependencies.card.ignoredBadge") }}</span>
      </div>
    </div>

    <div class="dep-card-meta">
      <span class="dep-meta-item">
        <label>{{ t("dependencies.card.current") }}</label>
        <strong>{{ currentLabel }}</strong>
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

    <!-- unconfigured 卡为纯信息卡:不渲染版本下拉与卸载(传递依赖不可从根
         清单移除;暂存版本会把包升格成直接依赖,语义混乱),只提供「添加
         配置」入口——ensure 会创建一份配置并跳转,文案与「配置」区分 -->
    <div v-if="item.kind === 'unconfigured'" class="dep-card-actions" @click.stop>
      <el-button size="small" type="primary" @click="addConfig">
        {{ t("dependencies.card.addConfig") }}
      </el-button>
    </div>

    <div v-if="actionable" class="dep-card-actions" @click.stop>
      <el-select
        v-if="versionControlReady && versionList.length"
        ref="versionSelect"
        v-model="selectedVersion"
        class="dep-version-select"
        automatic-dropdown
        @visible-change="onSelectVisible"
      >
        <el-option v-if="dep" value="" :label="t('dependencies.card.remove')"></el-option>
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
        <el-button v-if="hasConfig" size="small" @click="configure">
          {{ t("dependencies.card.configure") }}
        </el-button>
        <el-button v-if="dep" size="small" type="danger" plain @click="uninstall">
          {{ t("dependencies.card.uninstall") }}
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
 * 魔法哨兵字符串(编解码见 dependency-helpers)。卸载/配置等
 * el-button 为轻组件,常驻渲染不违背懒挂载的性能约束。
 */

import {
	store,
	useConfig,
	useContext,
} from "@koishi-ce/client";
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { DependencyItem } from "./dependency-groups.ts";
import {
	decodeOverrideEntry,
	getAliasTarget,
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
const ctx = useContext();

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
	if (props.item.kind === "alias" && dep.value?.request) {
		return t("dependencies.card.aliasHint", {
			target: getAliasTarget(dep.value.request) ?? "—",
		});
	}
	return undefined;
});

/** local / alias / invalid / unconfigured / 拉取中的卡片为纯信息卡,不渲染动作区。 */
const actionable = computed(() => {
	const kind = props.item.kind;
	return (
		kind !== "local" &&
		kind !== "alias" &&
		kind !== "invalid" &&
		kind !== "unconfigured" &&
		!props.item.fetching
	);
});

/** 「当前」展示值:unconfigured 卡无快照条目,退显本地已下载版本。 */
const currentLabel = computed(() => {
	if (dep.value?.resolved) return dep.value.resolved;
	if (props.item.kind === "unconfigured") {
		return (
			store.packages?.[props.item.name]?.package.version ??
			"—"
		);
	}
	return "—";
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

/** 该插件已有配置节点(config 插件缺席时无从判定,入口不渲染)。 */
const hasConfig = computed(
	() => !!ctx.configWriter?.get(props.item.name)?.length,
);

/** 跳转到既有配置页(ensure 对已有配置是定位跳转,无副作用)。 */
function configure() {
	ctx.configWriter?.ensure(props.item.name);
}

/** 添加配置(unconfigured 卡):ensure 会创建一份配置并跳转,副作用经文案暴露。 */
function addConfig() {
	ctx.configWriter?.ensure(props.item.name);
}

/** 卸载:往 override 暂存移除标记,卡片进待应用态,应用时统一执行。 */
function uninstall() {
	const override = (config.value.market.override ??= {});
	override[props.item.name] = "";
}
</script>
