/**
 * @file 宿主依赖本地快照的构建纯函数(core/deps 域)。
 *
 * 从 DependencyResolver.getLocalDepsSnapshot 成块拆出的两步:
 * - collectDependencyRequests:以宿主 package.json 请求范围为底构建快照骨架;
 * - resolveLocalDependency:逐包读 node_modules 补已装版本与 workspace 标记,
 *   叠加来源分类、invalid 标记、上一轮已确认来源与 latest 的复用。
 * 全程只碰本地磁盘、不发网络请求。
 */
import type { Dict } from "@koishi-ce/koishi";
import { valid } from "semver";
import {
	classifyDependencySource,
	reuseConfirmedDependencySource,
} from "../../shared/dependency-source.js";
import type { PackageCache } from "../registry/cache/index.js";
import { loadManifest, type PackageJson } from "../registry/manifest.js";
import type { Dependency } from "./types.js";

/** 404 负缓存的可信窗口:notFoundAt 距今 5 分钟内可直接复用上一轮的归类结果。 */
const MINUTE = 60_000;

/** 以 manifest 请求范围为底构建快照骨架(逐包补全前的初始形态)。 */
export function collectDependencyRequests(
	manifest: PackageJson,
): Dict<Dependency> {
	const result: Dict<Dependency> = {};
	for (const [name, request] of Object.entries(manifest.dependencies ?? {})) {
		// 剥掉 ^/~ 前缀:后续 valid() 判定与 latest 比较都按精确版本语义进行
		result[name] = { request: request.replace(/^[~^]/, "") };
	}
	return result;
}

/** 逐包本地解析所需的上下文:磁盘根、日志、包缓存与上一轮同名条目。 */
export interface LocalDependencyContext {
	/** 宿主工作目录(node_modules 所在地) */
	cwd: string;
	/** registry 包版本缓存(读 404 负缓存时间戳) */
	cache: PackageCache;
	log: { debug(message: string): void };
	/** 上一轮快照的同名条目(复用已确认来源与 latest) */
	previous: Dependency | undefined;
}

/**
 * 单个依赖条目的本地解析:已装版本/workspace 标记、来源分类、invalid 标记,
 * 以及上一轮已确认来源与 latest 的复用(404 归类有 5 分钟负缓存窗口背书)。
 * 就地修改传入的 dep。
 */
export function resolveLocalDependency(
	name: string,
	dep: Dependency,
	ctx: LocalDependencyContext,
) {
	const { cwd, cache, log, previous } = ctx;
	try {
		// 已装版本读 node_modules 内的 package.json;未安装/读取失败留空,
		// 由后续 registry 元数据刷新补齐
		const meta = loadManifest(name, cwd);
		dep.resolved = meta.version;
		dep.workspace = meta.$workspace;
		log.debug(
			`local dependency resolved: ${name}@${meta.version}, workspace=${!!meta.$workspace}, request=${dep.request}`,
		);
	} catch {
		log.debug(
			`local dependency not found before metadata fetch: ${name}, request=${dep.request}`,
		);
	}

	const source = classifyDependencySource(dep.request, {
		workspace: dep.workspace,
		installed: !!dep.resolved,
	});
	Object.assign(dep, source);

	if (!dep.local && !valid(dep.request)) {
		// 非精确 semver 的请求(如 git/url 串之外的怪异写法)标记 invalid:
		// 这类条目不参与 latest 刷新,前端也据此降级展示
		dep.invalid = true;
		log.debug(
			`dependency request is not exact semver: ${name}, request=${dep.request}`,
		);
	}

	// 复用上一轮已确认的来源分类:404 归类结果有 5 分钟负缓存窗口背书,
	// 避免每次快照重建都把"未绑定本地插件"闪回成普通 registry 依赖
	const notFoundAt = cache.notFoundAt(name);
	const preserved = reuseConfirmedDependencySource(
		previous,
		dep,
		!!notFoundAt && Date.now() - notFoundAt < 5 * MINUTE,
	);
	if (preserved) Object.assign(dep, preserved);
	if (
		previous?.latest &&
		previous.request === dep.request &&
		previous.resolved === dep.resolved
	) {
		// 请求与已装版本都没变时沿用上一轮 latest,省一次 registry 往返
		dep.latest = previous.latest;
	}
}
