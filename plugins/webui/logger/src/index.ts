import {
	Context,
	type Dict,
	Logger,
	remove,
	Schema,
	Time,
} from "@koishi-ce/koishi";
import { DataService } from "@koishi-ce/plugin-console";
import { mkdir, readdir, rm } from "fs/promises";
import { resolve } from "path";
import { FileWriter } from "./file";
import zhCN from "./locales/zh-CN.yml";

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			logs: DataService<Logger.Record[]>;
		}
	}
}

export const name = "logger";

// reggol v1 的 Logger.Meta 是空接口,运行时 cordis 会写入 ctx、本插件写入 paths,
// 此处补全字段形状用于类型检查,不改变运行时行为
interface LogMeta {
	ctx?: Context;
	paths?: string[];
}

class LogProvider extends DataService<Logger.Record[]> {
	private getWriter: () => FileWriter;

	constructor(ctx: Context, getWriter: () => FileWriter) {
		super(ctx, "logs", { authority: 4 });
		this.getWriter = getWriter;

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
	}

	override async get() {
		return this.getWriter()?.read();
	}
}

export interface Config {
	root?: string;
	maxAge?: number;
	maxSize?: number;
}

export const Config: Schema<Config> = Schema.object({
	root: Schema.path({
		filters: ["directory"],
		allowCreate: true,
	}).default("data/logs"),
	maxAge: Schema.natural().default(30),
	maxSize: Schema.natural().default(1024 * 100),
}).i18n({
	"zh-CN": zhCN,
});

export async function apply(ctx: Context, config: Config) {
	// Schema 默认值同步到此处兜底,与 Config 声明保持一致
	const root = resolve(ctx.baseDir, config.root ?? "data/logs");
	await mkdir(root, { recursive: true });

	const files: Dict<number[]> = {};
	for (const filename of await readdir(root)) {
		const capture = /^(\d{4}-\d{2}-\d{2})-(\d+)\.log$/.exec(filename);
		if (!capture) continue;
		const [, date, index] = capture;
		if (!date || !index) continue;
		const list = (files[date] ??= []);
		list.push(+index);
	}

	let writer: FileWriter;
	async function createFile(date: string, index: number) {
		writer = new FileWriter(date, `${root}/${date}-${index}.log`);

		const { maxAge } = config;
		if (!maxAge) return;

		const now = Date.now();
		for (const date of Object.keys(files)) {
			if (now - +new Date(date) < maxAge * Time.day) continue;
			for (const index of files[date] ?? []) {
				await rm(`${root}/${date}-${index}.log`).catch((error) => {
					ctx.logger("logger").warn(error);
				});
			}
			delete files[date];
		}
	}

	const date = new Date().toISOString().slice(0, 10);
	void createFile(date, Math.max(...(files[date] ?? [0])) + 1);

	let buffer: Logger.Record[] = [];
	const update = ctx.throttle(() => {
		// Be very careful about accessing service in this callback,
		// because undeclared service access may cause infinite loop.
		ctx.get("console")?.patch("logs", buffer);
		buffer = [];
	}, 100);

	const loader = ctx.get("loader");
	const target: Logger.Target = {
		colors: 3,
		record: (record: Logger.Record) => {
			record.meta ||= {};
			const meta: LogMeta = record.meta;
			const scope = meta[Context.current]?.scope;
			if (loader && scope) {
				meta.paths = loader.paths(scope);
			}
			const date = new Date(record.timestamp).toISOString().slice(0, 10);
			if (writer.date !== date) {
				void writer.close();
				files[date] = [1];
				void createFile(date, 1);
			}
			writer.write(record);
			buffer.push(record);
			update();
			if (writer.size >= (config.maxSize ?? 1024 * 100)) {
				void writer.close();
				const index = Math.max(...(files[date] ?? [0])) + 1;
				const list = (files[date] ??= []);
				list.push(index);
				void createFile(date, index);
			}
		},
	};

	Logger.targets.push(target);
	ctx.on("dispose", () => {
		void writer?.close();
		remove(Logger.targets, target);
		if (loader) {
			loader.prolog = [];
		}
	});

	for (const record of loader?.prolog || []) {
		target.record?.(record);
	}

	ctx.plugin(LogProvider, () => writer);
}
