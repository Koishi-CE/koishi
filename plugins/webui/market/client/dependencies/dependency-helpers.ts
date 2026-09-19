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
	| "updatable"
	| "installed";

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
 * 钉名别名 > 非法声明 > registry 拉取失败 > 可更新 > 已安装。
 * 顺序即语义,拆分或查表都会掩盖优先级。
 */
export function classify(
	dep: DependencyLike | undefined,
	change: PendingChange | undefined,
	ignored: boolean,
	updateAvailable: boolean,
): ItemKind {
	if (change) return "pending";
	// override 里有但快照里没有:待安装的新依赖,同样归待应用
	if (!dep) return "pending";
	if (dep.workspace) return "local";
	// npm: 协议钉名别名(shim 占名):设计内形态,固定钉死无更新可言
	if (dep.alias) return "alias";
	if (dep.invalid) return "invalid";
	if (dep.error) return "error";
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
