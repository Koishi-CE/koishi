// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * server-temp 插件：在 HTTP 服务上暴露临时文件路由（服务名 server.temp）。
 *
 * 移植自 @cordisjs/plugin-server-temp：
 * - start() 时在 `<baseDir>/temp/` 下创建一次性随机目录，stop() 时整体删除；
 * - create() 接受字符串（file: URL 或 http(s) URL，后者经 ctx.http 以
 *   stream 拉取）、Buffer 或 Web ReadableStream，落盘并登记路由，
 *   返回 { path, url, dispose }；
 * - 每个条目由 ctx.effect 托管生命周期，maxAge 到期自动清理
 * （主动调用 entry.dispose() 可提前删除）。
 */

import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { ReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import {
	type Context,
	type Dict,
	Schema,
	Service,
	sanitize,
	Time,
} from "@koishi-ce/koishi";
// 仅为引入 plugin-server / plugin-http 的模块增强，
// 使下方 ctx.server / ctx.http 的类型可用
import type {} from "@koishi-ce/plugin-http";
import type {} from "@koishi-ce/plugin-server";

// 模块增强指向本仓库的 @koishi-ce/koishi（上游目标 'cordis' 自本插件目录
// 无法经 node_modules 链解析，仓库惯例是服务声明统一聚合在 CE 主包名下）。
// 上游另有的 `namespace Context { interface Server { temp } }` 增强挂在
// cordis 的 Context.Server 上（ctx.server.temp），此处无落点，消费方一律
// 以服务名 `ctx["server.temp"]` 访问。
declare module "@koishi-ce/koishi" {
	interface Context {
		"server.temp": TempServer;
	}
}

/** 临时文件条目：磁盘路径、公网 URL 与清理回调。 */
export interface Entry {
	path: string;
	url: string;
	dispose?: () => void;
}

/**
 * 临时文件服务：向 server 注册 `<path>/:name` 路由，按随机文件名
 * 查表返回文件流；条目到期或上下文销毁时自动清理。
 */
class TempServer extends Service {
	static inject = ["server", "http"];

	// 配置 schema 的值侧由类静态承载（erasableSyntaxOnly 不允许 namespace 内运行时值），
	// 类型侧见下方 namespace TempServer 的 Config
	static Config: Schema<TempServer.Config> = Schema.object({
		path: Schema.string().default("/temp"),
		selfUrl: Schema.string()
			.role("link")
			.description(
				"此服务暴露在公网的地址。缺省时将使用全局配置。",
			),
		maxAge: Schema.number()
			.default(Time.minute * 5)
			.description("临时文件的默认最大存活时间。"),
	});

	/** 路由前缀（经 sanitize 规整，如 "/temp"） */
	public path: string;

	/** 公网基地址：插件配置缺省时取 server 全局配置的 selfUrl */
	public selfUrl = "";

	/** 一次性工作目录（start 时创建，stop 时删除） */
	public baseDir = "";

	/** 已登记的临时文件条目（键为随机文件名） */
	public entries: Dict<Entry> = Object.create(null);

	public override config: TempServer.Config;

	// constructor 参数属性被 erasableSyntaxOnly 禁止，拆为显式字段赋值
	constructor(ctx: Context, config: TempServer.Config) {
		super(ctx, "server.temp");
		this.config = config;

		const logger = ctx.logger("temp");

		this.path = sanitize(config.path);
		// selfUrl 双重缺省：插件配置 → server 全局配置 → 空串（仅告警）
		this.selfUrl =
			config.selfUrl || ctx.server.config.selfUrl || "";
		if (!this.selfUrl) {
			logger.warn("missing selfUrl configuration");
		}

		ctx.server.get(`${this.path}/:name`, async (koa) => {
			// noUncheckedIndexedAccess：先取出路由参数判空再查表
			const name = koa.params["name"];
			if (!name) {
				koa.status = 404;
				return;
			}
			logger.debug(name);
			const entry = this.entries[name];
			if (!entry) {
				koa.status = 404;
				return;
			}
			koa.body = createReadStream(entry.path);
		});
	}

	override async start() {
		this.baseDir = `${this.ctx.baseDir}/temp/${Math.random().toString(36).slice(2)}/`;
		await mkdir(this.baseDir, { recursive: true });
	}

	override async stop() {
		await rm(this.baseDir, { recursive: true });
	}

	/**
	 * 创建一个临时文件条目。
	 *
	 * @param data 文本（file: URL 取本地路径，其余按 URL 经 ctx.http 拉流）、
	 *   Buffer 或 Web ReadableStream（Node 侧为 node:stream/web 的流）
	 */
	async create(
		data: string | Buffer | ReadableStream,
	): Promise<Entry> {
		const name = Math.random().toString(36).slice(2);
		const url = `${this.selfUrl}${this.path}/${name}`;
		let path: string;
		if (typeof data === "string") {
			if (new URL(data).protocol === "file:") {
				path = fileURLToPath(data);
			} else {
				const stream = await this.ctx.http.get(data, {
					responseType: "stream",
				});
				path = this.baseDir + name;
				await writeFile(path, Readable.fromWeb(stream));
			}
		} else {
			path = this.baseDir + name;
			await writeFile(
				path,
				data instanceof ReadableStream
					? Readable.fromWeb(data)
					: data,
			);
		}
		// 条目由 ctx.effect 托管：上下文销毁时随 dispose 清理；
		// dispose 先于 timer 声明，setTimeout 回调异步触发，无 TDZ 风险
		return this.ctx.effect((): Required<Entry> => {
			const dispose = async () => {
				clearTimeout(timer);
				delete this.entries[name];
				if (path.startsWith(this.baseDir)) await rm(path);
			};
			const timer = setTimeout(
				() => void dispose(),
				this.config.maxAge,
			);
			const entry: Required<Entry> = { path, url, dispose };
			this.entries[name] = entry;
			return entry;
		});
	}
}

namespace TempServer {
	/** 插件配置：路由前缀、公网基地址与条目默认存活时间。 */
	export interface Config {
		path: string;
		selfUrl?: string;
		maxAge?: number;
	}
}

export default TempServer;
