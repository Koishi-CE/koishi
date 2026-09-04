// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
	Context,
	type Dict,
	Logger,
	remove,
	Schema,
	Time,
} from "@koishi-ce/koishi";
import { DataService } from "@koishi-ce/plugin-console";
import zhCN from "../locales/zh-CN.yml";
import { FileWriter } from "./file.ts";

/**
 * @koishi-ce/plugin-logger 的 node 侧入口。
 *
 * 注册一个全局 Logger target：每条日志写入按「日期-序号」命名的文件
 * （超龄 / 超大自动轮转），同时节流推送到 console 前端；
 * 并通过 DataService 暴露历史日志读取（logs 服务）。
 */

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

/**
 * logs 服务：把当前日志文件的全量内容作为 DataService 数据下发给前端。
 * FileWriter 由插件主体在就绪后注入（通过 getWriter 延迟获取）。
 */
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
					? [
							import.meta.url.replace(
								/\/src\/[^/]+$/,
								"/client/index.ts",
							),
						]
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

/** 插件配置：日志根目录、保留天数与单文件大小上限（KB）。 */
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
	const root = resolve(
		ctx.baseDir,
		config.root ?? "data/logs",
	);
	await mkdir(root, { recursive: true });

	// 扫描既有日志文件，按日期归集序号（如 "2024-01-01-3.log" → files["2024-01-01"] = [3]），
	// 供后续轮转时确定起始序号与清理超龄文件
	const files: Dict<number[]> = {};
	for (const filename of await readdir(root)) {
		const capture = /^(\d{4}-\d{2}-\d{2})-(\d+)\.log$/.exec(
			filename,
		);
		if (!capture) continue;
		const [, date, index] = capture;
		if (!date || !index) continue;
		const list = (files[date] ??= []);
		list.push(+index);
	}

	let writer: FileWriter;
	/**
	 * 新建当天的写入器；顺带按 maxAge 清理超龄日志文件。
	 * @param date 日期串（yyyy-MM-dd）
	 * @param index 该日期下的文件序号
	 */
	async function createFile(date: string, index: number) {
		writer = new FileWriter(
			date,
			`${root}/${date}-${index}.log`,
		);

		const { maxAge } = config;
		if (!maxAge) return;

		const now = Date.now();
		for (const date of Object.keys(files)) {
			if (now - +new Date(date) < maxAge * Time.day)
				continue;
			for (const index of files[date] ?? []) {
				await rm(`${root}/${date}-${index}.log`).catch(
					(error) => {
						ctx.logger("logger").warn(error);
					},
				);
			}
			delete files[date];
		}
	}

	const date = new Date().toISOString().slice(0, 10);
	void createFile(
		date,
		Math.max(...(files[date] ?? [0])) + 1,
	);

	// 推送缓冲：日志先攒进 buffer，由节流回调每 100ms 批量 patch 给前端
	let buffer: Logger.Record[] = [];
	const update = ctx.throttle(() => {
		// 在此回调中访问服务要格外谨慎：
		// 未声明的服务访问可能触发依赖收集，进而造成无限循环
		ctx.get("console")?.patch("logs", buffer);
		buffer = [];
	}, 100);

	const loader = ctx.get("loader");
	// 全局日志 target：附加来源插件的 paths、按日期 / 大小轮转文件，
	// 并把记录推入前端缓冲
	const target: Logger.Target = {
		colors: 3,
		record: (record: Logger.Record) => {
			record.meta ||= {};
			const meta: LogMeta = record.meta;
			const scope = meta[Context.current]?.scope;
			if (loader && scope) {
				meta.paths = loader.paths(scope);
			}
			const date = new Date(record.timestamp)
				.toISOString()
				.slice(0, 10);
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
	// 卸载：关闭文件、摘除 target，并清空 loader 暂存的前置日志
	ctx.on("dispose", () => {
		void writer?.close();
		remove(Logger.targets, target);
		if (loader) {
			loader.prolog = [];
		}
	});

	// loader 在本插件之前攒下的前置日志（prolog）补写进 target
	for (const record of loader?.prolog || []) {
		target.record?.(record);
	}

	ctx.plugin(LogProvider, () => writer);
}
