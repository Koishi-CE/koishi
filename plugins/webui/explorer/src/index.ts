// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * explorer 插件（服务端）：网页文件管理器的 node 侧实现。
 *
 * 以 DataService 形式向控制台客户端推送根目录的完整文件树（Entry[]），
 * 并注册 explorer/read、write、mkdir、remove、rename、refresh 六个
 * RPC 事件（均要求 authority >= 4），供浏览器端执行实际的文件操作。
 * 浏览器端对应实现在 ../client/（index.vue 文件树 + monaco 编辑器）。
 */

import {
	mkdir,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { DataService } from "@koishi-ce/console";
import { type Context, type Dict, Schema } from "@koishi-ce/koishi";
import type { Tester } from "anymatch";
import * as anymatchModule from "anymatch";

// anymatch 的 d.ts 为 ESM 形态而实现为 CJS，nodenext 互操作视图会给 default 多包一层；
// 运行时 namespace.default 即真实的 matchers => Tester 函数（module.exports），断言穿透取用
const anymatch =
	anymatchModule.default as unknown as typeof anymatchModule.default.default;

import { detect } from "chardet";
import type { FSWatcher } from "chokidar";
import { fileTypeFromBuffer } from "file-type";
import zhCN from "../locales/zh-CN.yml";

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			explorer: Explorer;
		}
	}

	interface Events {
		"explorer/read"(filename: string, binary?: boolean): Promise<File>;
		"explorer/write"(
			filename: string,
			content: string,
			binary?: boolean,
		): Promise<void>;
		"explorer/mkdir"(filename: string): Promise<void>;
		"explorer/remove"(filename: string): Promise<void>;
		"explorer/rename"(oldValue: string, newValue: string): Promise<void>;
		"explorer/refresh"(): void;
	}
}

/** explorer/read 事件返回给客户端的文件内容：base64 编码 + 探测出的元信息。 */
export interface File {
	/** 文件内容的 base64 编码（客户端用 Binary.fromBase64 解码） */
	base64: string;
	/** 由 file-type 从文件头字节探测出的 MIME 类型，识别为文本时不存在 */
	mime?: string;
	/** 由 chardet 探测出的文本编码（如 UTF-8） */
	encoding?: string;
}

/** 文件树节点：文件 / 目录 / 符号链接三类，由 traverse() 递归生成。 */
export interface Entry {
	type: "file" | "directory" | "symlink";
	/** 显示名（不含路径） */
	name: string;
	/** 打开文件后由客户端补充的 MIME 类型（决定预览方式） */
	mime?: string;
	/** 符号链接指向的目标路径 */
	target?: string;
	/** 客户端补全的完整相对路径（以 / 开头，由各层目录名拼接） */
	filename?: string;
	/** 子节点列表（仅目录节点存在） */
	children?: this[];
	/** 上次保存的内容（客户端记录，用于判断是否有未保存修改） */
	oldValue?: string;
	/** 当前内容（编辑器实时值，保存后与 oldValue 对齐） */
	newValue?: string;
	/** 正在进行的读取请求（客户端用于展示加载动画） */
	loading?: Promise<File>;
}

/**
 * explorer 数据服务：向客户端广播根目录的文件树。
 *
 * 继承 DataService，get() 的结果经 console 数据通道以 "explorer" 键下发，
 * 客户端通过 store.explorer 读取。配置项见下方 namespace Explorer 的
 * Config（root 相对 ctx.baseDir 解析；ignored 为 anymatch 通配列表）。
 */
class Explorer extends DataService<Entry[]> {
	// 配置 schema 的值侧由类静态承载(erasableSyntaxOnly 不允许 namespace 内运行时值),
	// 类型侧见下方 namespace Explorer 的 Config
	static Config: Schema<Explorer.Config> = Schema.object({
		root: Schema.string().default(""),
		ignored: Schema.array(String)
			.role("table")
			.default(["**/node_modules", "**/.*", "cache"]),
	}).i18n({
		"zh-CN": zhCN,
	});

	task!: Promise<Entry[]>;
	/** 已创建的文件监视器集合（键为路径），stop() 时统一关闭 */
	watchers: Dict<FSWatcher> = Object.create(null);
	/** 由 ignored 配置编译出的 anymatch 过滤器 */
	globFilter: Tester;
	/** 文件树的根目录（ctx.baseDir + 配置的 root 解析出的绝对路径） */
	root: string;

