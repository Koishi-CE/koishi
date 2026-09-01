<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  用户设置页：左侧 el-tree 分组导航 + 右侧当前分组的内容。
  分组内的条目三种形态二选一渲染：组件型（component）、表单型（schema），
  disabled 的条目直接跳过。
-->
<template>
  <k-layout main="page-settings">
    <template #header>
      {{ ctx.internal.settings[path][0]?.title }}
    </template>

    <template #left>
      <el-scrollbar>
        <el-tree
          ref="tree"
          :data="data"
          :default-expand-all="true"
          @node-click="handleClick"
        ></el-tree>
      </el-scrollbar>
    </template>

    <keep-alive>
      <k-content :key="path">
        <template v-for="item of ctx.internal.settings[path]">
          <template v-if="item.disabled?.()"></template>
          <component v-else-if="item.component" :is="item.component" />
          <k-form v-else-if="item.schema" :schema="item.schema" v-model="config" :initial="config" />
        </template>
      </k-content>
    </keep-alive>
  </k-layout>
</template>

<script lang="ts" setup>
import { useConfig, useContext } from "@koishi-ce/client";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

// 全局控制台配置（双向可写），表单型条目直接绑定到此对象
const config = useConfig(true);
const ctx = useContext();

// el-tree 的数据源：由 internal.settings 中各分组的首个条目标题生成
interface Tree {
	id: string;
	label: string;
	children?: Tree[];
}

const data = computed(() =>
	Object.entries(ctx.internal.settings).map<Tree>(([id, [{ title }]]) => ({
		id,
		label: title,
	})),
);

function handleClick(tree: Tree) {
	// 仅叶子节点（无 children）可切换分组
	if (tree.children) return;
	path.value = tree.id;
}

// 当前分组与路由参数双向同步；无效分组名回退为空串
const path = computed({
	get() {
		const name = route.params.name?.toString();
		return name in ctx.internal.settings ? name : "";
	},
	set(value) {
		if (!(value in ctx.internal.settings)) value = "";
		void router.replace(`/settings/${value}`);
	},
});
</script>

<style lang="scss">

</style>
