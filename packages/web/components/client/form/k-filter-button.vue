<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  过滤条件按钮（computed.vue 分支条件的编辑入口）：以一句话摘要展示当前
  过滤表达式，点击弹出对话框，内嵌 k-filter 进行完整编辑。
-->
<template>
  <span class="k-filter-button" @click="showDialog = true">
    {{ desc }}
  </span>
  <el-dialog v-model="showDialog" destroy-on-close>
    <template #header>条件设置</template>
    <k-filter v-model="config" :options="options" :disabled="disabled"></k-filter>
  </el-dialog>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import KFilter from "./k-filter.vue";

/** 单条表达式的操作数：[{ $: 实体名 }, 比较值] */
type Operand = [{ $: string }, unknown];

/** minato 过滤表达式：单条 { [运算符]: 操作数 }，或 $and / $or 逻辑组合 */
interface FilterExpr {
	$and?: FilterExpr[];
	$or?: FilterExpr[];
	[operator: string]: FilterExpr[] | Operand | undefined;
}

/** 过滤器宿主选项：userFields 声明可选的自定义用户字段（user.* 实体开关） */
interface FilterOptions {
	userFields?: string[];
}

const props = defineProps<{
	modelValue: FilterExpr | null;
	disabled?: boolean;
	options?: FilterOptions;
}>();

const emit = defineEmits(["update:modelValue"]);

const showDialog = ref(false);

// modelValue 的可写 computed 包装，供对话框内 k-filter 的 v-model 使用
const config = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

// 实体字段（查询对象的左侧）的中文文案，键与 k-filter-expr 保持一致
const entities: Record<string, string> = {
	userId: "用户 ID",
	guildId: "群组 ID",
	channelId: "频道 ID",
	selfId: "机器人 ID",
	platform: "平台",
	"user.authority": "用户权限",
};

// 比较运算符（查询对象的右侧）的中文文案
const operators: Record<string, string> = {
	$in: "属于",
	$nin: "不属于",
	$eq: "等于",
	$ne: "不等于",
	$gt: "大于",
	$lt: "小于",
	$gte: "不小于",
	$lte: "不大于",
};

/**
 * 把 minato 风格的过滤表达式递归转成中文摘要，
 * 如「用户 ID 属于 123 且 平台 等于 discord」。
 */
function toDesc(expr: FilterExpr | null | undefined): string {
	if (!expr) return "";
	if (expr.$and) {
		return expr.$and.map(toDesc).filter(Boolean).join(" 且 ");
	} else if (expr.$or) {
		return expr.$or.map(toDesc).filter(Boolean).join(" 或 ");
	} else {
		const op = Object.keys(expr)[0];
		const operand = op ? expr[op] : undefined;
		if (!op || !operand) return "";
		const [entity, value] = operand as Operand;
		return `${entities[entity.$]} ${operators[op]} ${value}`;
	}
}

// 按钮上展示的条件摘要；无条件时显示「无」
const desc = computed(() => {
	return toDesc(config.value) || "无";
});
</script>

<style lang="scss">

</style>
