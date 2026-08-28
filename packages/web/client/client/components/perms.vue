<!--
  perms.vue：权限选择控件（array + perms 角色）。
  把服务端下发的扁平权限名（如 "channel.xxx"）按 ":" 逐级拆分，
  构造成 el-cascader 的级联选项树；checkStrictly 允只勾选父级权限，
  emitPath: false 使选中值仍是完整的权限路径字符串。
-->
<template>
  <schema-base>
    <template #title><slot name="title"></slot></template>
    <template #desc><slot name="desc"></slot></template>
    <template #menu><slot name="menu"></slot></template>
    <template #prefix><slot name="prefix"></slot></template>
    <template #suffix><slot name="suffix"></slot></template>
    <template #control>
      <el-cascader
        collapse-tags
        v-model="config"
        :options="options"
        :props="{ multiple: true, checkStrictly: true, emitPath: false }"
        :disabled="disabled">
      </el-cascader>
    </template>
  </schema-base>
</template>

<script lang="ts" setup>
// SchemaBase 经由 components 包的再导出获取:本包的 node_modules 没有
// schemastery-vue 链接(它是 components 的依赖,Bun 隔离布局下不跨包可见)

import { store } from "@koishi-ce/client";
import { type Schema, SchemaBase } from "@koishi-ce/components";
import type { CascaderOption } from "element-plus";
import { computed, type PropType } from "vue";

defineProps({
	schema: {} as PropType<Schema>,
	modelValue: {} as PropType<string>,
	disabled: {} as PropType<boolean>,
	prefix: {} as PropType<string>,
	initial: {} as PropType<{}>,
});

defineEmits(["update:modelValue"]);

const config = SchemaBase.useModel();

/**
 * 递归插入一个权限路径（如 ["channel", "admin", "x"]）：
 * 逐段查找/创建级联节点；中间段（还有下级时）标记为 disabled，
 * 因为 el-cascader 的父节点勾选会影响子级，而中间段并非真实权限。
 */
function addNode(nodes: CascaderOption[], path: string[], prefix = "") {
	const name = path.shift();
	let node = nodes.find((node) => node.value === prefix + name);
	if (!node) {
		node = { value: prefix + name, label: name, disabled: !!path.length };
		nodes.push(node);
	}
	if (!path.length) return;
	addNode((node.children ||= []), path, prefix + name + ":");
}

// 由全部权限名构建级联选项树
const options = computed(() => {
	const result: CascaderOption[] = [];
	for (const name of store.permissions) {
		const path = name.split(":");
		addNode(result, path);
	}
	console.log(result);
	return result;
});
</script>
