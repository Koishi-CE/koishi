<!--
  顶栏菜单按钮（图标型）：hidden/disabled/label/icon 均支持 getter，
  点击时以 action scope 为参调用对应 action。
-->
<template>
  <el-tooltip v-if="!hidden" :disabled="disabled" :content="toValue(item.label)" placement="bottom">
    <span class="menu-item" :class="[toValue(item.type), { disabled }]" @click="trigger">
      <k-icon class="menu-icon" :name="toValue(item.icon)"></k-icon>
    </span>
  </el-tooltip>
</template>

<script lang="ts" setup>
import {
	type LegacyMenuItem,
	type MaybeGetter,
	useContext,
} from "@koishi-ce/client";
import { computed } from "vue";

const props = defineProps<{
	item: LegacyMenuItem;
	menuKey?: string;
	menuData?: unknown;
}>();

const ctx = useContext();

// 未声明 hidden 时直接可见；声明为 getter 的按求值结果判断
const hidden = computed(() => {
	if (!props.item.hidden) return false;
	return toValue(props.item.hidden);
});

// 没有对应 action 的按钮视为禁用（仅作展示）
const disabled = computed(() => {
	if (!props.item.action) return true;
	if (!props.item.disabled) return false;
	return toValue(props.item.disabled);
});

// action scope：以所属菜单 id -> menuData 的映射作为求值上下文
const scope = computed(() =>
	ctx.$action.createScope({
		[props.menuKey]: props.menuData,
	}),
);

// label / icon 等字段可能是静态值或以 scope 为参的 getter，这里统一解包
function toValue<T>(getter: MaybeGetter<T>): T {
	if (typeof getter !== "function") return getter;
	// 收窄到 MaybeGetter 的函数分支（以作用域为参的 getter）
	return (getter as (current: typeof scope.value) => T)(scope.value);
}

function trigger() {
	// disabled 计算属性已保证无 action 的按钮不可点击，这里做空值防护
	return props.item.action?.(scope.value);
}
</script>
