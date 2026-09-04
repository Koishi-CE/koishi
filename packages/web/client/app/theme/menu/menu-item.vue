<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  上下文菜单的单个菜单项：点击时调用对应 action。
  id 支持两种特殊写法："!" 前缀会被去除（兼容旧的否定式 id），
  "." 开头则是相对 id，需拼上所属菜单前缀（props.prefix）再查找 action。
  label / icon / hidden / disabled 同样支持以 scope 为参的 getter。
-->
<template>
  <div
    class="k-menu-item"
    v-if="!hidden"
    :class="[toValue(type), { disabled }]"
    @click.prevent="item?.action(ctx.$action.createScope())"
  >
    <span v-if="icon" class="k-menu-icon"><k-icon :name="icon"/></span>
    {{ toValue(label) }}
  </div>
</template>

<script lang="ts" setup>
import {
	type MaybeGetter,
	type MenuItem,
	useContext,
} from "@koishi-ce/client";
import { computed } from "vue";

const props = defineProps<MenuItem & { prefix: string }>();

const ctx = useContext();

// 解析出实际的 action：去掉 "!" 前缀、拼接相对 id 后查注册表
const item = computed(() => {
	let id = props.id.replace(/^!/, "");
	if (id.startsWith(".")) id = props.prefix + id;
	return ctx.internal.actions[id];
});

// action 不存在（未注册）时整项隐藏；声明了 hidden 的按求值结果判断
const hidden = computed(() => {
	if (!item.value) return true;
	if (!item.value.hidden) return false;
	return toValue(item.value.hidden);
});

// action 不存在或声明禁用时置灰不可点
const disabled = computed(() => {
	if (!item.value) return true;
	if (!item.value.disabled) return false;
	return toValue(item.value.disabled);
});

const icon = computed(() => toValue(props.icon));

// label / icon 等字段可能是静态值或以 action scope 为参的 getter，统一解包
function toValue<T>(getter: MaybeGetter<T>): T {
	if (typeof getter !== "function") return getter;
	// 收窄到 MaybeGetter 的函数分支（以作用域为参的 getter）
	return (
		getter as (
			current: ReturnType<typeof ctx.$action.createScope>,
		) => T
	)(ctx.$action.createScope());
}
</script>