	constructor(ctx: Context, config: Explorer.Config) {
		super(ctx, "explorer", { authority: 4 });

		ctx.console.addEntry(
			process.env["KOISHI_BASE"]
				? [
						`${process.env["KOISHI_BASE"]}/dist/index.js`,
						`${process.env["KOISHI_BASE"]}/dist/style.css`,
					]
				: process.env["KOISHI_ENV"] === "browser"
					? [import.meta.url.replace(/\/src\/[^/]+$/, "/client/index.ts")]
					: {
							dev: resolve(__dirname, "../client/index.ts"),
							prod: resolve(__dirname, "../dist"),
						},
		);

		this.globFilter = anymatch(config.ignored ?? []);
		this.root = resolve(ctx.baseDir, config.root ?? "");

		// 以下六个监听器是浏览器端发出的文件操作 RPC：
		// 客户端传入的 filename 均为相对 root 的路径，写操作完成后
		// 调用 this.refresh() 让文件树重新下发

		// 读取文件内容（base64）并附带探测出的 MIME 类型与文本编码
		ctx.console.addListener(
			"explorer/read",
			async (filename) => {
				filename = join(this.root, filename);
				const buffer = await readFile(filename);
				const result = await fileTypeFromBuffer(buffer);
				const encoding = detect(buffer);
				// exactOptionalPropertyTypes:探测失败时不上键,与原先携带 undefined
				// 值的对象在 JSON 序列化后表现一致
				const file: File = { base64: buffer.toString("base64") };
				if (result) file.mime = result.mime;
				if (encoding) file.encoding = encoding;
				return file;
			},
			{ authority: 4 },
		);

		// 写入文件：binary 为 true 时 content 为 base64（上传场景），
		// 否则视为 utf8 文本（编辑器保存）
		ctx.console.addListener(
			"explorer/write",
			async (filename, content, binary) => {
				filename = join(this.root, filename);
				if (binary) {
					const buffer = Buffer.from(content, "base64");
					await writeFile(filename, buffer);
				} else {
					await writeFile(filename, content, "utf8");
				}
				this.refresh();
			},
			{ authority: 4 },
		);

		ctx.console.addListener(
			"explorer/mkdir",
			async (filename) => {
				filename = join(this.root, filename);
				await mkdir(filename);
				this.refresh();
			},
			{ authority: 4 },
		);

		ctx.console.addListener(
			"explorer/remove",
			async (filename) => {
				filename = join(this.root, filename);
				await rm(filename, { recursive: true });
				this.refresh();
			},
			{ authority: 4 },
		);

		ctx.console.addListener(
			"explorer/rename",
			async (oldValue, newValue) => {
				oldValue = join(this.root, oldValue);
				newValue = join(this.root, newValue);
				await rename(oldValue, newValue);
				this.refresh();
			},
			{ authority: 4 },
		);

		ctx.console.addListener(
			"explorer/refresh",
			() => {
				this.refresh();
			},
			{ authority: 4 },
		);
	}

	override stop() {
		// 插件停用：关闭所有已创建的文件监视器
		for (const watcher of Object.values(this.watchers)) {
			watcher.close();
		}
	}

	/**
	 * 递归遍历目录，生成排序后的文件树。
	 * 排序规则：目录排在最前，其余按名称字母序；被 globFilter
	 * 命中的路径（node_modules、隐藏文件等）直接跳过。
	 */
	private async traverse(root: string): Promise<Entry[]> {
		const dirents = await readdir(root, { withFileTypes: true });
		return Promise.all(
			dirents.map(async (dirent): Promise<Entry | undefined> => {
				const filename = join(root, dirent.name);
				if (this.globFilter(relative(this.root, filename))) return;
				if (dirent.isFile()) {
					return { type: "file", name: dirent.name };
				} else if (dirent.isDirectory()) {
					return {
						type: "directory",
						name: dirent.name,
						children: await this.traverse(filename),
					};
				} else if (dirent.isSymbolicLink()) {
					return {
						type: "symlink",
						name: dirent.name,
						target: await readlink(filename),
					};
				}
				// 其余类型(FIFO / socket 等)不展示,显式返回以通过 noImplicitReturns
				return;
			}),
		).then((entries) =>
			entries
				.filter((entry): entry is Entry => !!entry)
				.sort((a, b) => {
					if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
					return a.name.localeCompare(b.name);
				}),
		);
	}

	/** 实际执行遍历（供 get() 缓存层调用）。 */
	private async _get() {
		return this.traverse(this.root);
	}

	/**
	 * 获取文件树。
	 * @param forced 为 true 时强制重新遍历；否则复用进行中的 Promise，
	 * 避免并发请求触发重复遍历
	 */
	override async get(forced = false) {
		if (!forced && this.task) return this.task;
		return (this.task = this._get());
	}
}

namespace Explorer {
	/** 插件配置（见类静态 Config 的 Schema 定义）。 */
	export interface Config {
		root?: string;
		ignored?: string[];
	}
}

export default Explorer;
