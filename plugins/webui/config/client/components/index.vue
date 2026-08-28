<template>
  <k-layout menu="config.tree" :menu-data="current">
    <template #header>
      <!-- 根节点:全局设置 -->
      <template v-if="!current.path">全局设置</template>

      <!-- 分组节点 -->
      <template v-else-if="current.children">
        分组：{{ current.label || current.id }}
      </template>

      <!-- 普通插件节点 -->
      <template v-else>
        {{ current.label || current.name }} [{{ current.path }}]
      </template>
    </template>

    <template #left>
      <tree-view ref="tree" v-model="path"></tree-view>
    </template>

    <k-content class="plugin-view" :key="path">
      <global-settings v-if="!current.path" :current="current" v-model="config"></global-settings>
      <group-settings v-else-if="current.children" v-model="config" :current="current"></group-settings>
      <plugin-settings v-else :current="current" v-model="config"></plugin-settings>
    </k-content>

    <el-dialog
      v-model="showRemove"
      title="确认移除"
      destroy-on-close
      @closed="remove = null"
    >
      <template v-if="remove">
        确定要移除{{ remove.children ? `分组 ${remove.label || remove.path}` : `插件 ${remove.label || remove.name}` }} 吗？此操作不可撤销！
      </template>
      <template #footer>
        <el-button @click="showRemove = false">取消</el-button>
        <el-button type="danger" @click="(showRemove = false, removeItem(remove), tree?.activate())">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showRename"
      title="重命名"
      destroy-on-close
      @open="handleOpen"
      @closed="rename = null"
    >
      <template v-if="rename">
        <el-input ref="inputEl" v-model="input" @keydown.enter.stop.prevent="renameItem(rename, input)"/>
      </template>
      <template #footer>
        <el-button @click="showRename = false">取消</el-button>
        <el-button type="primary" @click="renameItem(rename, input)">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog
      :model-value="groupCreate !== null"
      @update:model-value="groupCreate = null"
      title="创建分组"
      destroy-on-close
      @open="handleOpen"
    >
      <el-input ref="inputEl" v-model="input" @keydown.enter.stop.prevent="createGroup(input)"/>
      <template #footer>
        <el-button @click="groupCreate = null">取消</el-button>
        <el-button type="primary" @click="createGroup(input)">确定</el-button>
      </template>
    </el-dialog>
  </k-layout>
</template>

<script setup lang="ts">
/**
 * 插件配置页面主组件（/plugins/:name*）。
 *
 * 布局：左侧配置树（tree.vue），右侧按当前节点类型切换
 * 全局设置 / 分组设置 / 插件设置三种面板；头部展示节点标题。
 *
 * 同时承担配置树右键菜单各动作（添加/克隆/重命名/移除/启停/保存）
 * 的注册与对应弹窗（移除确认、重命名、创建分组）的状态管理。
 * 保存动作支持 ctrl+s 快捷键，保存前会用 schema 校验配置。
 */
import {
	clone,
	message,
	Schema,
	send,
	store,
	useContext,
} from "@koishi-ce/client";
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import GlobalSettings from "./global.vue";
import GroupSettings from "./group.vue";
import PluginSettings from "./plugin.vue";
import type TreeView from "./tree.vue";
import {
	current,
	dialogFork,
	dialogSelect,
	getFullName,
	hasCoreDeps,
	plugins,
	removeItem,
	type Tree,
} from "./utils";

const route = useRoute();
const router = useRouter();

/**
 * 当前选中路径：与路由参数双向绑定。
 * 路径不在配置树中时回退到根节点（空串）。
 */
const path = computed<string>({
	get() {
		const name = route.path.slice(9);
		return name in plugins.value.paths ? name : "";
	},
	set(name) {
		if (!(name in plugins.value.paths)) name = "";
		router.replace("/plugins/" + name);
	},
});

const config = ref();
const input = ref("");
const inputEl = ref();
const tree = ref<InstanceType<typeof TreeView>>();

/** 弹窗打开后聚焦输入框（等待 DOM 渲染完成）。 */
async function handleOpen() {
	// https://github.com/element-plus/element-plus/issues/15250
	await nextTick();
	inputEl.value?.focus();
}

const remove = ref<Tree>();
const showRemove = ref(false);
const rename = ref<Tree>();
const showRename = ref(false);
const groupCreate = ref<string>(null);

watch(remove, (value) => {
	if (value) showRemove.value = true;
});

watch(rename, (value) => {
	if (value) showRename.value = true;
});

// 选中节点变化时同步 current,并把其配置克隆一份作为编辑副本
watch(
	() => plugins.value.paths[path.value],
	(value) => {
		current.value = value;
		config.value = clone(value.config);
	},
	{ immediate: true },
);

const ctx = useContext();

// 把当前选中节点注册为 config.tree 动作上下文,供菜单项动态取值
ctx.define("config.tree", current);

