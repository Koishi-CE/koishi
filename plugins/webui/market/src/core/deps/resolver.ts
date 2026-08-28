/**
 * @file 依赖解析器:宿主 package.json 依赖快照与 latest 元数据刷新(core/deps 域)。
 *
 * 模块职责:
 * - `getLocalDepsSnapshot`:读取宿主 package.json,逐包解析已装版本与
 *   workspace 标记,并做来源分类(local/bound/invalid),全程只碰本地磁盘
 *   (逐包解析纯函数位于 snapshot.ts);
 * - `refreshDependencyMetadata`:p-map 并发拉取各依赖的 registry 元数据填充 latest,
 *   全路由 404 的条目归类为"未绑定本地插件"(单包协程位于 metadata-refresh.ts);
 * - 两档重建:`reload()`(轻量,安装回滚后)与 `resetForRefresh()`(全量,刷新入口)。
 *
 * 关键设计:
 * - depTask 单飞去重并发刷新;serial(RequestScope)防止过期结果覆盖新一轮数据;
 * - 快照重建时尽量复用上一轮 depCache 的已确认来源与 latest,避免前端闪烁;
 * - 成块移植自旧 Installer 的依赖相关方法,算法未改。
 *
 * 架构位置:core 领域层 deps 模块,被 install/orchestrator 与 node 适配层消费;
 * registry 缓存、路由探测、日志等 I/O 全部经构造注入的 deps 对象访问。
 */
import type { Dict } from "@koishi-ce/koishi";
import pMap from "p-map";
import { classifyRegistryNotFoundDependency } from "../../shared/dependency-source.js";
import type { RequestScope } from "../racing/request-scope.js";
import type { PackageCache } from "../registry/cache/index.js";
import type { RegistryErrorDetail } from "../registry/errors.js";
import {
	loadManifest,
	type PackageJson,
	pickMetadataProbe,
	Scanner,
} from "../registry/manifest.js";
import { refreshDependencyLatest } from "./metadata-refresh.js";
import {
	collectDependencyRequests,
	resolveLocalDependency,
} from "./snapshot.js";
import type { Dependency } from "./types.js";

/** DependencyResolver 的构造注入面:core 层禁直接 I/O,全部外部能力从这里进。 */
export interface DependencyResolverDeps {
	/** 宿主工作目录(package.json 与 node_modules 所在地) */
	cwd: () => string;
	/** registry 包版本缓存:latest 数据来源,兼读 404 负缓存 */
	cache: PackageCache;
	/** 竞速失效域:元数据刷新跨越多轮请求时判定结果是否陈旧 */
	scope: RequestScope;
	/** 元数据并发上限(未配置时回退 4) */
	concurrency: () => number | undefined;
	/** 异常归因(接 registry errors 的 formatError,产出 reason/error) */
	formatError: (error: unknown) => RegistryErrorDetail;
	/** 元数据刷新前的路由探测预热（client.ensureMetadataEndpoint） */
	ensureProbe: (name: string) => Promise<void>;
	log: {
		debug(message: string): void;
		info(message: string): void;
		warn(message: string): void;
	};
	/** 元数据刷新完成后的通道刷新（console.refresh('dependencies')） */
	onMetadataRefreshed: () => void;
}

/** 依赖快照与 latest 元数据刷新。成块移植自旧 Installer 的依赖相关方法。 */
export class DependencyResolver {
	/** 宿主 package.json(延迟加载,reloadManifest 重置) */
	private manifest: PackageJson | undefined;
	/** 最近的依赖快照(getDeps 的同步返回值) */
	private depCache: Dict<Dependency> = {};
	/** 进行中的元数据刷新任务(单飞去重:并发调用复用同一任务) */
	private depTask: Promise<Dict<Dependency>> | undefined;
	/** 本轮快照的 latest 是否已刷新完成(控制 onMetadataRefreshed 只触发一次) */
	private depMetadataFresh = false;
	private readonly deps: DependencyResolverDeps;

	constructor(deps: DependencyResolverDeps) {
		this.deps = deps;
	}

	/** 重载宿主 package.json（安装后/刷新前调用）。 */
	reloadManifest() {
		this.manifest = loadManifest(this.deps.cwd());
	}

