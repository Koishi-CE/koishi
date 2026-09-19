// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 依赖管理数据服务（`dependencies` 通道）。
 *
 * 单向数据流的 node 侧源头：get() 同步构建本地快照（纯磁盘读取）先行
 * 推送（条目带 fetching 标记），随后在后台并发拉取 registry 元数据填充
 * latest / error，完成后触发通道刷新二拍推送——前端首屏因此有明确的
 * 「加载中」态，不会把未拉取完的条目误显示为错误。
 *
 * node 侧并发纪律（对标参照实现）：
 * - 单飞去重：元数据刷新任务同一时刻至多一个，并发调用复用同一任务；
 * - 循环重扫：刷新循环每轮从快照里重新收集 fetching 条目，期间新的
 *   get()（安装完成、客户端接入）带来的新条目自动被后续轮次接管，
 *   不会因单飞复用旧任务而漏拉；
 * - 过期不覆盖：拉取完成后若快照代次已更新，跳过通道刷新（新循环
 *   完成后自会推送）。
 */
import { DataService } from "@koishi-ce/console";
import type { Context, Dict } from "@koishi-ce/koishi";
import { mapLimit } from "@koishi-ce/registry";
import { loadManifest } from "../installer/manifest.ts";
import {
	collectDependencyRequests,
	resolveLocalDependency,
} from "./snapshot.ts";
import type { Dependency } from "./types.ts";

/** registry 元数据并发拉取上限 */
const CONCURRENCY = 4;

export class DependencyService extends DataService<
	Dict<Dependency>
> {
	// 基类 DataService 声明了 console 注入，子类覆盖须一并保留
	static inject = ["console", "installer"];

	/** 快照代次：每次 get() 自增，用于判定后台刷新结果是否已过期 */
	private serial = 0;
	/** 进行中的元数据刷新任务（单飞去重） */
	declare private task: Promise<void> | undefined;
	/** 最近一轮快照（新快照构建时复用 latest 与 404 负缓存） */
	private cache: Dict<Dependency> = {};

	constructor(ctx: Context) {
		super(ctx, "dependencies", { authority: 4 });
	}

	override async get() {
		this.serial++;
		const manifest = loadManifest(this.ctx.baseDir);
		const snapshot = collectDependencyRequests(
			manifest.dependencies,
		);
		for (const [name, dep] of Object.entries(snapshot)) {
			resolveLocalDependency(name, dep, {
				previous: this.cache[name],
			});
		}
		this.cache = snapshot;
		this.ensureMetadata();
		return snapshot;
	}

	private ensureMetadata() {
		if (this.task) return;
		this.task = this.refreshMetadata().finally(() => {
			this.task = undefined;
		});
	}

	/**
	 * 元数据刷新循环：拉完本轮全部 fetching 条目后，若快照代次未变则
	 * 触发通道刷新（二拍推送）；代次已变（期间有新的 get()）则重扫
	 * fetching 条目继续，直到无新增且代次一致。
	 */
	private async refreshMetadata() {
		for (;;) {
			const serial = this.serial;
			const targets = Object.entries(this.cache)
				.filter(([, dep]) => dep.fetching)
				.map(([name]) => name);
			if (!targets.length) return;
			const installer = this.ctx.installer;
			await mapLimit(targets, CONCURRENCY, async (name) => {
				await this.resolveMetadata(name);
			});
			if (serial !== this.serial) continue;
			// 版本表经 registry 通道下发（版本下拉消费），一并刷新
			this.ctx.get("console")?.refresh("dependencies");
			this.ctx.get("console")?.refresh("registry");
			return;
		}
	}

	/** 单个条目的元数据解析：拉取版本表并填充 latest / error。 */
	private async resolveMetadata(name: string) {
		const dep = this.cache[name];
		if (!dep || !dep.fetching) return;
		const installer = this.ctx.installer;
		// getPackage 内部单飞去重并写 fullCache；失败也 resolve 空表
		const versions = await installer.getPackage(name);
		delete dep.fetching;
		if (!Object.keys(versions).length) {
			// 拉取失败：404 归类 not-found（负缓存），其余为网络错误
			dep.error = installer.pkgErrors[name]?.notFound
				? "not-found"
				: "network";
			delete dep.latest;
			return;
		}
		const [latest] = Object.keys(versions);
		if (latest !== undefined) dep.latest = latest;
	}
}

export default DependencyService;
