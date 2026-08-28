import type { EntryData } from "@koishi-ce/plugin-console";
import type { EffectScope } from "cordis";
import type { Dict } from "cosmokit";
import { type Ref, ref, shallowReactive, watch } from "vue";
import type { Context } from "../context";
import { receive, store } from "../data";
import { Service } from "../utils";

declare module "../context" {
	interface Context {
		$loader: LoaderService;
		extension?: LoadResult;
	}
}

/** 取消函数 */
export type Disposable = () => void;
/** 扩展入口函数：以插件形式安装到控制台上下文 */
export type Extension = (ctx: Context) => void;

/** 标记一个函数为扩展入口（仅类型层面，便于构建工具识别） */
export function defineExtension(callback: Extension) {
	return callback;
}

/** 兼容 rollup 与 vite 两种产物：优先取 default 导出 */
export function unwrapExports(module: any) {
	return module?.default || module;
}

/** 按文件后缀分发的加载器：样式表插入 <link>，其余按动态模块导入 */
const loaders: Dict<(ctx: Context, url: string) => Promise<void>> = {
	async [`.css`](ctx, url) {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = url;
		// 等待样式真正加载完成后再插入文档，避免无样式闪烁；
		// link 的挂载/卸载纳入 ctx.effect，随扩展作用域销毁而移除
		await new Promise((resolve, reject) => {
			link.onload = resolve;
			link.onerror = reject;
			ctx.effect(() => {
				document.head.appendChild(link);
				return () => document.head.removeChild(link);
			});
		});
	},
	async [``](ctx, url) {
		const exports = await import(/* @vite-ignore */ url);
		ctx.plugin(unwrapExports(exports), ctx.extension?.data);
	},
};

/** 单个扩展的加载结果：独立作用域 + 数据 ref + 完成标记 */
export interface LoadResult {
	scope: EffectScope;
	paths?: string[] | undefined;
	done: Ref<boolean>;
	data: Ref;
}

/**
 * 扩展加载服务：根据服务端推送的 entry 数据动态加载各控制台扩展
 * （样式表与 JS 模块），并为每个扩展创建隔离的作用域。
 *
 * 服务端入口集合变化时做增量同步：新增的加载、消失的卸载；
 * 后端实例 id 变化（服务重启）则整页刷新。
 */
export default class LoaderService extends Service {
	/** 最近一次见到的后端实例 id（用于检测服务端重启） */
	private backendId: any;

	/** 当前已加载扩展的 id → LoadResult 映射 */
	public extensions: Dict<LoadResult> = shallowReactive({} as Dict<LoadResult>);

	constructor(ctx: Context) {
		super(ctx, "$loader", true);

		// 服务端推送扩展入口的随附数据（entry-data）：
		// 同步到 store.entry 并刷新已加载扩展的 data ref
		receive("entry-data", ({ id, data }) => {
			const entry = store.entry?.[id];
			if (!entry) return;
			entry.data = data;
			const extension = this.extensions[id];
			if (extension) extension.data.value = data;
		});
	}

	/**
	 * 初始加载任务：监听 store.entry（deep），完成首次全量加载时 resolve。
	 * context.ts 的 ready 阶段会 await 本任务，再挂载 i18n / router。
	 */
	initTask = new Promise<void>((resolve) => {
		watch(
			() => store.entry,
			async (newValue, oldValue) => {
				// _id 标识后端实例：变化说明服务端已重启，页面状态不再可信
				const { _id, ...rest } = (newValue || {}) as Dict<EntryData>;
				if (this.backendId && _id && this.backendId !== _id) {
					window.location.reload();
					return;
				}
				this.backendId = _id;

				// 增量卸载：入口列表中已消失的扩展，销毁其作用域
				for (const key in this.extensions) {
					if (rest[key]) continue;
					this.extensions[key]?.scope.dispose();
					delete this.extensions[key];
				}

				await Promise.all(
					Object.entries(rest).map(([key, { files, paths, data }]) => {
						if (this.extensions[key]) return;
						// 每个扩展在隔离的 "extension" 作用域中运行，
						// 并通过 ctx.extension 拿到自己的加载结果
						const scope = this.ctx.isolate("extension").plugin(() => {});
						scope.ctx.extension = this.extensions[key] = {
							done: ref(false),
							scope,
							paths,
							data: ref(data),
						};
						// 依次加载入口声明的全部文件，按后缀分发给对应 loader
						const task = Promise.all(
							files.map((url) => {
								for (const ext in loaders) {
									if (!url.endsWith(ext)) continue;
									return loaders[ext]?.(scope.ctx, url);
								}
							}),
						);
						task.finally(() => {
							const extension = this.extensions[key];
							if (extension) extension.done.value = true;
						});
					}),
				);

				// 首次加载完成（oldValue 为空）时放行 initTask
				if (!oldValue) resolve();
			},
			{ deep: true },
		);
	});
}
