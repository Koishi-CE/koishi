// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 插件市场的安装服务（`installer` 服务，同时是本目录入口）。
 *
 * 本目录按职责拆分，本文件只保留服务本体（缓存、依赖汇总、安装编排与
 * 重载判定）：
 * - `./manifest.ts`　项目根 package.json 的读写与护栏判定
 * - `./versions.ts`　远端版本探测与兼容性过滤
 * - `./exec.ts`　bun 安装子进程的驱动与输出转发
 * - `./integrity.ts`　安装完整性校验（isolated 布局链接探测）
 * - `./registry-config.ts`　本机 npm registry 配置探测
 * - `./proc.ts`　bun 安装子进程的创建封装
 */
import type {} from "@koishi-ce/console";
import {
	type Context,
	type Dict,
	type HTTP,
	Logger,
	Schema,
	Service,
	Time,
	valueMap,
} from "@koishi-ce/koishi";
import type {} from "@koishi-ce/loader";
import type {} from "@koishi-ce/plugin-market";
import {
	isResidentInCache,
	mapLimit,
	type RemotePackage,
} from "@koishi-ce/registry";
import { satisfies, valid } from "semver";
import { runBun } from "./exec.ts";
import { findMissingDeps } from "./integrity.ts";
import {
	type LocalPackage,
	loadManifest,
	writeManifest,
} from "./manifest.ts";
import {
	getLocalRegistry,
	NPM_OFFICIAL_REGISTRY,
} from "./registry-config.ts";
import {
	fetchVersions,
	getVersions,
	type VersionMap,
} from "./versions.ts";

const logger = new Logger("market");

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
}

class Installer extends Service {
	declare http: HTTP;
	declare endpoint: string | undefined;
	public fullCache: Dict<VersionMap> = {};
	public tempCache: Dict<VersionMap> = {};

	private pkgTasks: Dict<Promise<VersionMap>> = {};
	private manifest: LocalPackage;
	declare private depTask: Promise<Dict<Dependency>>;
	private flushData: () => void;

	override config: Installer.Config;

	constructor(ctx: Context, config: Installer.Config) {
		super(ctx, "installer");
		this.config = config;
		this.manifest = loadManifest(this.cwd);
		this.flushData = ctx.throttle(() => {
			ctx
				.get("console")
				?.broadcast("market/registry", this.tempCache);
			this.tempCache = {};
		}, 500);
	}

	get cwd() {
		return this.ctx.baseDir;
	}

	override async start() {
		const { endpoint, timeout } = this.config;
		this.endpoint =
			endpoint ??
			getLocalRegistry(this.cwd) ??
			NPM_OFFICIAL_REGISTRY;
		const options: HTTP.Config = {};
		if (this.endpoint) options.endpoint = this.endpoint;
		if (timeout !== undefined) options.timeout = timeout;
		this.http = this.ctx.http.extend(options);
	}

	resolveName(name: string) {
		if (name.startsWith("@koishijs/plugin-")) return [name];
		if (name.match(/(^|\/)koishi-plugin-/)) return [name];
		if (name[0] === "@") {
			const [left, right] = name.split("/");
			return [`${left}/koishi-plugin-${right}`];
		} else {
			return [
				`@koishijs/plugin-${name}`,
				`koishi-plugin-${name}`,
			];
		}
	}

	async findVersion(names: string[]) {
		const entries = await Promise.all(
			names.map(async (name) => {
				try {
					const versions = Object.entries(
						await this.getPackage(name),
					);
					const [latest] = versions;
					if (!latest) return undefined;
					return { [name]: latest[0] };
				} catch {
					return undefined;
				}
			}),
		);
		return entries.find(
			(entry): entry is Dict<string> => entry !== undefined,
		);
	}

	private async _getPackage(name: string) {
		try {
			const versions = await fetchVersions(this.http, name);
			this.fullCache[name] = this.tempCache[name] =
				versions;
			this.flushData();
			return versions;
		} catch (error) {
			logger.warn(error);
			return {};
		}
	}

	setPackage(name: string, versions: RemotePackage[]) {
		this.fullCache[name] = this.tempCache[name] =
			getVersions(versions);
		this.flushData();
		this.pkgTasks[name] = Promise.resolve(
			this.fullCache[name],
		);
	}

	getPackage(name: string) {
		return (this.pkgTasks[name] ||= this._getPackage(name));
	}

