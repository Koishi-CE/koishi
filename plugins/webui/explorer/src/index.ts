import { DataService } from "@koishi-ce/console";
import { type Context, type Dict, Schema } from "@koishi-ce/koishi";
import anymatch, { type Tester } from "anymatch";
import { detect } from "chardet";
import type { FSWatcher } from "chokidar";
import { fileTypeFromBuffer } from "file-type";
import {
	mkdir,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
	writeFile,
} from "fs/promises";
import { join, relative, resolve } from "path";
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

export interface File {
	base64: string;
	mime?: string;
	encoding?: string;
}

export interface Entry {
	type: "file" | "directory" | "symlink";
	name: string;
	mime?: string;
	target?: string;
	filename?: string;
	children?: this[];
	oldValue?: string;
	newValue?: string;
	loading?: Promise<File>;
}

class Explorer extends DataService<Entry[]> {
	// 配置 schema 的值侧由类静态承载(erasableSyntaxOnly 不允许 namespace 内运行时值),
	// 类型侧见下方 namespace Explorer 的 Config
	// biome-ignore lint/style/useNamingConvention: 插件 Schema 约定为 PascalCase 的 Config 静态属性
	static Config: Schema<Explorer.Config> = Schema.object({
		root: Schema.string().default(""),
		ignored: Schema.array(String)
			.role("table")
			.default(["**/node_modules", "**/.*", "cache"]),
	}).i18n({
		"zh-CN": zhCN,
	});

	task!: Promise<Entry[]>;
	watchers: Dict<FSWatcher> = Object.create(null);
	globFilter: Tester;
	root: string;

	constructor(ctx: Context, config: Explorer.Config) {
		super(ctx, "explorer", { authority: 4 });

		ctx.console.addEntry(
			process.env["KOISHI_BASE"]
				? [
						process.env["KOISHI_BASE"] + "/dist/index.js",
						process.env["KOISHI_BASE"] + "/dist/style.css",
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
		for (const watcher of Object.values(this.watchers)) {
			watcher.close();
		}
	}

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

	private async _get() {
		return this.traverse(this.root);
	}

	override async get(forced = false) {
		if (!forced && this.task) return this.task;
		return (this.task = this._get());
	}
}

namespace Explorer {
	export interface Config {
		root?: string;
		ignored?: string[];
	}
}

export default Explorer;
