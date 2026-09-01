// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 资源服务抽象基类（Assets）。
 *
 * 「资源」指消息中的媒体文件（img / audio / video）。本服务提供两类能力：
 * - transform()：遍历消息中的媒体元素，命中白名单前缀的原样保留，
 *   其余交由派生类 upload() 持久化并替换 src；
 * - analyze()：经 ctx.http 拉取远端文件，计算 sha1 摘要、按文件魔数
 *   （file-type）探测扩展名，产出 FileInfo 供派生类落盘命名。
 *
 * 派生类需实现 upload()（上传并返回可访问 URL）与 stats()（存量统计），
 * 如 plugins/common/assets-local。
 */
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { type Context, type Dict, h, Schema, Service } from "@koishi-ce/koishi";
// 仅为引入 plugin-http 的模块增强，使下方 ctx.http 的类型可用
import type {} from "@koishi-ce/plugin-http";
import { fileTypeFromBuffer } from "file-type";

// 通过模块合并向全局类型注入 assets 服务
declare module "@koishi-ce/koishi" {
	interface Context {
		/** 资源服务实例 */
		assets: Assets;
	}
}

/** 资源服务抽象基类 */
export abstract class Assets<
	T extends Assets.Config = Assets.Config,
> extends Service {
	static filter = false;
	/** 参与转换的元素类型 */
	static types = ["img", "audio", "video"];
	static inject = ["http"];
	/** 服务配置的 Schema（静态挂载，供派生类的 Schema.intersect 引用） */
	static Config: Schema<Assets.Config> = Schema.object({
		whitelist: Schema.array(
			Schema.string().required().role("link"),
		).description("不处理的白名单 URL 列表。"),
	});

	/** 参与转换的元素类型（实例侧镜像，派生类可收窄） */
	protected types: readonly string[] = Assets.types;

	// erasableSyntaxOnly 禁止构造器参数属性，改为显式字段声明 + 赋值
	protected override ctx: Context;
	/** 服务配置 */
	public override config: T;

	/** 上传资源文件并返回可访问的 URL */
	abstract upload(url: string, file: string): Promise<string>;
	/** 获取存量资源统计 */
	abstract stats(): Promise<Assets.Stats>;

	constructor(ctx: Context, config: T) {
		super(ctx, "assets");
		this.ctx = ctx;
		this.config = config;
	}

	/**
	 * 遍历消息中的媒体元素：命中白名单前缀的原样保留，
	 * 其余交由 upload() 持久化并替换 src。
	 */
	public async transform(content: string) {
		const whitelist = this.config.whitelist ?? [];
		const rules: Dict<h.Transformer> = Object.fromEntries(
			this.types.map((type) => {
				return [
					type,
					async (attrs: Dict) => {
						const src = attrs["src"];
						if (
							typeof src === "string" &&
							whitelist.some((prefix) => src.startsWith(prefix))
						) {
							return h(type, attrs);
						}
						const file = attrs["file"];
						return h(type, {
							src: await this.upload(
								typeof src === "string" ? src : "",
								typeof file === "string" ? file : "",
							),
						});
					},
				];
			}),
		);
		return await h.transformAsync(content, rules);
	}

	/**
	 * 拉取远端文件并产出落盘所需的元信息：sha1 摘要 + 扩展名。
	 * 指定了文件名时沿用其 basename（不以 . 开头时补 - 前缀分隔），
	 * 否则按文件魔数（file-type）探测扩展名。
	 */
	protected async analyze(url: string, name = ""): Promise<Assets.FileInfo> {
		const file = await this.ctx.http.file(url);
		const buffer = Buffer.from(file.data);
		const hash = createHash("sha1").update(buffer).digest("hex");
		let suffix: string;
		if (name) {
			suffix = basename(name);
			if (!suffix.startsWith(".")) {
				suffix = `-${suffix}`;
			}
		} else {
			const fileType = await fileTypeFromBuffer(buffer);
			suffix = fileType ? `.${fileType.ext}` : "";
		}
		return {
			buffer,
			hash,
			name: suffix,
			filename: `${hash}${suffix}`,
			type: file.type,
		};
	}
}

export namespace Assets {
	/** 存量资源统计 */
	export interface Stats {
		assetCount?: number;
		assetSize?: number;
	}

	/** 待落盘文件的元信息 */
	export interface FileInfo {
		buffer: Buffer;
		hash: string;
		name: string;
		filename: string;
		type?: string;
	}

	/** 服务配置 */
	export interface Config {
		whitelist?: string[];
	}
}

export default Assets;
