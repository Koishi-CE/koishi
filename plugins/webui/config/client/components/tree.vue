<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <el-scrollbar class="plugin-tree" ref="root">
    <div class="search">
      <el-input v-model="keyword">
        <template #suffix>
          <k-icon name="search"></k-icon>
        </template>
      </el-input>
    </div>
    <el-tree
      ref="tree"
      node-key="path"
      :data="plugins.data"
      :draggable="true"
      :auto-expand-parent="false"
      :default-expanded-keys="plugins.expanded"
      :expand-on-click-node="false"
      :filter-node-method="filterNode"
      :props="{ class: getClass }"
      :allow-drag="allowDrag"
      :allow-drop="allowDrop"
      @node-click="handleClick"
      @node-contextmenu="handleContextmenu"
      @node-drop="handleDrop"
      @node-expand="handleExpand"
      @node-collapse="handleCollapse"
      #="{ node }">
      <div class="item" :ref="handleItemMount">
        <div class="label" :title="getLabel(node)">
          {{ getLabel(node) }}
        </div>
        <div class="right">
          <span v-if="getFullName(node.data.name)" class="status-light" :class="getStatus(node.data)"></span>
        </div>
      </div>
    </el-tree>
  </el-scrollbar>
</template>

<script lang="ts" setup>
/**
 * 配置树组件：插件配置页左侧的树形导航。
 *
 * 基于 el-tree 展示由 utils.plugins 派生的配置树，支持：
 * - 关键词过滤（按插件短名）；
 * - 拖拽调整插件位置 / 归入分组（转发为 manager/teleport）；
 * - 展开 / 收起分组状态持久化到配置的 $collapsed 元数据；
 * - 右键菜单（useMenu("config.tree")）与状态灯展示。
 */
