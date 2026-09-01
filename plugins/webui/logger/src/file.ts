// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { Buffer } from "node:buffer";
import { type FileHandle, open } from "node:fs/promises";
import type { Logger } from "@koishi-ce/koishi";

/**
 * 追加式日志文件写入器（每行一条 JSON）。
 *
 * 内部用一条 Promise 链（task）串行化所有文件操作：打开后先读入既有内容，
 * 之后的写入（flush）依次排队，既保证顺序又避免并发句柄冲突；
 * 新纪录先进 temp 缓冲，data 数组始终保留全量记录供前端读取。
 */
export class FileWriter {
	// data / size 在构造器的异步回调中赋值,先给空初始值避免读到 undefined
	public data: Logger.Record[] = [];
	public task: Promise<FileHandle>;
	public size = 0;

	private temp: Logger.Record[] = [];

	public date: string;
	public path: string;

	/**
	 * @param date 该文件对应的日期串（yyyy-MM-dd），跨日时用于触发轮转
	 * @param path 日志文件完整路径
	 */
	constructor(date: string, path: string) {
		this.date = date;
		this.path = path;
		this.task = open(path, "a+").then(async (handle) => {
			const buffer = await handle.readFile();
			this.data = this.parse(new TextDecoder().decode(buffer));
			this.size = buffer.byteLength;
			return handle;
		});
		void this.task.then(() => this.flush());
	}

	/** 把 temp 缓冲中的记录串行追加写入文件（无待写内容时为空操作）。 */
	flush() {
		if (!this.temp.length) return;
		this.task = this.task.then(async (handle) => {
			const content = Buffer.from(
				this.temp.map((record) => `${JSON.stringify(record)}\n`).join(""),
			);
			this.data.push(...this.temp);
			this.temp = [];
			await handle.write(content);
			this.size += content.byteLength;
			return handle;
		});
	}

	/** 把 JSONL 文本解析为记录数组，忽略无法解析的残行。 */
	parse(text: string) {
		return text
			.split("\n")
			.map((line) => {
				try {
					return JSON.parse(line);
				} catch {}
			})
			.filter(Boolean);
	}

	/** 等待打开 / 写入队列排空后，返回全量记录（供 DataService 下发）。 */
	async read() {
		await this.task;
		return this.data;
	}

	/** 写入单条记录（先进 temp 缓冲，立即尝试落盘）。 */
	write(record: Logger.Record) {
		this.temp.push(record);
		this.flush();
	}

	/** 关闭文件句柄（等待队列中所有写入完成后）。 */
	async close() {
		const handle = await this.task;
		await handle.close();
	}
}
