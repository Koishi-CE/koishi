// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 模板项目 package.json 的类型与改写（纯函数域，无副作用）：定义本流程
 * 触碰字段的类型并提供渲染函数。内置模板（index.ts 的 scaffoldBuiltin
 * 直接渲染写入）与远程模板（remote.ts 读回解包产物后改写）共用这里。
 */

/**
 * 模板项目的 package.json（改写源 / 目标）：只需要类型化本流程触碰的
 * 字段，其余字段经 index signature 原样保留。
 */
export interface Manifest {
	name?: string;
	private?: boolean;
	version?: string;
	workspaces?: unknown;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	[key: string]: unknown;
}

/**
 * 改写模板的 package.json（纯函数，导出供单测）：替换项目名、标记
 * private、版本归零。
 */
export function renderManifest(
	source: Manifest,
	project: string,
	prod: boolean,
): string {
	const meta: Manifest = { ...source };
	meta["name"] = project;
	meta["private"] = true;
	meta["version"] = "0.0.0";
	if (prod) {
		// https://github.com/koishijs/koishi/issues/994
		// 生产模式不借助 NODE_ENV 或 --production 标志，
		// 而是直接删掉 devDependencies 与 workspaces 字段。
		delete meta["workspaces"];
		delete meta["devDependencies"];
	}
	return `${JSON.stringify(meta, null, 2)}\n`;
}