import { send, useMenu } from "@koishi-ce/client";
import type {
	ElScrollbar,
	ElTree,
	TreeNodeData,
} from "element-plus";
import type {
	ComponentInternalInstance,
	ComponentPublicInstance,
} from "vue";
import { nextTick, onActivated, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import {
	getFullName,
	getStatus,
	plugins,
	type Tree,
} from "./utils";

const { t } = useI18n();

const props = defineProps<{
	modelValue: string;
}>();

const route = useRoute();
const trigger = useMenu("config.tree");

const emit = defineEmits(["update:modelValue"]);

const root = ref<InstanceType<typeof ElScrollbar> | null>(
	null,
);
const tree = ref<InstanceType<typeof ElTree> | null>(null);
const keyword = ref("");

/** el-tree 的节点过滤回调：按插件短名做大小写不敏感的包含匹配。 */
function filterNode(value: string, data: TreeNodeData) {
	// el-tree 回传的 data 即本树提供的 Tree 节点数据,此处收窄取字段
	const tree = data as Tree;
	return tree.name
		.toLowerCase()
		.includes(keyword.value.toLowerCase());
}

const isActivating = ref(true);

// activate 在以下三种情况下会被调用:
// 1. 组件被激活(keep-alive 切回)时
// 2. 新的配置项被添加时(通过 handleItemMount 感知节点挂载)
// 3. 路由被编程式修改时
async function activate() {
	await nextTick();
	const rootEl = root.value?.$el;
	const nodeEl = rootEl?.querySelector(
		".el-tree-node.is-active",
	) as HTMLElement;
	if (
		!nodeEl ||
		(!nodeEl.offsetTop &&
			route.path.slice(9 /* /plugins/ */))
	)
		return;
	root.value?.["setScrollTop"](
		nodeEl.offsetTop -
			(rootEl.offsetHeight - nodeEl.offsetHeight) / 2,
	);
}

defineExpose({ activate });

onActivated(async () => {
	void activate();
	isActivating.value = false;
});

/** 节点 DOM 挂载回调：初次激活后新增的节点会触发一次滚动定位。 */
function handleItemMount(
	itemEl: Element | ComponentPublicInstance | null,
) {
	// 函数式 ref 的卸载阶段会传 null,只关心挂载
	if (!itemEl || isActivating.value) return;
	void activate();
}

/**
 * el-tree 的节点对象（官方 Node 的结构超集近似：data 按 TreeNodeData
 * 放宽以兼容官方回调签名,使用处以 as Tree 收窄回本树数据）。
 */
interface Node {
	data: TreeNodeData;
	label?: string;
	parent: Node | null;
	expanded: boolean;
	isLeaf: boolean | undefined;
	childNodes: Node[];
}

/** 节点显示文案：分组用"分组：xxx"，普通插件用 $label 或短名，待添加节点显示占位符。 */
function getLabel(node: Node): string {
	// el-tree 回传的 data 即本树提供的 Tree 节点数据,此处收窄取字段
	const data = node.data as Tree;
	if (data.name === "group") {
		return t("config.tree.group", [
			node.label || data.path,
		]);
	} else {
		return (
			node.label || data.name || t("config.tree.pending")
		);
	}
}

/** 根节点（全局设置）不可拖拽。 */
function allowDrag(node: Node) {
	// el-tree 回传的 data 即本树提供的 Tree 节点数据,此处收窄取字段
	return (node.data as Tree).path !== "";
}

/**
 * 拖拽放置约束：
 * - 非 inner（前/后插入）：不能放在根节点之前，根节点之后允许；
 * - inner（放入内部）：仅分组节点可以接收。
 */
function allowDrop(
	source: Node,
	target: Node,
	type: "inner" | "prev" | "next",
) {
	// el-tree 回传的 data 即本树提供的 Tree 节点数据,此处收窄取字段
	const data = target.data as Tree;
	if (type !== "inner") {
		return data.path !== "" || type === "next";
	}
	return data.id.startsWith("group:");
}

/** 节点点击：同步选中路径，并手动向 window 重发事件以关闭右键菜单。 */
function handleClick(
	tree: Tree,
	_node: Node,
	_instance: ComponentInternalInstance | null,
	event: MouseEvent,
) {
	emit("update:modelValue", tree.path);
	// el-tree 会阻止事件冒泡,
	// 因此需要手动向 window 重发一次该事件,
	// 让右键菜单能感知到点击并关闭。
	window.dispatchEvent(new MouseEvent(event.type, event));
}

/** el-tree 节点右键事件：转发给右键菜单触发器（data 即节点数据）。 */
function handleContextmenu(evt: Event, data: Tree) {
	// node-contextmenu 派生自鼠标右键,实际恒为 MouseEvent
	return trigger(evt as MouseEvent, data);
}

/** 展开分组：把 $collapsed 置为 null（即删除该键）。 */
function handleExpand(
	data: Tree,
	_node: Node,
	_instance: ComponentInternalInstance | null,
) {
	void send("manager/meta", data.path, {
		$collapsed: null,
	});
}

/** 收起分组：写入 $collapsed: true 并持久化。 */
function handleCollapse(
	data: Tree,
	_node: Node,
	_instance: ComponentInternalInstance | null,
) {
	void send("manager/meta", data.path, {
		$collapsed: true,
	});
}

/**
 * 拖拽落下：换算出目标分组与插入序号后转发给服务端的 teleport。
 * 注意根层级不含"全局设置"键，序号需要减一修正。
 */
function handleDrop(
	source: Node,
	target: Node,
	position: "before" | "after" | "inner",
	event: DragEvent,
) {
	const parent =
		position === "inner" ? target : target.parent;
	// 根层拖放时 parent 取虚拟根节点(el-tree 保证存在);空值仅作防御
	if (!parent) return;
	// el-tree 回传的 data 即本树提供的 Tree 节点数据,此处收窄取字段
	const src = source.data as Tree;
	let index = parent.childNodes.findIndex(
		(node) => (node.data as Tree).path === src.path,
	);
	if (!(parent.data as Tree).path) index -= 1; // 根层级不含全局设置节点,序号减一
	void send(
		"manager/teleport",
		src.parent?.path ?? "",
		src.id,
		(parent.data as Tree).path,
		index,
	);
}

/** el-tree 自定义节点 class：分组加粗、未安装插件置灰、当前选中高亮。 */
function getClass(data: TreeNodeData): string {
	// el-tree 回传的 data 即本树提供的 Tree 节点数据,此处收窄取字段
	const tree = data as Tree;
	const words: string[] = [];
	if (tree.children) words.push("is-group");
	if (!tree.children && !getFullName(tree.name))
		words.push("is-disabled");
	if (tree.path === props.modelValue)
		words.push("is-active");
	return words.join(" ");
}

// 关键词变化时触发 el-tree 的节点过滤
watch(keyword, (val) => {
	tree.value?.filter(val);
});
</script>

<style lang="scss">

.plugin-tree {
  width: 100%;
  height: 100%;
  overflow: auto;

  .el-scrollbar__view {
    padding: 1rem 0;
    line-height: 2.25rem;
  }

  .search {
    padding: 0 1.5rem;
  }

  .k-icon-filter {
    height: 15px;
  }

  .el-tree-node {
    &.is-group > .el-tree-node__content {
      font-weight: bold;
    }
  }

  .el-tree-node__content {
    .item {
      flex: 1;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      overflow: hidden;
    }

    .label {
      overflow: hidden;
      text-overflow: ellipsis;
      transition: var(--color-transition);
    }

    .right {
      height: 100%;
      margin: 0 1.5rem 0 0.5rem;
    }
  }
}

</style>
