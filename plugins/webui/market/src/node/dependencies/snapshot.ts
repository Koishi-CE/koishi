// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 宿主依赖本地快照的构建纯函数。
 *
 * 两步：collectDependencyRequests 以宿主 package.json 的依赖声明为底
 * 构建骨架；resolveLocalDependency 逐包读 node_modules 补已装版本与
 * workspace 标记。全程只碰本地磁盘、不发网络请求——registry 元数据由
 * DependencyService 的刷新阶段另行填充。
 *
 * 上一轮条目的复用规则（防闪烁 + 负缓存语义）：
 * - request 与 resolved 未变时沿用 latest（省一次 registry 往返）；
 * - 仅 404（not-found）的 error 被沿用（registry 确认无此包，会话内
 *   不再重试）；网络错误的 error 不沿用，下一轮 get() 会重新拉取。
 */
import type { Dict } from "@koishi-ce/koishi";
import { valid } from "semver";
import { loadManifest } from "../installer/manifest.ts";
import type { Dependency } from "./types.ts";

/** 以宿主 dependencies 声明为底构建快照骨架（元数据字段全部置为待拉取）。 */
export function collectDependencyRequests(
	dependencies: Record<string, string>,
): Dict<Dependency> {
	const result: Dict<Dependency> = {};
	for (const [name, request] of Object.entries(
		dependencies,
	)) {
		// 剥掉 ^/~ 前缀：后续 valid() 判定与 latest 比较都按精确版本语义进行
		result[name] = {
			request: request.replace(/^[~^]/, ""),
			fetching: true,
		};
	}
	return result;
}

/** 逐包本地解析所需的上下文：上一轮同名条目（复用 latest 与 404 负缓存）。 */
export interface LocalResolveContext {
	previous: Dependency | undefined;
}

/**
 * 单个依赖条目的本地解析：已装版本 / workspace 标记 / invalid 标记，
 * 就地修改传入的 dep。node_modules 内无此包时 resolved 留空，由后续
 * 元数据刷新阶段补齐。
 */
export function resolveLocalDependency(
	name: string,
	dep: Dependency,
	ctx: LocalResolveContext,
): void {
	try {
		// 已装版本读 node_modules 内的 package.json；未安装/读取失败留空
		const meta = loadManifest(name);
		dep.resolved = meta.version;
		dep.workspace = meta.$workspace;
		if (meta.$workspace) {
			// workspace 包不参与 registry 拉取与更新判定
			delete dep.fetching;
		}
	} catch {
		// 尚未安装（或残留声明）：保持待拉取形态
	}

	if (dep.request.startsWith("npm:")) {
		// npm: 协议钉名别名（下游 shim 占名）：声明键与真实包名不同是
		// 设计内行为，语义上等同 workspace——固定钉死、无更新可言
		dep.alias = true;
		delete dep.fetching;
	} else if (!dep.workspace && !valid(dep.request)) {
		// 非精确 semver 的请求（file: 路径、git/url 串等）：不参与
		// latest 刷新，前端据此降级展示
		dep.invalid = true;
		delete dep.fetching;
	}

	const { previous } = ctx;
	if (
		previous &&
		previous.request === dep.request &&
		previous.resolved === dep.resolved
	) {
		if (previous.latest) {
			dep.latest = previous.latest;
			delete dep.fetching;
		}
		// 404 负缓存：registry 已确认无此包，会话内不再重试；
		// 网络错误不沿用，下一轮 get() 重新拉取
		if (previous.error === "not-found") {
			dep.error = "not-found";
			delete dep.fetching;
		}
	}
}