// 添加插件:仅分组节点与根节点可用,打开插件选择弹窗
ctx.action("config.tree.add-plugin", {
	hidden: ({ config }) => config.tree.path && !config.tree.children,
	action: ({ config }) => (dialogSelect.value = config.tree),
});

// 添加分组:仅分组节点与根节点可用,打开创建分组弹窗
ctx.action("config.tree.add-group", {
	hidden: ({ config }) => config.tree.path && !config.tree.children,
	action: ({ config }) => {
		groupCreate.value = config.tree.path;
	},
});

/** 在当前分组下创建子分组（随机 ident）并跳转过去。 */
function createGroup($label: string) {
	const ident = Math.random().toString(36).slice(2, 8);
	send(`manager/reload`, groupCreate.value, `group:${ident}`, { $label });
	router.replace("/plugins/" + ident);
	groupCreate.value = null;
}

// 克隆配置:以停用态在紧随原配置的位置复制一份并跳转
ctx.action("config.tree.clone", {
	hidden: ({ config }) => !config.tree.path || !!config.tree.children,
	action: async ({ config }) => {
		const children = config.tree.parent.path
			? config.tree.parent.children
			: plugins.value.data.slice(1);
		const index = children.findIndex((tree) => tree.path === config.tree.path);
		const ident = Math.random().toString(36).slice(2, 8);
		send(
			"manager/unload",
			config.tree.parent?.path ?? "",
			`${config.tree.name}:${ident}`,
			config.tree.config,
			index + 1,
		);
		router.replace(`/plugins/${ident}`);
	},
});

// 管理多份配置:打开 fork 管理弹窗
ctx.action("config.tree.manage", {
	hidden: ({ config }) => !config.tree.path || !!config.tree.children,
	action: async ({ config }) => {
		dialogFork.value = config.tree.name;
	},
});

// 重命名:打开重命名弹窗,写入 $label 元数据
ctx.action("config.tree.rename", {
	disabled: ({ config }) => !config.tree.path,
	action: ({ config }) => {
		input.value =
			config.tree.label ||
			(config.tree.name === "group" ? config.tree.path : config.tree.name);
		rename.value = config.tree;
	},
});

// 移除:核心插件不可移除,其余弹出二次确认
ctx.action("config.tree.remove", {
	disabled: ({ config }) => !config.tree.path || hasCoreDeps(config.tree),
	action: ({ config }) => (remove.value = config.tree),
});

/**
 * 用插件的 schema 校验当前编辑副本。
 *
 * @param name 插件短名
 * @returns 校验通过（或插件无 schema）为 true，否则弹出错误提示
 */
function checkConfig(name: string) {
	let schema = store.packages[getFullName(name)]?.runtime.schema;
	if (!schema) return true;
	try {
		new Schema(schema)(config.value);
		return true;
	} catch {
		message.error("当前配置项不满足约束，请检查配置！");
		return false;
	}
}

// 保存/重载配置(ctrl+s):根节点走整份重载,其余按启停态走 unload/reload
ctx.action("config.tree.save", {
	shortcut: "ctrl+s",
	disabled: (scope) =>
		!scope?.config?.tree ||
		!["config"].includes(router.currentRoute.value?.meta?.activity.id),
	action: async ({ config: { tree } }) => {
		const { disabled, path } = tree;
		if (!disabled && !checkConfig(tree.name)) return;
		if (!path) return send("manager/app-reload", config.value);
		try {
			await execute(tree, disabled ? "unload" : "reload");
			message.success(disabled ? "配置已保存。" : "配置已重载。");
		} catch (error) {
			message.error("操作失败，请检查日志！");
		}
	},
});

// 启用/停用切换:核心插件不可操作;启用前先做 schema 校验
ctx.action("config.tree.toggle", {
	disabled: ({ config }) => !config.tree.path || hasCoreDeps(config.tree),
	action: async ({ config: { tree } }) => {
		const { disabled, name } = tree;
		if (disabled && !checkConfig(tree.name)) return;
		try {
			await execute(tree, disabled ? "reload" : "unload");
			message.success(
				(name === "group" ? "分组" : "插件") +
					(disabled ? "已启用。" : "已停用。"),
			);
		} catch (error) {
			message.error("操作失败，请检查日志！");
		}
	},
});

/** 把启停/重载事件连同编辑副本一并发送给服务端。 */
async function execute(tree: Tree, event: "unload" | "reload") {
	await send(
		`manager/${event}`,
		tree.parent?.path ?? "",
		tree.id,
		config.value,
	);
}

/** 确认重命名：更新本地标签并把 $label 元数据写入配置（空名即删除）。 */
function renameItem(tree: Tree, name: string) {
	showRename.value = false;
	tree.label = name;
	send("manager/meta", tree.path, { $label: name || null });
}
</script>

<style lang="scss">

.end {
  margin-right: 0.5rem;
}

.config-header {
  font-size: 1.375rem;
  margin: 0 0 2rem;
  line-height: 2rem;

  .k-button {
    float: right;
  }
}

.plugin-view .k-content > *:first-child {
  margin-top: 0;
}

</style>
