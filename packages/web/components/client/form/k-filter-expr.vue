<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  单条过滤表达式编辑器（k-filter 的内层行组件）：
  「实体 + 运算符 + 值」三段式编辑一条 minato 查询条件。
  · isDirect（是否私聊）特殊化为一个开关；
  · user.authority 只开放大小比较且值为数字；
  · $in / $nin 的值按逗号分隔成数组。
  表达式结构为 { [op]: [{ $: entity }, value] }，与 k-filter-button 的
  摘要文案共用 entities / operators 两张映射表。
-->
<template>
  <template v-if="operator && !operators[operator]">
    无法解析的此处的表达式。
  </template>
  <div class="k-filter-expr" v-else>
    <el-select class="entity" :disabled="disabled" v-model="entity">
      <template v-for="(name, key) in entities" :key="key">
        <el-option v-if="isValid(key)" :label="name" :value="key"></el-option>
      </template>
    </el-select>
    <template v-if="entity === 'isDirect'">
      <el-switch v-model="boolean"></el-switch>
    </template>
    <template v-else-if="entity">
      <el-select class="operator" :disabled="disabled" v-model="operator">
        <el-option v-for="key in availableOps" :key="key" :label="operators[key]" :value="key"></el-option>
      </el-select>
      <el-input :disabled="disabled" :key="type" :type="type" class="value" v-model="value"></el-input>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue";

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

const entity = ref<string>();
const operator = ref<string>();
// 比较值：文本输入为 string，权限字段为 number，解析外部值时也可能是其余类型
const value = ref<unknown>();
// isDirect（是否私聊）用的开关量
const boolean = ref<boolean>(false);

/**
 * user.* 实体只有在宿主通过 options.userFields 声明了对应自定义用户字段时
 * 才可选，其余实体一律可选。
 */
function isValid(key: string) {
	if (key.startsWith("user.")) {
		return props.options?.userFields?.includes(key.slice(5));
	} else {
		return true;
	}
}

// 实体字段的中文文案（与 k-filter-button 共用同一套键名）
const entities: Record<string, string> = {
	isDirect: "是否私聊",
	userId: "用户 ID",
	guildId: "群组 ID",
	channelId: "频道 ID",
	selfId: "机器人 ID",
	platform: "平台",
	"user.authority": "用户权限",
};

// 运算符的中文文案
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

// 当前实体可用的运算符：权限字段用大小比较，其余用等值 / 集合判断
const availableOps = computed(() => {
	if (entity.value === "user.authority")
		return ["$eq", "$ne", "$gt", "$lt", "$gte", "$lte"];
	if (entity.value) return ["$eq", "$ne", "$in", "$nin"];
	return [];
});

// 外部 modelValue 变化时反向解析出三段状态（数组值拼回逗号分隔文本）
watch(
	() => props.modelValue,
	(modelValue) => {
		operator.value = Object.keys(modelValue ?? {})[0];
		const exprValue = modelValue?.[operator.value ?? ""] as Operand | undefined;
		if (!exprValue) return;
		entity.value = exprValue[0]?.$;
		value.value = Array.isArray(exprValue[1])
			? exprValue[1].join(", ")
			: entity.value === "user.authority"
				? Number(exprValue[1])
				: exprValue[1];
	},
	{ immediate: true },
);

// 输入框类型：权限为数字，其余为文本
const type = computed(() => {
	if (entity.value === "user.authority") return "number";
	return "string";
});

// 切换实体时清空取值，并把运算符重置为新实体可用的第一个
watch(entity, () => {
	value.value = null;
	if (!availableOps.value.includes(operator.value)) {
		operator.value = availableOps.value[0];
	}
});

// 任一段变化时组装成 minato 表达式向上 emit；
// $in / $nin 按逗号拆分为数组，权限字段转数字
watch(
	[entity, operator, value, boolean],
	([entity, operator, value, boolean]) => {
		if (!entity || !entities[entity]) return;
		if (entity === "isDirect") {
			return emit("update:modelValue", {
				$eq: [{ $: entity }, boolean],
			});
		}
		if (!operator || !operators[operator] || !value) return;
		let result: unknown = value;
		if (["$in", "$nin"].includes(operator)) {
			result = String(value)
				.split(/\s*,\s*/g)
				.filter(Boolean);
		} else if (entity === "user.authority") {
			result = Number(value);
		}
		emit("update:modelValue", {
			[operator]: [{ $: entity }, result],
		});
	},
);
</script>

<style lang="scss">

.k-filter-expr {
  flex: 1 0 auto;
  display: inline-flex;

  .entity, .operator {
    width: 7.5rem;
    flex: 0 0 auto;
  }

  .value {
    width: auto;
    flex: 1 0 auto;
  }
}

</style>
