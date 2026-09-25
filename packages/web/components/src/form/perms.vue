<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

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
// store 由宿主启动时注入（见 ../core/injection.ts），此处读取服务端下发的
// 权限名列表；响应式追踪经同一 reactive 单例保持

import type { CascaderOption } from "element-plus";
import { computed, type PropType, type Ref } from "vue";
import { useStore } from "../core/injection";
import { type Schema, SchemaBase } from "./index";

defineProps({
	schema: {} as PropType<Schema>,
	modelValue: {} as PropType<string>,
	// Boolean prop 未传时默认 false，与 el-cascader 自身默认一致
	disabled: Boolean,
	prefix: {} as PropType<string>,
	initial: {} as PropType<Record<never, never>>,
});

defineEmits(["update:modelValue"]);

const store = useStore();

// SchemaBase 的运行时载体（schemastery-vue 的 form 对象）挂有 useModel
// 静态成员，但类型垫片（components/src/shims.d.ts）未声明，此处原地
// 断言补全；返回 ref 运行时初始为 undefined，类型按 el-cascader 的
// v-model 载荷形态（string[]，emitPath: false 的多选值）标注
const { useModel } = SchemaBase as typeof SchemaBase & {
	useModel: () => Ref<string[]>;
};

const config = useModel();

/**
 * 递归插入一个权限路径（如 ["channel", "admin", "x"]）：
 * 逐段查找/创建级联节点；中间段（还有下级时）标记为 disabled，
 * 因为 el-cascader 的父节点勾选会影响子级，而中间段并非真实权限。
 */
function addNode(
	nodes: CascaderOption[],
	path: string[],
	prefix = "",
) {
	const name = path.shift();
	// path 由权限名按 ":" 切分而来，恒非空；判空仅通过空安全检查
	if (name === undefined) return;
	let node = nodes.find(
		(node) => node.value === prefix + name,
	);
	if (!node) {
		node = {
			value: prefix + name,
			label: name,
			disabled: !!path.length,
		};
		nodes.push(node);
	}
	if (!path.length) return;
	addNode(
		(node.children ||= []),
		path,
		`${prefix + name}:`,
	);
}

// 由全部权限名构建级联选项树
// （permissions 数据未就绪时视为空集合，与 validate 的守卫语义一致）
const options = computed(() => {
	const result: CascaderOption[] = [];
	for (const name of store.permissions ?? []) {
		const path = name.split(":");
		addNode(result, path);
	}
	return result;
});
</script>