	private async _getDeps() {
		const result = valueMap(
			this.manifest.dependencies,
			(request) => {
				return {
					request: request.replace(/^[~^]/, ""),
				} as Dependency;
			},
		);
		await mapLimit(
			Object.keys(result),
			10,
			async (name) => {
				const dep = result[name];
				if (!dep) return;
				try {
					// some dependencies may be left with no local installation
					const meta = loadManifest(name);
					dep.resolved = meta.version;
					dep.workspace = meta.$workspace;
					if (meta.$workspace) return;
				} catch {}

				if (!valid(dep.request)) {
					dep.invalid = true;
				}

				const versions = await this.getPackage(name);
				if (versions) dep.latest = Object.keys(versions)[0];
			},
		);
		return result;
	}

	getDeps() {
		return (this.depTask ||= this._getDeps());
	}

	refreshData() {
		this.ctx.get("console")?.refresh("registry");
		this.ctx.get("console")?.refresh("packages");
	}

	refresh(refresh = false) {
		this.pkgTasks = {};
		this.fullCache = {};
		this.tempCache = {};
		this.depTask = this._getDeps();
		if (!refresh) return;
		this.refreshData();
	}

	async exec(args: string[]) {
		// Bun-first：CE 生态只存在 bun 这一种包管理器，直接驱动 bun 执行
		// 安装（上游经 which-pm-runs 探测 npm/yarn/bun，此处固定为 bun）
		args.unshift("install");
		return runBun(args, this.cwd);
	}

	async override(deps: Dict<string | null>) {
		this.manifest = await writeManifest(this.cwd, deps);
	}

	private _install() {
		const args: string[] = [];
		if (this.endpoint) {
			args.push("--registry", this.endpoint);
		}
		return this.exec(args);
	}

	private _getLocalDeps(override: Dict<string | null>) {
		return valueMap(override, (request, name) => {
			const dep = { request } as Dependency;
			try {
				const meta = loadManifest(name);
				dep.resolved = meta.version;
				dep.workspace = meta.$workspace;
			} catch {}
			return dep;
		});
	}

	async install(
		deps: Dict<string | null>,
		forced?: boolean,
	) {
		const localDeps = this._getLocalDeps(deps);
		await this.override(deps);

		let shouldInstall = forced === true;
		for (const name in deps) {
			const request = deps[name];
			const local = localDeps[name];
			if (
				local?.workspace ||
				(request &&
					local?.resolved &&
					satisfies(local.resolved, request, {
						includePrerelease: true,
					}))
			)
				continue;
			shouldInstall = true;
			break;
		}

		if (shouldInstall) {
			const code = await this._install();
			if (code) return code;
			// isolated 布局的增量安装可能漏建新包目录的依赖链接(机理
			// 见 integrity.ts 模块注释):装完即校验,缺失时补跑一次
			// 安装——bun 按磁盘实际状态重建链接,秒级自愈,无需人工
			const missing = findMissingDeps(this.cwd, deps);
			if (missing.length) {
				logger.warn(
					`检测到增量安装未建立部分依赖链接(isolated 布局已知缺陷),正在补装: ${missing.join("; ")}`,
				);
				const retry = await this._install();
				if (retry) return retry;
				if (findMissingDeps(this.cwd, deps).length) {
					logger.warn(
						"自动补装后依赖链接仍不完整,请在项目根目录运行 bun install --force 并重启 koishi",
					);
				}
			}
		}

		this.refresh();
		const newDeps = await this.getDeps();
		for (const name in localDeps) {
			const local = localDeps[name];
			const newDep = newDeps[name];
			if (!local || !newDep || local.workspace) continue;
			if (newDep.resolved === local.resolved) continue;
			// 版本变化且旧版本仍驻留内存时才需要整进程重载（判定不走
			// 解析 API，规避 Bun 负缓存，见 isResidentInCache）
			if (isResidentInCache(name))
				this.ctx.loader.fullReload();
		}
		this.refreshData();

		return 0;
	}

	// erasableSyntaxOnly 禁止含运行时值的 namespace，
	// 原 namespace 内的 Config 常量移到此处的静态字段，对外形状不变
	static Config: Schema<Installer.Config> = Schema.object({
		endpoint: Schema.string().role("link"),
		timeout: Schema.number()
			.role("time")
			.default(Time.second * 5),
	}); // TODO .hidden()
}

declare namespace Installer {
	export interface Config {
		endpoint?: string;
		timeout?: number;
	}
}

export default Installer;
