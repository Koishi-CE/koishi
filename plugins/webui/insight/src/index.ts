/**
 * insight 插件（node 侧）。
 *
 * 通过 `DataService` 向浏览器端推送当前运行时的插件依赖图数据：
 * 遍历 ctx.registry 中所有插件运行时，将每个 EffectScope 抽象为节点（Node），
 * 将插件间的调用关系与服务注入关系抽象为边（Link），供前端以力导向图渲染。
 * 监听 internal/fork、internal/runtime、internal/service、internal/status
 * 等内部事件，并在下一拍防抖触发整体刷新。
 */

import { resolve } from "node:path";
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
import type {} from "@koishi-ce/loader";

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			insight: Insight;
		}
	}
}

/** 将插件的短横线命名转为大驼峰显示名（如 `plugin-foo` → `PluginFoo`）。 */
function format(name: string) {
	return capitalize(camelize(name));
}

/**
 * 取插件显示名：无插件对象视为根应用（App）；
 * 匿名函数或名为 `apply` 的插件显示为 Anonymous，其余走 format 格式化。
 */
function getName(plugin: Plugin) {
	if (!plugin) return "App";
	if (!plugin.name || plugin.name === "apply") return "Anonymous";
	return format(plugin.name);
}

/**
 * 取 fork 的来源节点 id：父级本身可 fork 时父级的 uid 即来源，
 * 否则取父级运行时的 uid（父级与运行时同体）。
 */
function getSourceId(child: ForkScope) {
	const { state } = child.parent;
	if (state.runtime.isForkable) {
		return state.uid;
	} else {
		return state.runtime.uid;
	}
}

/**
 * 依赖图数据服务：把 cordis 运行时的插件 / 服务拓扑整理为图数据，
 * 以 `insight` 服务名暴露给 console，浏览器端据此渲染力导向图。
 */
class Insight extends DataService<Insight.Payload> {
	// 配置 schema 的值侧由类静态承载(erasableSyntaxOnly 不允许 namespace 内运行时值),
	// 类型侧见下方 namespace Insight 的 Config
	static Config: Schema<Insight.Config> = Schema.object({});

	constructor(ctx: Context) {
		super(ctx, "insight");

		ctx.console.addEntry(
			process.env["KOISHI_BASE"]
				? [
						`${process.env["KOISHI_BASE"]}/dist/index.js`,
						`${process.env["KOISHI_BASE"]}/dist/style.css`,
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

	/**
	 * 采集当前依赖图快照。
	 *
	 * 遍历 registry 中每个插件运行时，先生成"哪个 scope 提供了哪些服务"的
	 * 反查表（services），再按上节三类插件规则生成节点与边：
	 * 实线（solid）表示插件调用 / fork 关系，虚线（dashed）表示服务注入。
	 *
	 * @returns 包含全部节点（nodes）与边（edges）的 Payload
	 */
	override async get() {
		const nodes: Insight.Node[] = [];
		const edges: Insight.Link[] = [];

		// 建立"scope uid -> 其上下文中注册的服务名列表"的映射,
		// 供节点附带 services 字段（服务的提供者通过 Context.current 反查所在 scope）
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
			// 假设图中有以下几类节点：
			// - A、B：父级插件状态（调用方）
			// - X、Y：目标插件的 fork 状态
			// - M：    目标插件的主状态
			// - S：    被依赖的服务

			// 插件按可复用性分三类展示：
			// 1. 完全可复用插件（reusable 且无主状态逻辑）
			//    展示为 A -> X -> S，B -> Y -> S
			// 2. 部分可复用插件
			//    展示为 A -> X -> M -> S，B -> Y -> M -> S
			// 3. 不可复用插件
			//    展示为 A -> M -> S，B -> M -> S

			function isActive(_state: EffectScope) {
				// 原本可在此排除因依赖缺失而未生效的插件，即：
				// return runtime.using.every(name => _state.ctx[name])
				return true;
			}

			const name = getName(runtime.plugin);

			/** 将一个 EffectScope 输出为图节点：weight 取 disposables 数量，附加分组/根/服务标记。 */
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

			/** 追加一条边：实线（solid）表示调用/fork，虚线（dashed）表示服务注入。 */
			function addEdge(
				type: "dashed" | "solid",
				source: number | null,
				target: number | null,
			) {
				// 已销毁的 scope(uid 为 null)不参与连线
				if (source == null || target == null) return;
				edges.push({ type, source, target });
			}

			/** 为指定 scope 的必需注入（inject 中 required 的服务）生成虚线依赖边。 */
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
	/** 推送给浏览器端的依赖图数据结构。 */
	export interface Payload {
		nodes: Node[];
		edges: Link[];
	}

	/** 图节点：对应一个插件 EffectScope，weight 影响前端节点视觉权重。 */
	export interface Node {
		uid: number;
		name: string;
		weight: number;
		status: ScopeStatus;
		isGroup?: boolean;
		isRoot?: boolean;
		services?: string[];
	}

	/** 图边：solid 为插件调用/fork 关系，dashed 为服务注入关系。 */
	export interface Link {
		type: "solid" | "dashed";
		source: number;
		target: number;
	}

	/** 插件配置类型（当前无可用配置项）。 */
	export type Config = Record<never, never>;
}

export default Insight;
