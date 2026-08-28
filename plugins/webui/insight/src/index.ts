import { DataService } from "@koishi-ce/console";
import {
	Context,
	camelize,
	capitalize,
	type EffectScope,
	type ForkScope,
	type Plugin,
	Schema,
	type ScopeStatus,
} from "@koishi-ce/koishi";
import {} from "@koishi-ce/loader";
import { resolve } from "path";

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			insight: Insight;
		}
	}
}

function format(name: string) {
	return capitalize(camelize(name));
}

function getName(plugin: Plugin) {
	if (!plugin) return "App";
	if (!plugin.name || plugin.name === "apply") return "Anonymous";
	return format(plugin.name);
}

function getSourceId(child: ForkScope) {
	const { state } = child.parent;
	if (state.runtime.isForkable) {
		return state.uid;
	} else {
		return state.runtime.uid;
	}
}

class Insight extends DataService<Insight.Payload> {
	// 配置 schema 的值侧由类静态承载(erasableSyntaxOnly 不允许 namespace 内运行时值),
	// 类型侧见下方 namespace Insight 的 Config
	// biome-ignore lint/style/useNamingConvention: 插件 Schema 约定为 PascalCase 的 Config 静态属性
	static Config: Schema<Insight.Config> = Schema.object({});

	constructor(ctx: Context) {
		super(ctx, "insight");

		ctx.console.addEntry(
			process.env["KOISHI_BASE"]
				? [
						process.env["KOISHI_BASE"] + "/dist/index.js",
						process.env["KOISHI_BASE"] + "/dist/style.css",
					]
				: process.env["KOISHI_ENV"] === "browser"
					? [import.meta.url.replace(/\/src\/[^/]+$/, "/client/index.ts")]
					: {
							dev: resolve(__dirname, "../client/index.ts"),
							prod: resolve(__dirname, "../dist"),
						},
		);

		const update = ctx.debounce(() => this.refresh(), 0);
		ctx.on("internal/fork", update);
		ctx.on("internal/runtime", update);
		ctx.on("internal/service", update);
		ctx.on("internal/status", update);
	}

	override async get() {
		const nodes: Insight.Node[] = [];
		const edges: Insight.Link[] = [];

		const services = {} as Record<number, string[]>;
		for (const [key, { type }] of Object.entries(
			this.ctx.root[Context.internal],
		)) {
			if (type !== "service") continue;
			const instance = this.ctx.get(key);
			if (!(instance instanceof Object)) continue;
			const ctx: Context = Reflect.getOwnPropertyDescriptor(
				instance,
				Context.current,
			)?.value;
			if (ctx?.scope.uid) {
				(services[ctx.scope.uid] ||= []).push(key);
			}
		}

		for (const runtime of this.ctx.registry.values()) {
			// Suppose we have the following types of nodes:
			// - A, B: parent plugin states
			// - X, Y: target fork states
			// - M:    target main state
			// - S:    service dependencies

			// We can divide plugins into three categories:
			// 1. fully reusable plugins
			//    will be displayed as A -> X -> S, B -> Y -> S
			// 2. partially reusable plugins
			//    will be displayed as A -> X -> M -> S, B -> Y -> M -> S
			// 3. non-reusable plugins
			//    will be displayed as A -> M -> S, B -> M -> S

			function isActive(_state: EffectScope) {
				// exclude plugins that don't work due to missing dependencies
				// return runtime.using.every(name => _state.ctx[name])
				return true;
			}

			const name = getName(runtime.plugin);

			function addNode(state: EffectScope) {
				const { uid, disposables, status } = state;
				// 已销毁的 scope 的 uid 会被置为 null,不生成节点
				if (uid == null) return;
				const weight = disposables.length;
				const isGroup = name === "Group";
				const isRoot = uid === 0;
				const node: Insight.Node = {
					uid,
					name,
					weight,
					status,
					isGroup,
					isRoot,
				};
				// 当前版本 cordis 的 scope 已无 key 字段,保留动态属性探测以兼容旧数据
				const key = "key" in state ? state.key : undefined;
				if (key) node.name += ` [${key}]`;
				const bound = services[uid];
				if (bound) node.services = bound;
				nodes.push(node);
			}

			function addEdge(
				type: "dashed" | "solid",
				source: number | null,
				target: number | null,
			) {
				// 已销毁的 scope(uid 为 null)不参与连线
				if (source == null || target == null) return;
				edges.push({ type, source, target });
			}

			const addDeps = (state: EffectScope) => {
				for (const [name, meta] of Object.entries(runtime.inject)) {
					if (!meta.required) continue;
					const instance = this.ctx.get(name);
					if (!(instance instanceof Object)) continue;
					const ctx: Context = Reflect.getOwnPropertyDescriptor(
						instance,
						Context.current,
					)?.value;
					const uid = ctx?.state.uid;
					if (!uid) continue;
					addEdge("dashed", uid, state.uid);
				}
			};

			const isReusable = runtime.plugin?.["reusable"];
			if (!isReusable) {
				if (!isActive(runtime)) continue;
				addNode(runtime);
				addDeps(runtime);
			}

			for (const fork of runtime.children) {
				if (runtime.isForkable) {
					if (!isActive(fork)) continue;
					addNode(fork);
					addEdge("solid", getSourceId(fork), fork.uid);
					if (!isReusable) {
						addEdge("solid", fork.uid, runtime.uid);
					} else {
						addDeps(fork);
					}
				} else {
					const last = nodes[nodes.length - 1];
					if (last) last.weight += fork.disposables.length;
					addEdge("solid", getSourceId(fork), runtime.uid);
				}
			}
		}

		return { nodes, edges };
	}
}

namespace Insight {
	export interface Payload {
		nodes: Node[];
		edges: Link[];
	}

	export interface Node {
		uid: number;
		name: string;
		weight: number;
		status: ScopeStatus;
		isGroup?: boolean;
		isRoot?: boolean;
		services?: string[];
	}

	export interface Link {
		type: "solid" | "dashed";
		source: number;
		target: number;
	}

	export type Config = {};
}

export default Insight;