	/**
	 * 构建宿主依赖的本地快照:以 manifest 请求范围为底,逐包 loadManifest 补已装
	 * 版本与 workspace 标记,叠加来源分类,并尽量复用上一轮缓存的已确认来源与
	 * latest。纯本地磁盘读取、不发网络请求;返回全新对象,不回写 depCache
	 * (由调用方决定赋值时机)。逐包解析见 snapshot.ts 的 resolveLocalDependency。
	 */
	getLocalDepsSnapshot(): Dict<Dependency> {
		const start = Date.now();
		this.manifest ??= loadManifest(this.deps.cwd());
		const manifest = this.manifest;
		const result = collectDependencyRequests(manifest);
		const names = Object.keys(result);
		for (const name of names) {
			resolveLocalDependency(name, result[name]!, {
				cwd: this.deps.cwd(),
				cache: this.deps.cache,
				log: this.deps.log,
				previous: this.depCache[name],
			});
		}
		const installed = Object.values(result).filter(
			(dep) => dep.resolved,
		).length;
		const invalid = Object.values(result).filter((dep) => dep.invalid).length;
		this.deps.log.info(
			`dependency local snapshot ready: total=${names.length}, installed=${installed}, invalid=${invalid}, elapsed=${Date.now() - start}ms`,
		);
		return result;
	}

	markRegistryNotFoundDependency(
		name: string,
		dependency: Dependency | undefined = this.depCache[name],
	) {
		const source = classifyRegistryNotFoundDependency(
			dependency,
			Scanner.isPlugin(name),
		);
		if (!source || !dependency) return false;
		Object.assign(dependency, source);
		dependency.invalid = false;
		delete dependency.latest;
		this.deps.log.info(
			`dependency classified as unbound local plugin: ${name}@${dependency.resolved}`,
		);
		return true;
	}

	private async refreshMetadata(
		result = this.depCache,
		serial = this.deps.scope.current,
	) {
		const start = Date.now();
		const names = Object.keys(result);
		const targets = names.filter(
			(name) => !result[name]!.local && !result[name]!.invalid,
		);
		this.deps.log.debug(
			`refresh dependency metadata started: total=${names.length}, targets=${targets.length}, concurrency=${this.deps.concurrency() ?? 4}`,
		);
		const probeName = pickMetadataProbe(targets);
		if (probeName) await this.deps.ensureProbe(probeName);
		this.deps.log.debug(
			`refresh dependency metadata route ready: probe=${probeName ?? "-"}`,
		);
		await pMap(
			targets,
			(name) =>
				refreshDependencyLatest({
					name,
					entry: result[name]!,
					serial,
					deps: this.deps,
					markNotFound: (dependency) =>
						this.markRegistryNotFoundDependency(name, dependency),
				}),
			{ concurrency: this.deps.concurrency() ?? 4 },
		);
		this.deps.log.info(
			`dependency metadata refresh completed: total=${names.length}, targets=${targets.length}, elapsed=${Date.now() - start}ms`,
		);
		if (!this.deps.scope.isStale(serial)) {
			this.depMetadataFresh = true;
			this.deps.onMetadataRefreshed();
		}
		return result;
	}

	refreshDependencyMetadata(wait = false) {
		if (this.depMetadataFresh)
			return wait ? Promise.resolve(this.depCache) : undefined;
		if (!this.depTask) {
			const task = this.refreshMetadata(this.depCache, this.deps.scope.current);
			this.depTask = task;
			task.then(
				() => {
					if (this.depTask === task) this.depTask = undefined;
				},
				(error: unknown) => {
					if (this.depTask === task) this.depTask = undefined;
					this.deps.log.warn(
						`dependency metadata refresh failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				},
			);
		}
		return wait ? this.depTask : undefined;
	}

	getDeps(options: { metadata?: boolean; background?: boolean } = {}) {
		if (!Object.keys(this.depCache).length) {
			this.depCache = this.getLocalDepsSnapshot();
		}
		if (options.metadata) return this.refreshDependencyMetadata(true);
		if (options.background !== false)
			void this.refreshDependencyMetadata(false);
		return this.depCache;
	}

	/** 轻量重建：重载 manifest + 重建本地快照（不清包缓存），用于安装回滚后。 */
	reload() {
		this.reloadManifest();
		this.depMetadataFresh = false;
		this.depCache = this.getLocalDepsSnapshot();
		return this.depCache;
	}

	/** 全量重置（refresh/probe 入口调用）：清缓存与元数据状态，重建本地快照。 */
	resetForRefresh() {
		this.deps.cache.clear();
		this.depTask = undefined;
		return this.reload();
	}
}
