// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * npm 插件市场扫描器（本地侧）：扫描给定目录及其所有祖先目录的
 * node_modules，收集已安装的 Koishi 插件并解析出与远程扫描同构的
 * SearchObject（含 manifest 与短名），供市场页面展示本地已装插件。
 *
 * 与 index.ts 的 Scanner（走 registry 协议）相对，本实现不发网络请求，
 * 只读文件系统；包名同时兼容 @koishi-ce/plugin-*（本仓库作用域）与
 * @koishijs/plugin-*（上游作用域）两种组织形式。
 */
/// <reference types="@types/node" />

import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { type Dict, defineProperty, isNonNullable, pick } from "cosmokit";
import type { PackageJson, SearchObject, SearchResult } from "./types.ts";
import { conclude } from "./utils.ts";

/**
 * 由插件包名剥离约定前缀得到短名，兼容本仓库 @koishi-ce/plugin-*、
 * 上游 @koishijs/plugin-* 与社区 koishi-plugin-* 三种组织形式。
 */
export function getPluginShortname(name: string) {
	return name.replace(/(koishi-|^@(?:koishijs|koishi-ce)\/)plugin-/, "");
}

/**
 * 解析已安装包的 package.json 路径：纯 fs 沿 node_modules 链 existsSync
 * 探测，全程不触碰解析 API。
 *
 * Bun 的解析器对失败的查找按「父目录快照」做进程内缓存（2026-08 实证
 * 修正，原以为是按 specifier 记负缓存）：解析 `pkg/package.json` 失败时，
 * 只要包的直接父目录（node_modules 或 node_modules/@scope）已存在，该
 * 目录的内容列表就被缓存——此后即使包已落盘，同进程内该包的**任何形
 * 态**（`pkg/package.json`、裸名）经**任何解析 API**（createRequire.resolve、
 * Bun.resolveSync）都永久失败；父目录不存在时无快照可缓存，落盘后即可
 * 解析（同一现象「时而复现时而正常」的根源，上游 koishijs/webui#273 的
 * FIXME 即此）。市场安装流程在包落盘前必然探测一次「是否已安装」，若
 * 该探测走解析 API（此步必失败、必触发快照），装完插件后同进程内解析
 * 持续失败、只能重启进程。因此这里必须 existsSync 直查（真实系统调用，
 * 不经过解析缓存），落空即抛错；本仓运行时为 Bun + node_modules 布局，
 * PnP 等无 node_modules 的形态不在支持面，无需解析 API 兜底。
 */
export function resolvePackageJson(name: string, from = process.cwd()): string {
	// name 可能是宿主项目的目录路径（market 构造期读宿主清单的用法：
	// loadManifest(cwd)），直接按路径解析其 package.json
	if (isAbsolute(name) || name.startsWith("./") || name.startsWith("../")) {
		const direct = resolve(from, name, "package.json");
		if (existsSync(direct)) return direct;
		throw new Error(`Cannot resolve '${name}/package.json'`);
	}
	let dir = resolve(from);
	for (;;) {
		const candidate = join(dir, "node_modules", name, "package.json");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`Cannot resolve '${name}/package.json'`);
}

