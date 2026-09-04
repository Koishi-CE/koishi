// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 本地资源服务插件（assets-local）。
 *
 * assets 服务的第一方实现：把消息中的媒体文件持久化到本地目录
 * （默认 data/assets），并经 plugin-server 暴露为静态文件路由：
 * - GET  <path>：获取存量统计；
 * - GET  <path>/:name：按文件头魔数（而非扩展名）判定 MIME 后流式返回文件；
 * - POST <path>：经 HMAC 校验后上传资源，返回可访问 URL。
 *
 * 缺省 selfUrl（插件与全局均未配置）时回退为 file: 协议地址（无服务器场景）；
 * 启动时自动把旧版 public/ 目录迁移到数据目录。
 */
import { createHmac } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import {
	cp,
	mkdir,
	open,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Assets from "@koishi-ce/assets";
import { type Context, Schema } from "@koishi-ce/koishi";
// 仅为引入 plugin-server 的模块增强，使下方 ctx.server 的类型可用
import type {} from "@koishi-ce/plugin-server";
import { sanitize, trimSlash } from "cosmokit";
import { fileTypeFromBuffer } from "file-type";

class LocalAssets extends Assets<LocalAssets.Config> {
	static override inject = ["server"];

	/** 插件配置的 Schema（静态挂载与 koishi 插件约定同构） */
	static override Config: Schema<LocalAssets.Config> =
		Schema.intersect([
			Schema.object({
				root: Schema.path({
					filters: ["directory"],
					allowCreate: true,
				})
					.default("data/assets")
					.description("本地存储资源文件的相对路径。"),
				path: Schema.string()
					.default("/files")
					.description("静态图片暴露在服务器的路径。"),
				selfUrl: Schema.string()
					.role("link")
					.description(
						"Koishi 服务暴露在公网的地址。缺省时将使用全局配置。",
					),
				secret: Schema.string()
					.role("secret")
					.description(
						"用于验证上传者的密钥，配合 assets-remote 使用。",
					),
			}),
			Assets.Config,
		]);

	/** 启动任务（存量统计），upload / stats 在其完成后才可用 */
	private _task: Promise<void> = Promise.resolve();
	private _stats: Assets.Stats = {
		assetCount: 0,
		assetSize: 0,
	};

	private path = "";
	private root: string;
	private baseUrl: string;
	private noServer = false;

	constructor(ctx: Context, config: LocalAssets.Config) {
		super(ctx, config);

		this.root = resolve(
			ctx.baseDir,
			config.root || "data/assets",
		);

		const selfUrl =
			config.selfUrl || ctx.server.config.selfUrl;
		if (selfUrl) {
			this.path = sanitize(config.path || "/files");
			this.baseUrl = trimSlash(selfUrl) + this.path;
			this.initServer();
		} else {
			this.ctx.logger.info(
				'missing config "selfUrl", fallback to "file:" scheme',
			);
			this.baseUrl = "file:";
			this.noServer = true;
		}
	}

	/** 实际的启动逻辑：迁移旧目录并统计存量文件 */
	private async _start() {
		const legacy = resolve(this.ctx.baseDir, "public");
		await mkdir(this.root, { recursive: true });
		const stats: Stats | null = await stat(legacy).catch(
			() => null,
		);
		if (stats?.isDirectory()) {
			this.ctx.logger.info("migrating to data directory");
			await cp(legacy, this.root);
			await rm(legacy, { recursive: true, force: true });
		}
		const filenames = await readdir(this.root);
		this._stats.assetCount = filenames.length;
		await Promise.all(
			filenames.map(async (file) => {
				const { size } = await stat(
					resolve(this.root, file),
				);
				this._stats.assetSize =
					(this._stats.assetSize ?? 0) + size;
			}),
		);
	}

	override start() {
		this._task = this._start();
	}

	/** 注册静态文件路由（构造时 selfUrl 可用的分支才调用） */
	async initServer() {
		this.ctx.server.get(this.path, async (koa) => {
			koa.body = await this.stats();
		});

		this.ctx.server.get(
			`${this.path}/:name`,
			async (koa) => {
				// 路由参数 :name 必然存在，此守卫仅为收窄类型
				const name = koa.params["name"];
				if (!name) {
					koa.status = 404;
					return;
				}
				const filename = resolve(this.root, basename(name));
				// file-type v22 移除了流式探测导出：改为读取文件头部字节按魔数判定
				// MIME 后再以流式响应返回文件本体。4100 为 file-type 探测所需的最小
				// 样本字节数，判型语义与上游一致（不信任扩展名）。
				const head = Buffer.alloc(4100);
				const handle = await open(filename, "r");
				try {
					const { bytesRead } = await handle.read(
						head,
						0,
						head.byteLength,
						0,
					);
					const fileType = await fileTypeFromBuffer(
						head.subarray(0, bytesRead),
					);
					if (fileType?.mime) {
						koa.type = fileType.mime;
					}
				} finally {
					await handle.close();
				}
				koa.body = createReadStream(filename);
			},
		);

		this.ctx.server.post(this.path, async (koa) => {
			const { salt, sign, url, file } = koa.query;
			if (Array.isArray(file) || Array.isArray(url)) {
				koa.status = 400;
				return;
			}
			// 查询参数解构自索引签名，逐个收窄：url 缺失无法定位资源，
			// file 缺失按空文件名处理（analyze 会转而按魔数探测扩展名）
			if (typeof url !== "string") {
				koa.status = 400;
				return;
			}
			const filename = typeof file === "string" ? file : "";
			if (this.config.secret) {
				if (
					typeof salt !== "string" ||
					typeof sign !== "string"
				) {
					koa.status = 400;
					return;
				}
				const hash = createHmac("sha1", this.config.secret)
					.update(filename + salt)
					.digest("hex");
				if (hash !== sign) {
					koa.status = 403;
					return;
				}
			}
			await this.upload(url, filename);
		});
	}

	/** 落盘并累计存量统计 */
	private async write(buffer: Buffer, filename: string) {
		await writeFile(filename, buffer);
		this._stats.assetCount =
			(this._stats.assetCount ?? 0) + 1;
		this._stats.assetSize =
			(this._stats.assetSize ?? 0) + buffer.byteLength;
	}

	override async upload(url: string, file: string) {
		if (url.startsWith(this.baseUrl)) return url;
		await this._task;
		const { buffer, filename } = await this.analyze(
			url,
			file,
		);
		const savePath = resolve(this.root, filename);
		await this.write(buffer, savePath);
		if (this.noServer) {
			return pathToFileURL(savePath).href;
		}
		return `${this.baseUrl}/${filename}`;
	}

	override async stats(): Promise<Assets.Stats> {
		await this._task;
		return this._stats;
	}
}

export namespace LocalAssets {
	/** 插件配置 */
	export interface Config extends Assets.Config {
		path?: string;
		root?: string;
		secret?: string;
		selfUrl?: string;
	}
}

export default LocalAssets;
