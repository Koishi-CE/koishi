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

import { readdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type Dict, defineProperty, isNonNullable, pick } from "cosmokit";
import type { PackageJson, SearchObject, SearchResult } from "./types";
import { conclude } from "./utils";

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
		const filename = require.resolve(`${name}/package.json`);
		const meta: PackageJson = JSON.parse(await readFile(filename, "utf8"));
		meta.peerDependencies ||= {};
		meta.peerDependenciesMeta ||= {};
		return [meta, !filename.includes("node_modules")] as const;
	}

	/**
	 * 把本地 package.json 解析为 SearchObject：manifest 复用 conclude()，
	 * package 只保留市场展示需要的四个字段。
	 */
	protected async parsePackage(name: string) {
		const [data, workspace] = await this.loadManifest(name);
		return {
			workspace,
			manifest: conclude(data),
			shortname: data.name.replace(/(koishi-|^@koishijs\/)plugin-/, ""),
			package: pick(data, [
				"name",
				"version",
				"peerDependencies",
				"peerDependenciesMeta",
			]),
		} as SearchObject;
	}
}
