import { router, ScopeStatus, send, store } from "@koishi-ce/client";
import type { Context, Dict } from "@koishi-ce/koishi";
import type { PackageProvider } from "@koishi-ce/plugin-config";
import { computed, ref } from "vue";

interface DepInfo {
	required: boolean;
}

interface PeerInfo {
	required: boolean;
	active: boolean;
}

export interface EnvInfo {
	impl: string[];
	using: Dict<DepInfo>;
	peer: Dict<PeerInfo>;
	warning?: boolean;
}

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// store 的键与 send 的事件类型均来自 packages/web/client/client/shims.d.ts 的
// 手写环境声明;这里按同名环境声明合并补齐本插件的服务与事件,与服务端
// src/shared/index.ts、src/shared/writer.ts 对 "@koishi-ce/console" 的声明一一对应
declare module "@koishi-ce/plugin-console" {
	interface Events {
		"manager/app-reload"(config: any): void;
		"manager/teleport"(
			source: string,
			key: string,
			target: string,
			index: number,
		): void;
		"manager/reload"(parent: string, key: string, config: any): void;
		"manager/unload"(
			parent: string,
			key: string,
			config: any,
			index?: number,
		): void;
		"manager/remove"(parent: string, key: string): void;
		"manager/meta"(ident: string, config: any): void;
	}

	namespace Console {
		export interface Services {
			packages: DataService<Dict<PackageProvider.Data>>;
			services: DataService<Dict<number>>;
			config: DataService<Context.Config>;
		}
	}
}

export const dialogFork = ref<string>();
export const dialogSelect = ref<Tree>();

export const coreDeps = [
	"@koishi-ce/plugin-console",
	"@koishi-ce/plugin-config",
	"@koishi-ce/plugin-server",
];

export function hasCoreDeps(tree: Tree) {
	if (
		tree.name &&
		(coreDeps.includes("@koishi-ce/plugin-" + tree.name) ||
			coreDeps.includes("@koishijs/plugin-" + tree.name))
	)
		return true;
	if (tree.children) return tree.children.some(hasCoreDeps);
}

function getEnvInfo(name: string) {
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

	// check peer dependencies
	for (const name in local.package.peerDependencies ?? {}) {
		if (
			!name.includes("@koishi-ce/plugin-") &&
			!name.includes("@koishijs/plugin-") &&
			!name.includes("koishi-plugin-")
		)
			continue;
		if (coreDeps.includes(name)) continue;
		const required = !local.package.peerDependenciesMeta?.[name]?.optional;
		const active = !!packages[name]?.runtime?.id;
		result.peer[name] = { required, active };
		for (const service of packages[name]?.manifest?.service.implements ?? []) {
			services.add(service);
		}
	}

	// check implementations
	for (const name of local.manifest.service.implements) {
		if (name === "adapter") continue;
		result.impl.push(name);
	}

	// check services
	for (const name of local.runtime?.required ?? []) {
		setService(name, true);
	}
	for (const name of local.runtime?.optional ?? []) {
		setService(name, false);
	}

	// check reusability
	if (local.runtime?.id && !local.runtime?.forkable) {
		result.warning = true;
	}

	// check schema
	if (!local.runtime?.schema) {
		result.warning = true;
	}

	return result;
}

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

export interface Tree {
	id: string;
	name: string;
	path: string;
	label?: string;
	config?: any;
	parent?: Tree;
	disabled?: boolean;
	children?: Tree[];
}

export const current = ref<Tree>();

export function getFullName(shortname: string) {
	if (!shortname) return shortname;
	if (shortname.includes("/")) {
		const [left, right] = shortname.split("/");
		return [`${left}/koishi-plugin-${right}`].find(
			(name) => name in (store.packages || {}),
		);
	}
	return [`@koishijs/plugin-${shortname}`, `koishi-plugin-${shortname}`].find(
		(name) => name in (store.packages || {}),
	);
}

export const name = computed(() => {
	if (!current.value) return;
	return getFullName(current.value.name);
});

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

function getTree(parent: Tree, plugins: any): Tree[] {
	const trees: Tree[] = [];
	for (let key in plugins) {
		if (key.startsWith("$")) continue;
		const config = plugins[key];
		const node = { config, parent } as Tree;
		if (key.startsWith("~")) {
			node.disabled = true;
			key = key.slice(1);
		}
		node.name = key.split(":", 1)[0] ?? "";
		node.id = key;
		node.path = key.slice(node.name.length + 1);
		node.label = config?.$label;
		if (key.startsWith("group:")) {
			node.children = getTree(node, config);
		}
		trees.push(node);
	}
	return trees;
}

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
	function traverse(tree: Tree) {
		if (!tree.config?.$collapsed && tree.children) {
			expanded.push(tree.path);
		}
		(forks[tree.name] ||= []).push(tree.path);
		paths[tree.path] = tree;
		tree.children?.forEach(traverse);
	}
	return { data, forks, paths, expanded };
});

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

export async function removeItem(tree: Tree) {
	void send("manager/remove", tree.parent?.path ?? "", tree.id);
	await router.replace("/plugins/" + tree.parent!.path);
}
