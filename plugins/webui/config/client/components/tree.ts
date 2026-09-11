// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 配置树的派生视图与共享状态（原 components/utils.ts 拆出）。
 *
 * 由 store.config（服务端推送的配置）派生出配置树 plugins
 * （data / forks / paths / expanded 四个视图），并维护跨组件
 * 共享的响应式状态（current、dialogFork、dialogSelect）。
 */
import {
	root as rootContext,
	router,
	ScopeStatus,
	send,
	store,
} from "@koishi-ce/client";
import type { Dict } from "@koishi-ce/koishi";
import { computed, ref } from "vue";
import { coreDeps, envMap } from "./env-info.ts";

declare module "@koishi-ce/client" {
	interface ActionContext {
		"config.tree": Tree;
	}
}

/**
 * 配置树节点。name 是插件短名，id 是配置键（`name:ident`），
 * path 是去掉插件名前缀的路径标识，与路由 /plugins/:name 对应。
 */
export interface Tree {
	/** 配置键（形如 `name:ident`，分组为 `group:ident`） */
	id: string;
	/** 插件短名（分组为 "group"，根节点为空串） */
	name: string;
	/** 分组路径标识（根节点为空串），同时用作路由参数 */
	path: string;
	/** 用户自定义标签（$label），展示时代替插件名 */
	label?: string;
	/** 该节点的原始配置对象 */
	config?: unknown;
	parent?: Tree;
	/** 是否处于停用状态（配置键带 ~ 前缀） */
	disabled?: boolean;
	children?: Tree[];
}

/** fork 管理弹窗当前展示的插件名（非空即打开弹窗）。 */
export const dialogFork = ref<string>();

/** 插件选择弹窗当前的目标节点（非空即打开弹窗）。 */
export const dialogSelect = ref<Tree>();

/** 当前选中的配置树节点（随路由同步）。 */
export const current = ref<Tree>();

/**
 * 判断配置树节点（及其后代）中是否包含控制台核心插件。
 * 用于在右键菜单中禁用核心插件的"停用 / 移除"操作。
 *
 * @param tree 配置树节点
 */
export function hasCoreDeps(tree: Tree) {
	if (
		tree.name &&
		coreDeps.includes(getFullName(tree.name) ?? "")
	)
		return true;
	if (tree.children) return tree.children.some(hasCoreDeps);
}

/**
 * 把配置树节点名还原为完整包名（在 store.packages 中实际存在的那一个）。
 *
 * 兼容三种形态：
 * - `./plugins/...` 相对路径键（本仓库 koishi.yml 的统一写法）：
 *   按服务端在 packages 数据中标注的 paths 精确匹配；
 * - `@scope/name` 形式：为内层名补全社区前缀；
 * - 裸短名：本组织 @koishi-ce 优先，其次上游 @koishijs 与社区前缀。
 *
 * @param shortname 配置树节点名（插件短名或相对路径）
 * @returns 完整包名；找不到时为 undefined
 */
export function getFullName(shortname: string) {
	if (!shortname) return shortname;
	if (shortname.startsWith("./")) {
		return Object.values(store.packages ?? {}).find(
			(data) => data.paths?.includes(shortname),
		)?.package?.name;
	}
	if (shortname.includes("/")) {
		const [left, right] = shortname.split("/");
		return [`${left}/koishi-plugin-${right}`].find(
			(name) => name in (store.packages || {}),
		);
	}
	return [
		`@koishi-ce/plugin-${shortname}`,
		`@koishijs/plugin-${shortname}`,
		`koishi-plugin-${shortname}`,
	].find((name) => name in (store.packages || {}));
}

/** 当前选中插件的完整包名。 */
export const name = computed(() => {
	if (!current.value) return;
	return getFullName(current.value.name);
});

/**
 * 当前选中节点在配置树菜单中应显示的类型标记：
 * 存在警示（缺 schema / 注入服务未满足等）且处于停用态时为 "warning"，
 * 否则为空（正常）。
 */
