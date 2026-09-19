// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 依赖条目类型定义（dependencies 数据通道的值类型）。
 *
 * 单个依赖条目的请求范围、已装版本与来源标记；latest / error / fetching
 * 三个可选字段由元数据刷新阶段填充，前端依赖页的分类状态机据此判定
 * 六态。类型集中在此，node 侧声明与 client 侧镜像（console-services.ts）
 * 均从这里取形状。
 */

/** registry 元数据拉取失败的归类：404（registry 无此包）与其余（网络等） */
export type DependencyError = "not-found" | "network";

/** 依赖条目：请求范围、已装版本、来源标记与最新版信息。 */
export interface Dependency {
	/**
	 * requested semver range
	 * @example `^1.2.3` -> `1.2.3`
	 */
	request: string;
	/**
	 * installed package version
	 * @example `1.2.5`
	 */
	resolved?: string | undefined;
	/** whether it is a workspace package */
	workspace?: boolean | undefined;
	/** valid (unsupported) syntax */
	invalid?: boolean | undefined;
	/** latest version */
	latest?: string | undefined;
	/** registry 元数据拉取失败的归类（缺失代表尚在拉取或已成功） */
	error?: DependencyError | undefined;
	/** 本轮元数据尚未拉取完成（前端据此显示加载中而非错误） */
	fetching?: boolean | undefined;
}
