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

    <k-content class="command-config" v-if="activeData">
      <Command :command="activeData"></Command>
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
	scrollActiveTree,
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
// el-tree 组件实例的最小类型面：本组件只用到 filter 方法（完整实例类型
// 需引用 element-plus，浏览器端类型程序解析不到该包，故按需手写）
const treeEl = ref<{
	filter: (value: string) => void;
} | null>(null);
const keyword = ref("");
const root = ref<{ $el: HTMLElement } | null>(null);

// 树形数据的节点：在指令数据基础上递归展开 children 为子节点。
// CommandData.children 是「子指令名列表」（string[]），此处被同名字段
// 覆盖为子节点列表，故 extends 前先 Omit 掉原字段以免类型冲突
interface TreeCommand
	extends Omit<CommandData, "children"> {
	children: TreeCommand[];
}

// 把服务端下发的扁平指令表组装成 el-tree 需要的树形结构：
// 先剔除所有「已作为子指令出现」的条目得到顶层集合，再递归展开 children
const treeData = computed(() => {
	const topLevel = { ...data.value };
	for (const name in data.value) {
		const command = data.value[name];
		// 键取自 data.value 自身，此处判空仅为通过索引访问的类型收窄
		if (!command) continue;
		for (const name2 of command.children) {
			delete topLevel[name2];
		}
	}
	function traverse(names: string[]): TreeCommand[] {
		return names.sort().flatMap((name) => {
			const command = data.value[name];
			// topLevel 的键必有对应指令，缺失时跳过该节点（防御性收窄）
			if (!command) return [];
			return [
				{
					...command,
					children: traverse(command.children),
				},
			];
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
	treeEl.value?.filter(val);
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

// 当前选中指令的数据：active 的 getter 已保证非空名必在 data 中，
// 此处合并「判空 + 取值」以便模板 v-if 完成收窄（不可达的缺失分支
// 回退为空态，与未选中时的展示一致）
const activeData = computed(() => {
	if (!active.value) return undefined;
	return data.value[active.value];
});

// el-tree 内部节点结构的最小子集（供拖拽 / 样式回调收参数用）。
// 字段形态须与 element-plus 的 Node 保持结构兼容：其 data 是
// Record<string, any>（无法赋给带必填字段的接口），故 name 声明为可选；
// 顶层节点的 parent 指向根虚拟节点，类型上并含 null
interface Node {
	label: string;
	data: { name?: string };
	parent: Node | null;
	expanded: boolean;
	isLeaf: boolean | undefined;
	childNodes: Node[];
}

// 节点样式：选中项高亮
function getClass(data: { name?: string }) {
	const words: string[] = [];
	if (data.name === active.value) words.push("is-active");
	return words.join(" ");
}

// 节点过滤：按指令名做大小写不敏感的包含匹配
// （首参对齐 el-tree filter-node-method 签名位置，实值经 keyword 读取，故置下划线）
function filterNode(_value: string, data: CommandData) {
	return data.name
		.toLowerCase()
		.includes(keyword.value.toLowerCase());
}

// 仅顶层指令（名字不含 "."）可拖拽
function allowDrag(node: Node) {
	// name 运行时必有值；?. 与 === false 使缺失时保守地不可拖拽
	return node.data.name?.includes(".") === false;
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
	// 末参对齐 el-tree node-drop 事件签名，本处未使用，置下划线
	_event: DragEvent,
) {
	const parent =
		position === "inner" ? target : target.parent;
	// 拖到顶层旁时 parent 是 el-tree 的根虚拟节点（data 为空对象），其
	// name 为 undefined，按「移到顶层」语义兜底为空串（服务端对空父名
	// 的 teleport 即移到顶层）；节点 name 运行时恒有值，兜底不改行为
	void send(
		"command/teleport",
		source.data.name ?? "",
		parent?.data.name ?? "",
	);
}

async function onEnter() {
	await send("command/create", inputText.value);
	inputText.value = "";
	showCreateDialog.value = false;
}

// 页面重新激活时把当前选中的树节点滚动到可视区域中央
onActivated(() => scrollActiveTree(root));

// 顶部菜单：创建指令（弹出对话框）
ctx.action("command.create", {
	action: () => (showCreateDialog.value = true),
});

// 顶部菜单：移除指令（仅本插件创建的指令可移除）
ctx.action("command.remove", {
	disabled: () => !data.value[active.value]?.create,
	action: () => {
		const command = data.value[active.value];
		// 菜单可用性已由上面的 disabled 守卫，此处判空仅为类型收窄
		if (!command) return;
		return send("command/remove", command.name);
	},
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
