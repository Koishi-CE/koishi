// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * config 插件浏览器端的共享工具与全局状态。
 *
 * 核心职责：
 * - 声明浏览器端的服务 / 事件类型（与服务端 shared/index.ts、writer.ts
 *   的声明合并一一对应）；
 * - 由 store.config（服务端推送的配置）派生出配置树 plugins
 *   （data / forks / paths / expanded 四个视图）；
 * - 由 store.packages 派生每个插件的依赖环境信息 envMap，
 *   供配置页展示"依赖 / 服务 / 可重用性"提示；
 * - 维护跨组件共享的响应式状态（current、dialogFork、dialogSelect）。
 */
import { router, ScopeStatus, send, store } from "@koishi-ce/client";
import type { Context, Dict } from "@koishi-ce/koishi";
import type { PackageProvider } from "@koishi-ce/plugin-config";
import { computed, ref } from "vue";

/** 单条"注入服务"依赖的信息。 */
interface DepInfo {
	/** 是否为必需依赖 */
	required: boolean;
}

/** 单条 peer 插件依赖的信息。 */
interface PeerInfo {
	/** 是否为必需的 peerDependency（未被 peerDependenciesMeta 标记为 optional） */
	required: boolean;
	/** 该依赖插件当前是否已加载 */
	active: boolean;
}

/** 插件依赖环境汇总，驱动配置页顶部的各项提示。 */
export interface EnvInfo {
	/** 本插件实现的服务列表 */
	impl: string[];
	/** 注入的服务依赖（using/inject），键为服务名 */
	using: Dict<DepInfo>;
	/** 插件级的 peer 依赖（其它 koishi 插件），键为包名 */
	peer: Dict<PeerInfo>;
	/** 是否存在需要警示用户的情况（不可重用已运行 / 未声明 schema） */
	warning?: boolean;
}

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// store 的键与 send 的事件类型均来自 packages/web/client/client/shims.d.ts 的
// 手写环境声明;这里按同名环境声明合并补齐本插件的服务与事件,与服务端
// src/shared/index.ts、src/shared/writer.ts 对 "@koishi-ce/console" 的声明一一对应
declare module "@koishi-ce/plugin-console" {
	interface Events {
		"manager/app-reload"(config: unknown): void;
		"manager/teleport"(
			source: string,
			key: string,
			target: string,
			index: number,
		): void;
		"manager/reload"(parent: string, key: string, config: unknown): void;
		"manager/unload"(
			parent: string,
			key: string,
			config: unknown,
			index?: number,
		): void;
		"manager/remove"(parent: string, key: string): void;
		"manager/meta"(ident: string, config: unknown): void;
	}

	namespace Console {
		export interface Services {
			packages: DataService<Dict<PackageProvider.Data>>;
			services: DataService<Dict<number>>;
			config: DataService<Context.Config>;
		}
	}
}

/** fork 管理弹窗当前展示的插件名（非空即打开弹窗）。 */
export const dialogFork = ref<string>();

/** 插件选择弹窗当前的目标节点（非空即打开弹窗）。 */
export const dialogSelect = ref<Tree>();

/** 控制台核心插件包名：这些插件不允许被停用或移除。 */
export const coreDeps = [
	"@koishi-ce/plugin-console",
	"@koishi-ce/plugin-config",
	"@koishi-ce/plugin-server",
];

/**
 * 判断配置树节点（及其后代）中是否包含控制台核心插件。
 * 用于在右键菜单中禁用核心插件的"停用 / 移除"操作。
 *
 * @param tree 配置树节点
 */
export function hasCoreDeps(tree: Tree) {
	if (tree.name && coreDeps.includes(getFullName(tree.name) ?? "")) return true;
	if (tree.children) return tree.children.some(hasCoreDeps);
}

/**
 * 解析 peer 依赖名在 store.packages 中的实际条目。上游名（@koishijs/plugin-*）
 * 在本生态里由 shim / npm alias 占名而非真实插件：仓内占位包被 LocalScanner
 * 剔除、下游 alias 落盘后又以真实包名为键，字面名查不到时回退查对应的
 * @koishi-ce/plugin-* 再分发名（两种形态下的真实提供者都是后者）。
 */
export function resolveProvider(
	packages: Dict<PackageProvider.Data> | undefined,
	name: string,
): PackageProvider.Data | undefined {
	const direct = packages?.[name];
	if (direct) return direct;
	if (!name.startsWith("@koishijs/plugin-")) return;
	return packages?.[
		`@koishi-ce/plugin-${name.slice("@koishijs/plugin-".length)}`
	];
}

/**
 * 汇总单个插件的依赖环境信息（peer 依赖 / 实现的服务 / 注入的服务 /
 * 可重用性 / schema 声明），包不存在时返回空骨架。
 *
 * @param name 插件完整包名
 */
function getEnvInfo(name: string) {
	/** 把服务名记入 using（已提供或 console 服务本身除外）。 */
	function setService(name: string, required: boolean) {
		if (services.has(name)) return;
		if (name === "console") return;
		result.using[name] = { required };
	}

	const result: EnvInfo = { impl: [], using: {}, peer: {} };
	const services = new Set<string>();
	const packages = store.packages;
	const local = packages?.[name];
	if (!packages || !local) return result;

	// 检查 peer 依赖:只关注 koishi 插件类依赖,并顺带收集其实现的服务
	for (const name in local.package.peerDependencies ?? {}) {
		if (
			!name.includes("@koishi-ce/plugin-") &&
			!name.includes("@koishijs/plugin-") &&
			!name.includes("koishi-plugin-")
		)
			continue;
		const provider = resolveProvider(packages, name);
		if (coreDeps.includes(provider?.name ?? name)) continue;
		const required = !local.package.peerDependenciesMeta?.[name]?.optional;
		const active = !!provider?.runtime?.id;
		result.peer[name] = { required, active };
		for (const service of provider?.manifest?.service.implements ?? []) {
			services.add(service);
		}
	}

	// 检查本插件实现的服务(adapter 服务由适配器体系单独处理,跳过)
	for (const name of local.manifest.service.implements) {
		if (name === "adapter") continue;
		result.impl.push(name);
	}

	// 检查注入的服务依赖:required 来自 inject.required,optional 来自其余
	for (const name of local.runtime?.required ?? []) {
		setService(name, true);
	}
	for (const name of local.runtime?.optional ?? []) {
		setService(name, false);
	}

	// 检查可重用性:已在运行且不可 fork 的插件,再启用一份可能出问题
	if (local.runtime?.id && !local.runtime?.forkable) {
		result.warning = true;
	}

	// 检查 schema:未声明配置项的插件通常并非预期
	if (!local.runtime?.schema) {
		result.warning = true;
	}

	return result;
}

/** 各插件的依赖环境信息表（键为完整包名，不含全局设置条目）。 */
export const envMap = computed(() => {
	return Object.fromEntries(
		Object.keys(store.packages ?? {})
			.filter((x) => x)
			.map((name) => [name, getEnvInfo(name)]),
	);
});

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

/** 当前选中的配置树节点（随路由同步）。 */
export const current = ref<Tree>();

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
		return Object.values(store.packages ?? {}).find((data) =>
			data.paths?.includes(shortname),
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
	if (env.warning && current.value?.disabled) return "warning";
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
		const config = plugins[key] as Record<string, unknown> | undefined;
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
		label: "全局设置",
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
		const collapsed = (tree.config as Record<string, unknown> | undefined)
			?.$collapsed;
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
		store.packages?.[getFullName(tree.name) ?? ""]?.runtime?.forks?.[tree.path]
			?.status
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
