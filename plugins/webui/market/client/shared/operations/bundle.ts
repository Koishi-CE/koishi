/**
 * @file 合包(bundle)记录的前端视图族(shared/operations 域)。
 *
 * 在没有服务端持久化记录时,从 registry 元数据或本地安装状态重建
 * BundleRecordView,供卸载/管理对话框回放当时的安装选择;并提供由
 * koishi.yml 分组路径反查合包、统计成员配置节点分布等工具。
 */

import type { Context } from "@koishi-ce/client";
import { send, store } from "@koishi-ce/client";
import type { Registry } from "@koishi-ce/registry";
import type { Dict } from "cosmokit";
import {
	isBundlePackageName,
	type PluginBundleManifest,
	type PluginBundleRecord,
	parseBundleManifest,
} from "../../../src/shared/bundle";
import {
	getBundleGroupIdent,
	getPluginShortname,
} from "../../../src/shared/bundle-idents";
import { type BundleMemberCleanupTarget, getConfigWriter } from "./state";

/** PluginBundleRecord 的前端视图形态:fallback=true 表示非持久化记录、由本地状态推导。 */
export type BundleRecordView = PluginBundleRecord & {
	fallback?: boolean;
};

/**
 * 从清单构造合包记录视图(无本地安装状态时的"理想形态"):所有成员默认
 * selected、skipped,installedAt 为 0,标记 fallback 供 UI 与真实记录区分。
 */
function createBundleRecordFromManifest(
	packageName: string,
	version = "",
	bundle?: PluginBundleManifest,
	fallback = true,
): BundleRecordView | undefined {
	if (!isBundlePackageName(packageName)) return;
	return {
		package: packageName,
		version,
		label: bundle?.label || getPluginShortname(packageName),
		groupKey: `group:${getBundleGroupIdent(packageName)}`,
		installedAt: 0,
		fallback,
		members: (bundle?.members ?? []).map((member) => ({
			...member,
			selected: true,
			installedByBundle: false,
			skipped: true,
		})),
	};
}

/**
 * 从本地安装状态推导合包记录:读取 store.packages / store.dependencies 里
 * 已装合包的 package.json,解析 koishi.bundle 字段后交给
 * createBundleRecordFromManifest 生成视图(fallback=false,版本取已装版本)。
 * 合包未装或清单为空时返回 undefined。
 */
export function createLocalBundleRecord(
	packageName: string,
): BundleRecordView | undefined {
	if (!isBundlePackageName(packageName)) return;
	const local = store.packages?.[packageName];
	const dep = store.dependencies?.[packageName];
	if (!local && !dep) return;
	const bundle = parseBundleManifest((local?.package as any)?.koishi?.bundle);
	if (!bundle?.members.length) return;
	return createBundleRecordFromManifest(
		packageName,
		dep?.resolved ?? local?.package.version ?? "",
		bundle,
	);
}

/**
 * 由 koishi.yml 的分组路径反查合包包名:优先查持久化安装记录的 groupKey,
 * 否则遍历本地已装包,用本地清单推导的分组标识逐一比对。
 *
 * @param groupPath 形如 "group:pa-xxx" 或 "pa-xxx"
 * @param records 服务端下发的合包安装记录(MarketDataStore 持久化的那份)
 */
export function resolveBundlePackageFromGroup(
	groupPath?: string,
	records: Dict<PluginBundleRecord> = {},
) {
	if (!groupPath) return;
	const groupKey = groupPath.startsWith("group:")
		? groupPath
		: `group:${groupPath}`;
	const byRecord = Object.values(records).find(
		(record) => record?.groupKey === groupKey,
	);
	if (byRecord?.package) return byRecord.package;
	const names = new Set([
		...Object.keys(store.dependencies ?? {}),
		...Object.keys(store.packages ?? {}),
	]);
	return [...names].find((name) => {
		const record = createLocalBundleRecord(name);
		return (
			!!record && getBundleGroupIdent(name) === groupPath.replace(/^group:/, "")
		);
	});
}

/** 由分组路径取合包记录视图:先反查包名,持久化记录优先,缺则本地推导。 */
export function resolveBundleRecordFromGroup(
	groupPath?: string,
	records: Dict<PluginBundleRecord> = {},
) {
	const packageName = resolveBundlePackageFromGroup(groupPath, records);
	if (!packageName) return;
	return records[packageName] || createLocalBundleRecord(packageName);
}

/** 去掉分组路径的 group: 前缀,统一成裸分组标识再比较。 */
function normalizeGroupPath(path?: string) {
	return path?.replace(/^group:/, "");
}

/** 判断配置节点是否位于指定合包分组下(两侧都做前缀归一)。 */
function isBundleGroupPath(
	path: string | undefined,
	groupKey: string | undefined,
) {
	if (!path || !groupKey) return false;
	return normalizeGroupPath(path) === normalizeGroupPath(groupKey);
}

/**
 * 统计某合包成员当前在 koishi.yml 里的配置节点分布。
 *
 * configWriter 以包名和插件键两种键都可能查到节点,先按 path/id 去重,再按
 * 父节点是否位于合包分组拆成 group(组内)与 external(组外)两组——卸载清理
 * 与"移动进分组"都以这个划分为准。
 */
export function getBundleMemberConfigState(
	ctx: Context,
	member: BundleMemberCleanupTarget,
	groupKey?: string,
) {
	const configWriter = getConfigWriter(ctx);
	const nodes = [
		...(configWriter?.get(member.package) ?? []),
		...(member.plugin ? (configWriter?.get(member.plugin) ?? []) : []),
	];
	const unique = new Map<string, any>();
	for (const node of nodes) {
		if (!node) continue;
		unique.set(node.path || node.id, node);
	}
	const entries = [...unique.values()];
	const getParentPath = (node: any) => node.parent?.path || node.parent?.id;
	return {
		all: entries,
		group: entries.filter((node) =>
			isBundleGroupPath(getParentPath(node), groupKey),
		),
		external: entries.filter(
			(node) => !isBundleGroupPath(getParentPath(node), groupKey),
		),
	};
}

/**
 * 拉取合包的完整记录视图:向服务端要 registry 元数据,取"本地已装版本对应的
 * 清单"(装的不是最新版时不能拿最新版清单充数),解析失败或清单为空时逐步
 * 回退到本地推导。任何网络异常都吞掉并走回退路径。
 */
export async function fetchBundleRecord(
	packageName: string,
): Promise<BundleRecordView | undefined> {
	if (!isBundlePackageName(packageName)) return;
	const registry = (await (
		send("market/package", packageName) ?? Promise.resolve(undefined)
	).catch((error) => {
		console.warn(error);
		return undefined;
	})) as Registry | undefined;
	if (!registry?.versions) return createLocalBundleRecord(packageName);
	const targetVersion =
		store.dependencies?.[packageName]?.resolved ??
		store.packages?.[packageName]?.package.version;
	const entry =
		targetVersion && registry.versions?.[targetVersion]
			? ([targetVersion, registry.versions[targetVersion]] as const)
			: Object.entries(registry.versions ?? {})[0];
	if (!entry) return createLocalBundleRecord(packageName);
	const [version, remote] = entry;
	const bundle = parseBundleManifest((remote as any)?.koishi?.bundle);
	if (!bundle?.members.length) return createLocalBundleRecord(packageName);
	return createBundleRecordFromManifest(packageName, version, bundle);
}
