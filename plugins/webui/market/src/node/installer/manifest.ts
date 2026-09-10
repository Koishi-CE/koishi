// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 项目根 package.json（安装清单）的读写与护栏判定。
 *
 * 只做纯 fs 的清单操作，与 registry 的交互（版本探测、http 缓存）无关，
 * 故独立于 installer 服务；依赖链接的探测属安装完整性校验，见
 * ./integrity.ts。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	type Dict,
	defineProperty,
} from "@koishi-ce/koishi";
import {
	type PackageJson,
	resolvePackageJson,
} from "@koishi-ce/registry";

/** 本地 package.json 的解析结果；dependencies 由归一化保证必有 */
export interface LocalPackage extends PackageJson {
	private?: boolean;
	$workspace?: boolean;
	dependencies: Record<string, string>;
}

/**
 * 判断依赖声明是否受护栏保护、不可被安装清单覆盖或删除。两类：
 * - `workspace:` 声明是本仓库（monorepo）对上游名的归属（如 koishi
 *   裸名 shim，见 packages/shim/koishi）；
 * - `npm:@koishi-ce/...` alias 是下游脚手架生成项目对上游名的归属
 *   （如 "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11"，见
 *   packages/shim/koishi-shim）。
 * 两者被覆盖或删除都会让 peer 解析失去归属，重新拉下 npm 官方包形成
 * 第二份框架副本。
 */
function isGuardedRequest(
	request: string | undefined,
): boolean {
	return (
		request?.startsWith("workspace:") === true ||
		request?.startsWith("npm:@koishi-ce") === true
	);
}

export function loadManifest(name: string): LocalPackage {
	// resolvePackageJson 以纯 fs 探测为主路径：市场安装流程在包落盘前的
	// 探测不能触碰解析 API，否则触发 Bun 的父目录快照缓存（装完即失败）
	const filename = resolvePackageJson(name);
	const meta: LocalPackage = JSON.parse(
		readFileSync(filename, "utf8"),
	);
	meta.dependencies ||= {};
	defineProperty(
		meta,
		"$workspace",
		!filename.includes("node_modules"),
	);
	return meta;
}

/**
 * 把依赖增删写回项目根 package.json，返回写回后的清单。
 *
 * 现读现写：调用方持有的清单原为构造期的启动快照，运行期间根
 * package.json 可能已被外部更新，基于快照整体重写会抹掉变更，故此处
 * 重新读盘。受护栏保护的声明（见 isGuardedRequest）既不覆盖也不删除。
 *
 * @param cwd 项目根目录
 * @param deps 依赖增删清单（值为 null 表示卸载该依赖）
 */
export async function writeManifest(
	cwd: string,
	deps: Dict<string | null>,
): Promise<LocalPackage> {
	const filename = resolve(cwd, "package.json");
	const manifest: LocalPackage = JSON.parse(
		readFileSync(filename, "utf8"),
	);
	manifest.dependencies ||= {};
	for (const key in deps) {
		if (deps[key]) {
			if (isGuardedRequest(manifest.dependencies[key])) {
				continue;
			}
			manifest.dependencies[key] = deps[key];
		} else if (
			!isGuardedRequest(manifest.dependencies[key])
		) {
			delete manifest.dependencies[key];
		}
	}
	manifest.dependencies = Object.fromEntries(
		Object.entries(manifest.dependencies).sort((a, b) =>
			a[0].localeCompare(b[0]),
		),
	);
	// 仓库格式权威是 biome（tab 缩进），按 tab 写出避免装插件后
	// package.json 被重排成空格、lint 报格式漂移
	await Bun.write(
		filename,
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
	return manifest;
}
