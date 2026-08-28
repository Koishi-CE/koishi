import type { Logger } from "@koishi-ce/koishi";
import { Buffer } from "buffer";
import { type FileHandle, open } from "fs/promises";

export class FileWriter {
	// data / size 在构造器的异步回调中赋值,先给空初始值避免读到 undefined
	public data: Logger.Record[] = [];
	public task: Promise<FileHandle>;
	public size = 0;

	private temp: Logger.Record[] = [];

	public date: string;
	public path: string;

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

	async read() {
		await this.task;
		return this.data;
	}

	write(record: Logger.Record) {
		this.temp.push(record);
		this.flush();
	}

	async close() {
		const handle = await this.task;
		await handle.close();
	}
}
