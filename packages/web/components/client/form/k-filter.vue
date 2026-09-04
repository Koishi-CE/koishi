<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  过滤器编辑器（全局组件 k-filter）：以「或 → 与 → 单条表达式」三层结构
  编辑 minato 查询条件——外层各组之间为 $or，组内各行之间为 $and，
  每行由 k-filter-expr 编辑。单项时省略包裹键，空组自动折叠为 undefined，
  以保持 modelValue 的最简形态。无法按此结构解析时整体降级为提示文案。
-->
<template>
  <p v-if="invalid">无法解析过滤器。</p>
  <div class="k-filter" v-else>
    <div v-for="(layer, outer) in extract(modelValue, '$or')" :key="outer">
      <div class="k-filter-item" v-for="(expr, inner) in extract(layer, '$and')" :key="inner">
        <el-button :disabled="disabled" @click="remove(inner, outer)"><k-icon name="delete"></k-icon></el-button>
        <k-filter-expr :disabled="disabled" :options="options" :modelValue="expr" @update:modelValue="update($event, inner, outer)"></k-filter-expr>
      </div>
      <div>
        <el-button @click="update({}, extract(layer, '$and').length, outer)">添加「与」条件</el-button>
      </div>
    </div>
    <div>
      <el-button @click="update({}, 0, extract(modelValue, '$or').length)">
        {{ extract(modelValue, '$or').length ? '添加「或」条件' : '添加条件' }}
      </el-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import KFilterExpr from "./k-filter-expr.vue";

/** minato 过滤表达式：单条 { [运算符]: [{ $: 实体 }, 值] }，或 $and / $or 组合 */
interface FilterExpr {
	$and?: FilterExpr[];
	$or?: FilterExpr[];
	[operator: string]: unknown;
}

/** 过滤器宿主选项：userFields 声明可选的自定义用户字段（user.* 实体开关） */
interface FilterOptions {
	userFields?: string[];
}

/** 收窄辅助：判断值是否为普通对象（过滤表达式的载体） */
function isRecord(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const props = defineProps<{
	modelValue: FilterExpr | null;
	disabled?: boolean;
	options?: FilterOptions;
}>();

const emit = defineEmits(["update:modelValue"]);

// modelValue 无法按「$or → $and → 表达式」结构解析时标记整体不可编辑
const invalid = computed(() => {
	const outer = extract(props.modelValue, "$or");
	if (!outer) return true;
	for (const layer of outer) {
		const inner = extract(layer, "$and");
		if (!inner) return true;
	}
});

/**
 * 从 modelValue 中按层级键（$or / $and）展开出数组：
 * 缺省返回空数组，单项包裹返回该项，已是数组则原样返回。
 */
function extract(value: unknown, type: string): unknown[] {
	if (!value) {
		return [];
	} else if (
		isRecord(value) &&
		Array.isArray(value[type])
	) {
		return value[type];
	} else {
		return [value];
	}
}

/**
 * extract 的逆操作：过滤空项后，0 项返回 undefined、1 项脱去包裹键、
 * 多项重新包成 { [type]: values }，保证 modelValue 始终最简。
 */
function format(values: unknown[], type: string) {
	values = values.filter(Boolean);
	if (!values.length) {
		return;
	} else if (values.length === 1) {
		return values[0];
	} else {
		return { [type]: values };
	}
}

/** 替换指定位置（外层 outerKey / 内层 innerKey）的表达式并整体重排 emit */
function update(
	expr: unknown,
	innerKey: string | number,
	outerKey: string | number,
) {
	const outer = extract(props.modelValue, "$or").slice();
	const inner = extract(outer[outerKey], "$and").slice();
	inner[innerKey] = expr;
	outer[outerKey] = format(inner, "$and");
	emit("update:modelValue", format(outer, "$or"));
}

/** 删除指定位置的表达式（置空后交给 format 收敛结构） */
function remove(
	innerKey: string | number,
	outerKey: string | number,
) {
	const outer = extract(props.modelValue, "$or").slice();
	const inner = extract(outer[outerKey], "$and").slice();
	inner[innerKey] = undefined;
	outer[outerKey] = format(inner, "$and");
	emit("update:modelValue", format(outer, "$or"));
}
</script>

<style lang="scss">

.k-filter-item {
  display: flex;
}

</style>