/** 缓存键归一（win32 大小写不敏感），对齐 require.cache 键与探测路径的比对 */
function normalizeCacheKey(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

/**
 * 判断某依赖包是否有模块驻留在 require.cache（旧版本仍在内存）。
 *
 * 判定不走任何解析 API（Bun 的父目录快照缓存见 resolvePackageJson 注释，
 * 原上游实现用 require.resolve(name)，装前探测污染后装完必失败）：经
 * resolvePackageJson（fs 探测）取包目录后扫 require.cache 前缀；符号链
 * 接布局下缓存键可能是 realpath 形态，两种前缀都查；任何环节失败都保守
 * 返回 true——多一次重载只是进程重启，漏判才会让旧版本代码继续驻留。
 */
export function isResidentInCache(name: string): boolean {
	try {
		const dir = dirname(resolvePackageJson(name));
		const prefixes = [normalizeCacheKey(dir + sep)];
		try {
			const real = realpathSync(dir);
			if (real !== dir) prefixes.push(normalizeCacheKey(real + sep));
		} catch {}
		return Object.keys(require.cache).some((key) =>
			prefixes.some((prefix) => normalizeCacheKey(key).startsWith(prefix)),
		);
	} catch {
		return true;
	}
}

/** 本地扫描结果：结构与远程 SearchResult 一致，部分字段（score 等）不填 */
export interface LocalScanner extends SearchResult {}

export class LocalScanner {
	/** 按包名去重的加载任务缓存；值为 Promise 以并发去重（同包只加载一次） */
	private cache!: Dict<Promise<SearchObject | undefined>>;
	/** 实际执行的收集任务；存在期间重复 collect() 直接复用（可 forced 丢弃） */
	private task?: Promise<SearchObject[]>;

	// erasableSyntaxOnly：参数属性需拆为显式字段声明
	public baseDir: string;

	constructor(baseDir: string) {
		this.baseDir = baseDir;
		defineProperty(this, "cache", {});
	}

	/** 单包加载失败的回调钩子，子类可覆写以记录日志 */
	onError(_reason: unknown, _name: string) {}

	/**
	 * 实际收集逻辑：从 baseDir 逐级向上扫到文件系统根，并发加载沿途
	 * 每个 node_modules 里的插件包（覆盖嵌套安装的场景）。
	 */
	async _collect(): Promise<SearchObject[]> {
		this.cache = {};
		let root = this.baseDir;
		const tasks: Promise<void>[] = [];
		for (;;) {
			tasks.push(this.loadDirectory(root));
			const parent = dirname(root);
			if (root === parent) break;
			root = parent;
		}
		await Promise.all(tasks);
		// 加载失败的包（onError 已记录）不混入 undefined 元素
		const objects = await Promise.all(Object.values(this.cache));
		return objects.filter(isNonNullable);
	}

	/**
	 * 收集本地插件并写入 this.objects。
	 * @param forced 是否强制重新扫描（否则复用上一次的任务结果）
	 */
	async collect(forced = false) {
		if (forced) delete this.task;
		this.objects = await (this.task ||= this._collect());
	}

	/**
	 * 扫描单个 node_modules 目录：顶层 koishi-plugin-* 直接收录；
	 * 作用域目录则只看 @koishi-ce / @koishijs 下的 plugin-* 子包。
	 */
	private async loadDirectory(baseDir: string) {
		const base = `${baseDir}/node_modules`;
		const files = await readdir(base).catch(() => []);
		for (const name of files) {
			if (name.startsWith("koishi-plugin-")) {
				this.cache[name] ||= this.loadPackage(name);
			} else if (name.startsWith("@")) {
				const base2 = `${base}/${name}`;
				const files = await readdir(base2).catch(() => []);
				for (const name2 of files) {
					if (
						((name === "@koishi-ce" || name === "@koishijs") &&
							name2.startsWith("plugin-")) ||
						name2.startsWith("koishi-plugin-")
					) {
						this.cache[`${name}/${name2}`] ||= this.loadPackage(
							`${name}/${name2}`,
						);
					}
				}
			}
		}
	}

	/** 加载单个包，异常经 onError 上报后返回 undefined（不中断整体扫描） */
	private async loadPackage(name: string): Promise<SearchObject | undefined> {
		try {
			return await this.parsePackage(name);
		} catch (error) {
			this.onError(error, name);
			return undefined;
		}
	}

	/**
	 * 读取并兜底某个包的 package.json。
	 * @returns [清单数据, 是否为 workspace 直连包]——清单解析路径不含
	 * node_modules 时说明是包管理器的 workspace 链接（本仓库源码形态）。
	 */
	private async loadManifest(name: string) {
		// 解析锚点与 _collect 的扫描锚点（baseDir）保持一致：
		// 默认的 cwd 在宿主以非 cwd 启动时会与扫描起点脱节，扫到却解析不到
		const filename = resolvePackageJson(name, this.baseDir);
		const meta: PackageJson = JSON.parse(await readFile(filename, "utf8"));
		return [meta, !filename.includes("node_modules")] as const;
	}

	/**
	 * 把 package.json 解析为 SearchObject：manifest 复用 conclude()，
	 * package 只保留市场展示需要的四个字段。
	 * @param data 已读取的包清单（原地补全 peer 依赖字段）
	 * @param workspace 是否为 workspace 源码形态
	 */
	private toSearchObject(data: PackageJson, workspace: boolean) {
		data.peerDependencies ||= {};
		data.peerDependenciesMeta ||= {};
		return {
			workspace,
			manifest: conclude(data),
			shortname: getPluginShortname(data.name),
			package: pick(data, [
				"name",
				"version",
				"peerDependencies",
				"peerDependenciesMeta",
			]),
		} as SearchObject;
	}

	/**
	 * 按目录路径加载插件包，不要求包已链入 node_modules。
	 * 用于 koishi.yml 中以相对路径键（./plugins/...）引用、且未随
	 * workspace 链接出现在 node_modules 里的源码包。
	 * @param dir 包目录的绝对路径
	 */
	async loadPath(dir: string): Promise<SearchObject | undefined> {
		this.cache[dir] ||= (async () => {
			try {
				const data: PackageJson = JSON.parse(
					await readFile(`${dir}/package.json`, "utf8"),
				);
				return this.toSearchObject(data, true);
			} catch (error) {
				this.onError(error, dir);
				return undefined;
			}
		})();
		return this.cache[dir];
	}

	protected async parsePackage(name: string) {
		const [data, workspace] = await this.loadManifest(name);
		// 上游名占位 shim（如 @koishijs/plugin-console）不是真实插件，
		// 不进入本地已装列表（避免与 @koishi-ce 同类插件短名冲突）
		if (data["koishi-ce"]?.upstreamShim) return undefined;
		return this.toSearchObject(data, workspace);
	}
}
