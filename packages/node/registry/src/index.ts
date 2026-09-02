// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * npm 插件市场扫描器（远程侧）：面向 https://registry.npmjs.org 等
 * 兼容 npm registry 协议的源，完成「搜索收集 → 逐包分析」两阶段扫描，
 * 产出带 Koishi 清单（manifest）与兼容版本列表的 SearchObject 集合。
 *
 * 与 local.ts 的 LocalScanner（扫描本机 node_modules）相对，本模块
 * 消费方是市场 Web 服务等需要全量插件元数据的场景；HTTP 请求不由本模块
 * 发出，而是通过构造函数注入的 request 函数（见 ScanConfig）。
 */
import {
	type Awaitable,
	type Dict,
	defineProperty,
	isNonNullable,
	Time,
} from "cosmokit";
import pMap from "p-map";
import { compare, intersects } from "semver";
import type {
	Registry,
	RemotePackage,
	SearchObject,
	SearchResult,
} from "./types.ts";
import { conclude } from "./utils.ts";

export * from "./local.ts";
export * from "./types.ts";
export * from "./utils.ts";

/** collect 阶段（分页搜索）的配置 */
export interface CollectConfig {
	/** 每页拉取的条数 */
	step?: number;
	/** 相邻两页的重叠条数，容忍 registry 搜索结果的实时变动导致的漏项 */
	margin?: number;
	/** 单次请求超时（毫秒） */
	timeout?: number;
	/** 按包名跳过的插件清单 */
	ignored?: string[];
	endpoint?: string;
}

/** analyze 阶段（逐包分析）的配置与各阶段回调钩子 */
export interface AnalyzeConfig {
	/** 目标 Koishi 版本范围（semver range），用于筛选兼容的插件版本 */
	version: string;
	/** 并发数（p-map 控制同时分析的插件个数） */
	concurrency?: number;
	/** 每个对象开始分析前调用 */
	before?(object: SearchObject): void;
	/** 拿到某包的完整 registry 数据、筛选出兼容版本后调用（含已废弃版本） */
	onRegistry?(registry: Registry, versions: RemotePackage[]): Awaitable<void>;
	/** 单个包分析成功后调用 */
	onSuccess?(object: SearchObject, versions: RemotePackage[]): Awaitable<void>;
	/** 单个包分析抛错后调用（该包会被标记 ignored） */
	onFailure?(name: string, reason: unknown): Awaitable<void>;
	/** 单个包因无兼容版本被跳过后调用（该包会被标记 ignored） */
	onSkipped?(name: string): Awaitable<void>;
	/** 每个对象结束分析（无论成败）后调用 */
	after?(object: SearchObject): void;
}

/** 两个阶段的合并配置；request 由宿主注入实际的 HTTP 实现 */
export interface ScanConfig extends CollectConfig, AnalyzeConfig {
	request<T>(url: string): Promise<T>;
}

// 市场展示时要从 keywords 里剔除的停用词（与插件命名强相关，无区分度）
const stopWords = ["koishi", "plugin", "bot", "coolq", "cqhttp"];

/** 单次请求的附加配置（目前仅超时） */
export interface RequestConfig {
	timeout?: number;
}

/** 扫描结果：在 SearchResult 基础上追加 analyze 进度计数 */
export default interface Scanner extends SearchResult {
	progress: number;
}

/**
 * 远程插件扫描器。典型用法：collect() 分页拉取全部候选 → analyze()
 * 并发逐包取 registry 详情、过滤兼容版本并填充 manifest。
 */
export default class Scanner {
	/** 按包名去重的搜索结果缓存，跨页累积 */
	private cache!: Dict<SearchObject>;

	// erasableSyntaxOnly：参数属性需拆为显式字段声明
	public request: <T>(url: string, config?: RequestConfig) => Promise<T>;

	constructor(request: <T>(url: string, config?: RequestConfig) => Promise<T>) {
		this.request = request;
		defineProperty(this, "progress", 0);
		defineProperty(this, "cache", {});
	}

	/**
	 * 调用 registry 的搜索接口拉取一页结果并入缓存。
	 * @param offset 起始偏移（from 参数）
	 * @returns 本轮搜索命中的总数（total），用于判断是否还有下一页
	 */
	private async search(offset: number, config: CollectConfig) {
		const { step = 250, timeout = Time.second * 30 } = config;
		const result = await this.request<SearchResult>(
			`/-/v1/search?text=koishi+plugin&size=${step}&from=${offset}`,
			{ timeout },
		);
		if (result.version !== undefined) this.version = result.version;
		for (const object of result.objects) {
			this.cache[object.package.name] = object;
		}
		return result.total;
	}

