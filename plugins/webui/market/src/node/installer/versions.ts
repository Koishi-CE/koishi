// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 远端包版本探测与归一化。
 *
 * 从 registry 取回版本数组后，过滤掉与当前框架不兼容的版本，再归一化为
 * 「版本号 → peer 依赖声明 / 弃用标记」的映射并按版本号降序排列（首项即
 * 最新版）。纯 IO + 纯函数，不持有服务状态；缓存与去重由 installer 侧负责。
 */
import {
	type Dict,
	type HTTP,
	pick,
} from "@koishi-ce/koishi";
import Scanner, {
	type DependencyMetaKey,
	type Registry,
	type RemotePackage,
} from "@koishi-ce/registry";
import { compare, satisfies } from "semver";

/** 归一化后的版本表：版本号 → 依赖元信息（键序即降序，首项为最新版） */
export type VersionMap = Dict<
	Pick<RemotePackage, DependencyMetaKey>
>;

/** 把 registry 返回的版本数组归一化并降序排列 */
export function getVersions(
	versions: RemotePackage[],
): VersionMap {
	return Object.fromEntries(
		versions
			.map(
				(item) =>
					[
						item.version,
						pick(item, [
							"peerDependencies",
							"peerDependenciesMeta",
							"deprecated",
						]),
					] as const,
			)
			.sort(([a], [b]) => compare(b, a)),
	);
}

/**
 * 取回单个包的可用版本表（已过滤不兼容版本）。
 *
 * 兼容性口径：`koishi` 本体按 4.x 判定；其余包若确认为插件则要求与
 * 4.x 兼容（Scanner 的判定基于包名与 remote 元信息）。
 *
 * @throws 网络或 registry 响应异常时向上抛出，由调用方决定日志口径
 */
export async function fetchVersions(
	http: HTTP,
	name: string,
): Promise<VersionMap> {
	const registry = await http.get<Registry>(`/${name}`);
	return getVersions(
		Object.values(registry.versions).filter((remote) => {
			if (name === "koishi")
				return satisfies(remote.version, "4");
			return (
				!Scanner.isPlugin(name) ||
				Scanner.isCompatible("4", remote)
			);
		}),
	);
}