export const type = computed(() => {
	const env = envMap.value[name.value ?? ""];
	if (!env) return;
	if (env.warning && current.value?.disabled)
		return "warning";
	for (const name in env.using) {
		if (name in (store.services || {})) {
			if (env.impl.includes(name)) return "warning";
		} else {
			if (env.using[name]?.required) return "warning";
		}
	}
});

/**
 * 把服务端推送的 plugins 配置对象递归转换为配置树节点列表。
 *
 * 解析规则：
 * - `$` 开头的键是内部控制字段（如 $label/$if），不生成节点；
 * - `~` 前缀表示停用态，拆出后记入 node.disabled；
 * - `group:ident` 键是分组，其值递归解析为 children。
 *
 * @param parent 父节点（用于回溯）
 * @param plugins 当前层级的 plugins 配置对象
 * @returns 节点列表（保持配置文件中的书写顺序）
 */
function getTree(
	parent: Tree,
	plugins: Record<string, unknown> | undefined,
): Tree[] {
	const trees: Tree[] = [];
	if (!plugins) return trees;
	for (let key in plugins) {
		if (key.startsWith("$")) continue;
		// 配置值本质是任意 JSON 对象（插件配置或嵌套分组），此处按字典收窄使用
		const config = plugins[key] as
			| Record<string, unknown>
			| undefined;
		const node = { config, parent } as Tree;
		if (key.startsWith("~")) {
			node.disabled = true;
			key = key.slice(1);
		}
		node.name = key.split(":", 1)[0] ?? "";
		node.id = key;
		node.path = key.slice(node.name.length + 1);
		const label = config?.$label as string | undefined;
		if (label !== undefined) node.label = label;
		if (key.startsWith("group:")) {
			node.children = getTree(node, config);
		}
		trees.push(node);
	}
	return trees;
}

/**
 * 配置树派生视图（随 store.config 自动更新），包含四部分：
 * - data：el-tree 的节点数据（根节点 + 各插件/分组）；
 * - expanded：初始展开的分组路径（未设置 $collapsed 的分组）；
 * - forks：插件短名 → 各份配置的路径列表；
 * - paths：路径 → 节点的索引表。
 */
export const plugins = computed(() => {
	const root: Tree = {
		name: "",
		id: "",
		path: "",
		// computed 内调用全局 t 会建立对 locale 的依赖，切语言时整棵树重算
		label: rootContext.$i18n.t(
			"config.view.globalSettings",
		),
		config: store.config,
		children: [],
	};
	const data = [root];
	const expanded: string[] = [];
	const forks: Dict<string[]> = {};
	const paths: Dict<Tree> = {
		"": root,
	};
	for (const node of getTree(root, store.config?.plugins)) {
		data.push(node);
		traverse(node);
	}
	/** 收集展开状态、fork 索引与路径索引。 */
	function traverse(tree: Tree) {
		const collapsed = (
			tree.config as Record<string, unknown> | undefined
		)?.$collapsed;
		if (!collapsed && tree.children) {
			expanded.push(tree.path);
		}
		(forks[tree.name] ||= []).push(tree.path);
		paths[tree.path] = tree;
		tree.children?.forEach(traverse);
	}
	return { data, forks, paths, expanded };
});

/**
 * 读取某个配置节点的运行状态灯样式。
 * 状态来自服务端 runtime.forks[path].status；无记录时视为已停用。
 *
 * @param tree 配置树节点
 */
export function getStatus(tree: Tree) {
	switch (
		store.packages?.[getFullName(tree.name) ?? ""]?.runtime
			?.forks?.[tree.path]?.status
	) {
		case ScopeStatus.PENDING:
			return "pending";
		case ScopeStatus.LOADING:
			return "loading";
		case ScopeStatus.ACTIVE:
			return "active";
		case ScopeStatus.FAILED:
			return "failed";
		case ScopeStatus.DISPOSED:
			return "disposed";
		default:
			return "disabled";
	}
}

/**
 * 移除某个配置节点：发送移除事件后跳回其父分组的配置页。
 *
 * @param tree 待移除的配置树节点
 */
export async function removeItem(tree: Tree) {
	const parent = tree.parent?.path ?? "";
	void send("manager/remove", parent, tree.id);
	await router.replace(`/plugins/${parent}`);
}
