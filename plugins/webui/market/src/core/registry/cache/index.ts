/**
 * @file npm 包版本缓存(core/registry/cache 域)。
 *
 * PackageCache 三层结构:fullCache(全量版本表)、tempCache(待广播的
 * 增量,flush 后由适配层节流广播到前端)、notFoundCache(404 负缓存,
 * 5 分钟 TTL,避免反复探测不存在的包);pkgTasks 对同包并发请求做
 * 任务去重(单飞)。数据来源是 RegistryClient,版本集合按兼容性过滤。
 *
 * 架构位置:被 deps/resolver(latest 刷新)、market legacy 分析与 node
 * 适配层消费;onFlush 回调把通道广播细节留给外层。
 */
import type { Dict } from "@koishi-ce/koishi";
import type { RequestScope } from "../../racing/request-scope.js";
import { MINUTE } from "../../utils/time.js";
import type { RegistryClient } from "../client/index.js";
import {
	type DependencyMetaKey,
	filterCompatibleVersions,
	getVersions,
	type RemotePackage,
} from "../manifest.js";

/** 404 负缓存 TTL:5 分钟内不再重复请求确认过不存在的包。 */
const NOT_FOUND_CACHE_TTL = 5 * MINUTE;

/** 包 → 版本号 → 依赖元数据(latest 刷新只关心这几个字段)。 */
export type PackageVersions = Dict<Pick<RemotePackage, DependencyMetaKey>>;

/** PackageCache 的依赖面:registry 客户端、竞速域与广播回调。 */
export interface PackageCacheDeps {
	client: RegistryClient;
	scope: RequestScope;
	log: { debug(message: string): void; warn(message: string): void };
	/** tempCache 聚合后的通道广播（节流在适配层） */
	onFlush: () => void;
}

/**
 * 包版本缓存：fullCache（全量）/ tempCache（增量广播）/ notFoundCache（404 负缓存）三层
 * + pkgTasks 任务去重。成块移植自旧 Installer 的缓存方法。
 */
export class PackageCache {
	/** 包 → 版本表(全量,进程内累积) */
	fullCache: Dict<PackageVersions> = {};
	/** 包 → 版本表(本次更新待广播的增量,广播后语义上作废) */
	tempCache: Dict<PackageVersions> = {};
	/** 包 → 进行中的拉取任务(单飞去重) */
	private pkgTasks: Dict<Promise<PackageVersions | undefined>> = {};
	/** 包 → 404 时间戳(负缓存) */
	private notFoundCache: Dict<number> = {};
	private readonly deps: PackageCacheDeps;

	constructor(deps: PackageCacheDeps) {
		this.deps = deps;
	}

	/** 包的 404 时间戳(用于上游 5 分钟负缓存窗口判定,deps/resolver 消费)。 */
	notFoundAt(name: string) {
		return this.notFoundCache[name];
	}

	/** 包是否处于 404 负缓存有效期内(TTL 内不再发请求)。 */
	isNotFoundCached(name: string) {
		const notFoundAt = this.notFoundCache[name];
		return !!notFoundAt && Date.now() - notFoundAt < NOT_FOUND_CACHE_TTL;
	}

	/**
	 * 外部直接注入版本数据(如市场 legacy 分析的 onRegistryVersions 回调):
	 * 写入两层缓存、清除 404 负缓存,并把 pkgTasks 置为已完成的 promise
	 * 使后续 getPackage 直接命中。
	 */
	setPackage(name: string, versions: RemotePackage[]) {
		delete this.notFoundCache[name];
		this.fullCache[name] = this.tempCache[name] = getVersions(versions);
		this.flush();
		this.pkgTasks[name] = Promise.resolve(this.fullCache[name]);
	}

	/**
	 * 获取包版本表(带单飞去重):负缓存命中直接返回 undefined;
	 * 拉取失败且归因为 not-found 时写入负缓存时间戳,其余失败清掉任务
	 * 允许重试;成功结果常驻 pkgTasks(同包后续请求零成本)。
	 */
	getPackage(name: string) {
		if (this.isNotFoundCached(name)) {
			return Promise.resolve(undefined);
		}
		delete this.notFoundCache[name];
		if (!this.pkgTasks[name]) {
			const task = this._getPackage(name, this.deps.scope.current);
			this.pkgTasks[name] = task;
			task.then(
				(versions) => {
					// 任务已被新一轮顶替时不做清理,交由新任务自理
					if (this.pkgTasks[name] !== task) return;
					if (!versions) delete this.pkgTasks[name];
				},
				(error: unknown) => {
					if (this.pkgTasks[name] !== task) return;
					delete this.pkgTasks[name];
					const reason = this.deps.client.formatError(error).reason;
					if (reason === "not-found") this.notFoundCache[name] = Date.now();
				},
			);
		}
		return this.pkgTasks[name];
	}

	/**
	 * 批量找"任一包的最新版本":并行拉取,取第一个有版本结果的包
	 * (用于安装前的版本预判等场景)。
	 */
	async findVersion(names: string[]) {
		const entries = await Promise.all(
			names.map(async (name) => {
				try {
					const versions = Object.entries((await this.getPackage(name)) ?? {});
					if (!versions.length) return undefined;
					return { [name]: versions[0]![0] };
				} catch {
					// 单包失败不影响其他候选
					return undefined;
				}
			}),
		);
		return entries.find(Boolean);
	}

	/** 触发增量广播回调(节流与通道细节在适配层)。 */
	flush() {
		this.deps.onFlush();
	}

	/** 全量清空(依赖状态全量重置时调用)。 */
	clear() {
		this.pkgTasks = {};
		this.notFoundCache = {};
		this.fullCache = {};
		this.tempCache = {};
	}

	/** 拉取单包元数据并过滤出兼容版本,写入两层缓存后返回。 */
	private async _getPackage(
		name: string,
		serial: number,
	): Promise<PackageVersions | undefined> {
		try {
			const registry = await this.deps.client.getRegistry(name, serial);
			// 过期结果不落缓存:避免旧数据覆盖新一轮请求的结果
			if (this.deps.scope.isStale(serial)) return undefined;
			if (!registry) return undefined;
			delete this.notFoundCache[name];
			this.fullCache[name] = this.tempCache[name] = filterCompatibleVersions(
				name,
				registry,
			);
			this.flush();
			return this.fullCache[name];
		} catch (error) {
			this.deps.log.warn(
				error instanceof Error ? error.message : String(error),
			);
			throw error;
		}
	}
}