	/**
	 * 第一阶段：分页搜索「koishi plugin」直至覆盖 total 条结果。
	 * 每页起点回退 margin 条以重叠上一页，对抗结果集实时变动；
	 * 最后按包名去重、剔除无发布时间 / 被忽略 / 非 Koishi 插件的条目。
	 */
	public async collect(config: CollectConfig = {}) {
		const { step = 250, margin = 25, ignored = [] } = config;
		this.cache = {};
		this.time = new Date().toUTCString();
		const total = await this.search(0, config);
		for (
			let offset = Object.values(this.cache).length;
			offset < total;
			offset += step - margin
		) {
			await this.search(offset - margin, config);
		}
		this.objects = Object.values(this.cache).filter((object) => {
			const { name, date } = object.package;
			// https://registry.npmjs.org 存在缺陷，`date` 字段可能为 `undefined`
			return (
				date &&
				!object.ignored &&
				!ignored.includes(name) &&
				Scanner.isPlugin(name)
			);
		});
		this.total = this.objects.length;
	}

	/** 判断包名是否为 Koishi 插件：官方 @koishijs/plugin-* 或社区 koishi-plugin-* */
	static isPlugin(name: string) {
		const official = /^@koishijs\/plugin-[0-9a-z-]+$/.test(name);
		const community = /(^|\/)koishi-plugin-[0-9a-z-]+$/.test(name);
		return official || community;
	}

	/**
	 * 判断某个已发布版本是否与目标 Koishi 版本范围兼容：
	 * 看它的 peerDependencies.koishi 声明是否与 range 有交集；
	 * 未声明 koishi peer 或 semver 解析失败一律视为不兼容。
	 */
	static isCompatible(
		range: string,
		remote: Pick<RemotePackage, "peerDependencies">,
	): boolean {
		const { peerDependencies = {} } = remote;
		const declaredVersion = peerDependencies["koishi"];
		try {
			return !!declaredVersion && intersects(range, declaredVersion);
		} catch {
			return false;
		}
	}

	/**
	 * 第二阶段的单包处理：拉取完整 registry 数据，筛出兼容且未废弃的
	 * 版本（按版本号降序），并用最新兼容版本填充短名、manifest、
	 * 分类、发布/更新时间、贡献者与清洗后的 keywords 等展示字段。
	 * @returns 兼容且未废弃的版本列表；无可用版本时返回 undefined（调用方跳过）
	 */
	public async process(
		object: SearchObject,
		range: string,
		onRegistry: AnalyzeConfig["onRegistry"],
	) {
		const { name } = object.package;
		const official = name.startsWith("@koishijs/plugin-");
		const registry = await this.request<Registry>(`/${name}`);
		const compatible = Object.values(registry.versions)
			.filter((remote) => {
				return Scanner.isCompatible(range, remote);
			})
			.sort((a, b) => compare(b.version, a.version));

		await onRegistry?.(registry, compatible);
		const versions = compatible.filter((item) => !item.deprecated);
		if (!versions.length) return;

		const first = versions[0];
		if (!first) return;
		const latest = registry.versions[first.version];
		if (!latest) return;
		const manifest = conclude(latest);
		const times = compatible.map((item) => registry.time[item.version]).sort();

		object.shortname = name.replace(/(koishi-|^@koishijs\/)plugin-/, "");
		object.verified = official;
		object.manifest = manifest;
		if (manifest.insecure !== undefined) object.insecure = manifest.insecure;
		if (manifest.category !== undefined) object.category = manifest.category;
		// versions 非空保证 compatible / times 非空（noUncheckedIndexedAccess 下显式收窄）
		const createdAt = times[0];
		const updatedAt = times[times.length - 1];
		if (createdAt === undefined || updatedAt === undefined) return;
		object.createdAt = createdAt;
		object.updatedAt = updatedAt;
		object.package.contributors ??= latest.author ? [latest.author] : [];
		object.package.keywords = (latest.keywords ?? [])
			.map((keyword) => keyword.toLowerCase())
			.filter((keyword) => {
				return (
					!keyword.includes(":") &&
					!object.shortname.includes(keyword) &&
					!stopWords.some((word) => keyword.includes(word))
				);
			});
		return versions;
	}

	/**
	 * 第二阶段：并发分析 collect() 收集到的全部对象，逐个触发
	 * before / onSuccess / onSkipped / onFailure / after 钩子并累加
	 * progress。失败或无兼容版本的对象标记 ignored 并从返回值剔除。
	 */
	public async analyze(config: AnalyzeConfig) {
		const {
			concurrency = 5,
			version,
			before,
			onSuccess,
			onFailure,
			onSkipped,
			onRegistry,
			after,
		} = config;

		const result = await pMap(
			this.objects,
			async (object) => {
				if (object.ignored) return;
				before?.(object);
				const { name } = object.package;
				try {
					const versions = await this.process(object, version, onRegistry);
					if (versions) {
						await onSuccess?.(object, versions);
						return versions;
					} else {
						object.ignored = true;
						await onSkipped?.(name);
					}
				} catch (error) {
					object.ignored = true;
					await onFailure?.(name, error);
				} finally {
					this.progress += 1;
					after?.(object);
				}
				// 未产出 versions 的对象在此返回 undefined，由下方 filter 剔除
				return;
			},
			{ concurrency },
		);

		return result.filter(isNonNullable);
	}
}
