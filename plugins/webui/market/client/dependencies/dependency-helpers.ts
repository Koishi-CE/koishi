// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 依赖页的基础判定层:单包分类状态机(classify)、待应用变更的
 * 显式类型与编解码、包名短名化。零 vue / client 运行时依赖。
 */

/** 依赖条目的分类标签(installed 为兜底态)。 */
export type ItemKind =
	| "pending"
	| "local"
	| "alias"
	| "invalid"
	| "error"
	| "unconfigured"
	| "updatable"
	| "installed";

/**
 * 插件包名的收录口径:只认三种插件命名前缀,与 store.packages 的
 * 数据源 LocalScanner 一致(社区 koishi-plugin-*、上游
 * @koishijs/plugin-*、本仓 @koishi-ce/plugin-*)。作为「未配置」
 * 分类的硬门槛,防止 koishi 本体、shim、@koishijs/core 等非插件
 * 根依赖被误判成未配置插件。
 */
export const PLUGIN_NAME_PATTERN =
	/^(koishi-plugin-|@koishi(?:js|-ce)?\/plugin-)/;

/**
 * 待应用变更的显式表达:「设版本 / 移除」用可辨识联合表达,
 * 不使用魔法哨兵字符串。序列化到 override 暂存区('' = 移除,与
 * 既有协议及手动添加对话框兼容)时经 encode/decode 转换。
 */
export type PendingChange =
	| { type: "set"; version: string }
	| { type: "remove" };

/** 依赖条目的最小消费面(classify 只看这些字段)。 */
export interface DependencyLike {
	workspace?: boolean | undefined;
	alias?: boolean | undefined;
	invalid?: boolean | undefined;
	error?: string | undefined;
	fetching?: boolean | undefined;
}

/**
 * 单包分类状态机(优先级从高到低):待应用变更 > 工作区/本地 >
 * 钉名别名 > 非法声明 > registry 拉取失败 > 未配置 > 可更新 > 已安装。
 * 顺序即语义,拆分或查表都会掩盖优先级。
 *
 * unconfigured 参数是装配层预先算好的「未配置」判定(插件名口径 +
 * 无配置条目):快照有条目的包在 error 之后、updatable 之前分流;
 * 快照无条目的包(全集并集收录)以此区分「待装新依赖」与「已下载
 * 未配置」。
 */
export function classify(
	dep: DependencyLike | undefined,
	change: PendingChange | undefined,
	ignored: boolean,
	updateAvailable: boolean,
	unconfigured = false,
): ItemKind {
	if (change) return "pending";
	// override 里有但快照里没有:待安装的新依赖,同样归待应用
	if (!dep)
		return unconfigured ? "unconfigured" : "pending";
	if (dep.workspace) return "local";
	// npm: 协议钉名别名(shim 占名):设计内形态,固定钉死无更新可言
	if (dep.alias) return "alias";
	if (dep.invalid) return "invalid";
	if (dep.error) return "error";
	if (unconfigured) return "unconfigured";
	// 忽略规则压制的包归已安装组(卡片附「已忽略」徽标);
	// 元数据尚在拉取(fetching)时无更新可言,同样落此组
	if (ignored || !updateAvailable) return "installed";
	return "updatable";
}

/** 解码 override 暂存区条目:'' 为移除,非空为固定版本。 */
export function decodeOverrideEntry(
	value: string | undefined,
): PendingChange | undefined {
	if (value === undefined) return undefined;
	if (!value) return { type: "remove" };
	return { type: "set", version: value };
}

/** 编码待应用变更回 override 暂存区协议形态。 */
export function encodeOverrideEntry(
	change: PendingChange | undefined,
): string | undefined {
	if (!change) return undefined;
	return change.type === "remove" ? "" : change.version;
}

/** 剥离插件包名的约定前缀得到短名(展示层用,不影响存储与请求)。 */
export function getShortName(name: string): string {
	return name.replace(
		/(koishi-|^@(?:koishijs|koishi-ce)\/)plugin-/,
		"",
	);
}

/** 从 npm: 别名声明剥出真实包名(`npm:@koishi-ce/x@^1.0.0` -> `@koishi-ce/x`)。 */
export function getAliasTarget(
	request: string,
): string | undefined {
	if (!request.startsWith("npm:")) return undefined;
	const rest = request.slice(4);
	// scoped 包名自带前导 @,取最后一个 @ 之前段即包名;无版本串原样返回
	const at = rest.lastIndexOf("@");
	return at <= 0 ? rest : rest.slice(0, at);
}
