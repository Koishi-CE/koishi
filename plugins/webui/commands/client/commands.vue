<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <!-- 指令管理主页面：左侧为可搜索、可拖拽的指令树，右侧为选中指令的配置面板 -->
  <k-layout menu="command">
    <template #header>
      指令管理{{ active ? ' - ' + active : '' }}
    </template>

    <template #left>
      <el-scrollbar class="command-tree w-full h-full overflow-auto" ref="root">
        <div class="search">
          <el-input v-model="keyword">
            <template #suffix>
              <k-icon name="search"></k-icon>
            </template>
          </el-input>
        </div>
        <el-tree
          ref="treeEl"
          :draggable="true"
          :data="treeData"
          :props="{ label: 'name', class: getClass }"
          :filter-node-method="filterNode"
          :default-expand-all="true"
          :expand-on-click-node="false"
          :allow-drag="allowDrag"
          :allow-drop="allowDrop"
          @node-click="handleClick"
          @node-drop="handleDrop"
        ></el-tree>
      </el-scrollbar>
    </template>

    <k-content class="command-config" v-if="active">
      <Command :command="data[active]"></Command>
    </k-content>

    <k-empty v-else>
      <div>请在左侧选择指令</div>
    </k-empty>

    <el-dialog class="command-dialog" destroy-on-close v-model="showCreateDialog" title="添加指令" @open="handleOpen">
      <el-input ref="inputEl" :class="{ invalid: !inputText }" v-model="inputText" @keydown.enter.stop.prevent="onEnter" placeholder="请输入名称"></el-input>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!inputText" @click="onEnter">确定</el-button>
      </template>
    </el-dialog>
  </k-layout>
</template>

<script lang="ts" setup>
import {
	type Dict,
	send,
	useContext,
	useRpc,
} from "@koishi-ce/client";
import type { CommandData } from "@koishi-ce/plugin-commands";
import {} from "@koishi-ce/plugin-config";
import {} from "@koishi-ce/plugin-locales";
import {
	computed,
	nextTick,
	onActivated,
	ref,
	watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import Command from "./command.vue";

const route = useRoute();
const router = useRouter();
const ctx = useContext();

const data = useRpc<Dict<CommandData>>();

const inputEl = ref();
const inputText = ref("");
const treeEl = ref(null);
const keyword = ref("");
const root = ref<{ $el: HTMLElement }>(null);

// 把服务端下发的扁平指令表组装成 el-tree 需要的树形结构：
// 先剔除所有「已作为子指令出现」的条目得到顶层集合，再递归展开 children
const treeData = computed(() => {
	const topLevel = { ...data.value };
	for (const name in data.value) {
		for (const name2 of data.value[name].children) {
			delete topLevel[name2];
		}
	}
	function traverse(names: string[]) {
		return names.sort().map((name) => {
			const command = data.value[name];
			return {
				...command,
				children: traverse(command.children),
			};
		});
	}
	return traverse(Object.keys(topLevel));
});

const showCreateDialog = ref(false);

async function handleOpen() {
	// https://github.com/element-plus/element-plus/issues/15250
	// 对话框挂载后需等一个 tick 才能拿到输入框焦点
	await nextTick();
	inputEl.value?.focus();
}

// 搜索关键字变化时驱动 el-tree 的节点过滤
watch(keyword, (val) => {
	treeEl.value.filter(val);
});

// 当前选中指令：读自路由（/commands/ 之后的路径，"." 分隔层级），写回路由
const active = computed<string>({
	get() {
		const name = route.path.slice(10).replace(/\//g, ".");
		return name in data.value ? name : "";
	},
	set(name) {
		if (!(name in data.value)) name = "";
		router.replace(`/commands/${name.replace(/\./g, "/")}`);
	},
});

interface Node {
	label: string;
	data: CommandData;
	parent: Node;
	expanded: boolean;
	isLeaf: boolean;
	childNodes: Node[];
}

// 节点样式：选中项高亮
function getClass(data: CommandData) {
	const words: string[] = [];
	if (data.name === active.value) words.push("is-active");
	return words.join(" ");
}

// 节点过滤：按指令名做大小写不敏感的包含匹配
function filterNode(value: string, data: CommandData) {
	return data.name
		.toLowerCase()
		.includes(keyword.value.toLowerCase());
}

// 仅顶层指令（名字不含 "."）可拖拽
function allowDrag(node: Node) {
	return !node.data.name.includes(".");
}

// 拖到自身父级（inner 时是目标本身，否则是目标的父级）上没有意义，禁止
function allowDrop(
	source: Node,
	target: Node,
	type: "inner" | "prev" | "next",
) {
	return (
		source.parent !==
		(type === "inner" ? target : target.parent)
	);
}

function handleClick(data: CommandData) {
	active.value = data.name;
}

// 拖拽落下：换算出目标父指令并发送 teleport 事件
function handleDrop(
	source: Node,
	target: Node,
	position: "before" | "after" | "inner",
	event: DragEvent,
) {
	const parent =
		position === "inner" ? target : target.parent;
	void send(
		"command/teleport",
		source.data.name,
		parent.data.name,
	);
}

async function onEnter() {
	await send("command/create", inputText.value);
	inputText.value = "";
	showCreateDialog.value = false;
}

// 页面重新激活时把当前选中的树节点滚动到可视区域中央
onActivated(async () => {
	const container = root.value.$el;
	await nextTick();
	const element = container.querySelector(
		".el-tree-node.is-active",
	) as HTMLElement;
	if (!element) return;
	root.value["setScrollTop"](
		element.offsetTop -
			(container.offsetHeight - element.offsetHeight) / 2,
	);
});

// 顶部菜单：创建指令（弹出对话框）
ctx.action("command.create", {
	action: () => (showCreateDialog.value = true),
});

// 顶部菜单：移除指令（仅本插件创建的指令可移除）
ctx.action("command.remove", {
	disabled: () => !data.value[active.value]?.create,
	action: () =>
		send("command/remove", data.value[active.value].name),
});
</script>

<style lang="scss">

.command-tree {
  .el-scrollbar__view {
    padding: 1rem 0;
  }

  .search {
    padding: 0 1.5rem;
  }
}

.command-config {
  .k-content > *:first-child {
    margin-top: 0;
  }
}

</style>
