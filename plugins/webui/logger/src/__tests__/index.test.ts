/**
 * @koishi-ce/plugin-logger 的行为测试。
 *
 * 两部分：
 * - FileWriter 单元测试：既有 JSONL 读入、畸形行忽略、写入队列与关闭；
 * - 插件主体：超龄清理与 rm 失败容错、日志落盘、meta.paths 附加、
 *   跨日轮转、超大小轮转、节流 patch 推送、prolog 补写与卸载清理。
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, Console, type Entry } from "@koishi-ce/console";
import { App, Logger, type Plugin, type Universal } from "@koishi-ce/koishi";
import * as loggerPlugin from "@koishi-ce/plugin-logger";
import { FileWriter } from "../file.ts";

/** 出站消息形状 */
interface SentMessage {
	type: string;
	body: { id?: number; key?: string; value?: unknown };
}

/** 内存 WebSocket 桩 */
class FakeSocket {
	sent: string[] = [];
	// message 与 close 的监听器统一为同构签名（never 载荷），保证集合存取类型一致
	private messageHandlers = new Set<(event: never) => void>();
	private closeHandlers = new Set<(event: never) => void>();

	send(data: string) {
		this.sent.push(data);
	}

	addEventListener(type: string, listener: (event: never) => void) {
		if (type === "message") this.messageHandlers.add(listener);
		if (type === "close") this.closeHandlers.add(listener);
	}

	removeEventListener(type: string, listener: (event: never) => void) {
		if (type === "message") this.messageHandlers.delete(listener);
		if (type === "close") this.closeHandlers.delete(listener);
	}

	get socket(): Universal.WebSocket {
		return this as unknown as Universal.WebSocket;
	}
}

function fakeRequest() {
	return {
		headers: {},
		socket: { remoteAddress: "127.0.0.1" },
	} as unknown as IncomingMessage;
}

function tick(ms = 20) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Console 抽象基类的最小实现 */
class TestConsole extends Console {
	resolveEntry(files: Entry.Files, key: string): string[] {
		const list =
			typeof files === "string" || Array.isArray(files) ? files : files.prod;
		return [String(list), key];
	}

	acceptClient(socket: Universal.WebSocket, request: IncomingMessage): Client {
		let accepted: Client | undefined;
		const dispose = this.ctx.on("console/connection", (client) => {
			accepted = client;
		});
		this.accept(socket, request);
		dispose();
		if (!accepted) throw new Error("client not accepted");
		return accepted;
	}
}

function record(content: string, timestamp = Date.now()): Logger.Record {
	return { level: 1, name: "test", timestamp, content } as Logger.Record;
}

function today() {
	return new Date().toISOString().slice(0, 10);
}

function yesterday() {
	return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

/** 路径存在性探测 */
function exists(path: string) {
	return stat(path)
		.then(() => true)
		.catch(() => false);
}

describe("FileWriter", () => {
	it("读入既有 JSONL、忽略畸形行、写入队列与关闭", async () => {
		const dir = await mkdtemp(join(tmpdir(), "koishi-writer-"));
		const path = join(dir, "2020-01-01-1.log");
		await writeFile(
			path,
			`${JSON.stringify(record("one"))}\nnot-json\n${JSON.stringify(record("two"))}\n`,
			"utf8",
		);
		const writer = new FileWriter("2020-01-01", path);
		const data = await writer.read();
		expect(data).toHaveLength(2);
		expect(writer.size).toBeGreaterThan(0);
		expect(writer.date).toBe("2020-01-01");

		// 追加写入：先进 temp 缓冲，队列排空后并入 data
		writer.write(record("three"));
		expect(await writer.read()).toHaveLength(3);

		// parse 直接调用：仅保留可解析的行
		expect(writer.parse('{"a":1}\nbad\n')).toEqual([{ a: 1 }]);

		await writer.close();

		// 新实例再次打开同一文件：读入累计内容
		const reopened = new FileWriter("2020-01-01", path);
		expect(await reopened.read()).toHaveLength(3);
		await reopened.close();
	});
});

describe("@koishi-ce/plugin-logger", () => {
	const root = join(tmpdir(), `koishi-logger-${Date.now()}`);
	const app = new App();
	// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
	app.plugin(TestConsole as unknown as Plugin.Constructor<App>);

	let socket: FakeSocket;
	let target: Logger.Target;

	beforeAll(async () => {
		// 预置：一个以 .log 命名的目录（rm 失败走容错）、两个超龄日志文件（应被清理）
		await mkdir(join(root, "2000-01-01-1.log"), { recursive: true });
		await writeFile(join(root, "2000-01-01-2.log"), "{}", "utf8");
		await writeFile(join(root, "2000-01-01-3.log"), "{}", "utf8");

		// loader 需在插件加载前就位（apply 时捕获），供 meta.paths 与 prolog 链路使用
		app.provide("loader", {
			paths: () => ["group:entry", "logger"],
			prolog: [],
		});
		app.plugin(loggerPlugin, { root, maxAge: 30, maxSize: 512 });
		await app.start();
		socket = new FakeSocket();
		(app.console as TestConsole).acceptClient(socket.socket, fakeRequest());
		await tick();
		const targets = Logger.targets as Logger.Target[];
		target = targets.at(-1) as Logger.Target;
		expect(typeof target.record).toBe("function");
	});

	afterAll(async () => {
		for (const entry of Object.values((app.console as TestConsole).entries)) {
			entry.dispose();
		}
		await tick();
		await app.stop();
	});

	it("启动清理超龄日志（目录形态触发容错分支）", async () => {
		// 普通超龄文件被删除
		expect(await exists(join(root, "2000-01-01-2.log"))).toBe(false);
		expect(await exists(join(root, "2000-01-01-3.log"))).toBe(false);
		// 目录清理失败仅告警，本体保留
		expect(await exists(join(root, "2000-01-01-1.log"))).toBe(true);
	});

	it("日志写入当日文件并节流 patch 推送前端", async () => {
		socket.sent.length = 0;
		target.record?.(record("hello world"));
		await tick(150);

		const content = await readFile(join(root, `${today()}-1.log`), "utf8");
		expect(content).toContain("hello world");
		// 节流 patch 携带缓冲的日志记录
		const patches = socket.sent
			.map((line) => JSON.parse(line) as SentMessage)
			.filter((msg) => msg.type === "patch" && msg.body.key === "logs");
		expect(patches).toHaveLength(1);
		expect(JSON.stringify(patches[0]?.body.value)).toContain("hello world");

		// logs 数据服务读取全量记录
		const provider = app.get("console.services.logs") as unknown as {
			get(): Promise<Logger.Record[]>;
		};
		const data = await provider.get();
		expect(data.some((item) => item.content === "hello world")).toBe(true);
	});

	it("meta.ctx 存在时附加 loader 计算的插件路径", async () => {
		const withCtx = record("with-path") as Logger.Record & {
			meta: Record<string, unknown>;
		};
		withCtx.meta = { ctx: { scope: {} } };
		target.record?.(withCtx);
		await tick(150);
		const content = await readFile(join(root, `${today()}-1.log`), "utf8");
		expect(content).toContain('"paths":["group:entry","logger"]');
	});

	it("跨日记录触发日期轮转（建立新日期文件）", async () => {
		target.record?.(record("yesterday-log", Date.now() - 86_400_000));
		await tick(150);
		// 轮转建立昨日文件；写入器引用在异步回调中切换（记录排队语义由实现细节决定）
		expect(await exists(join(root, `${yesterday()}-1.log`))).toBe(true);
	});

	it("超过单文件大小上限触发序号轮转", async () => {
		// 当前写入器已轮转到昨日文件：以同日期写入超限内容
		const big = "x".repeat(2048);
		target.record?.(record(big, Date.now() - 86_400_000));
		await tick(150);
		// size 在写入队列排空后才累计，再写一条触发轮转判定
		target.record?.(record("after-big", Date.now() - 86_400_000));
		await tick(200);
		expect(await exists(join(root, `${yesterday()}-2.log`))).toBe(true);
	});

	it("loader 暂存的 prolog 在加载时补写，卸载时清理", async () => {
		const dir = join(tmpdir(), `koishi-logger-prolog-${Date.now()}`);
		await mkdir(dir, { recursive: true });
		const loader = app.get("loader") as { prolog: unknown[] };
		loader.prolog = [record("prolog-message")];
		// 注册表按 apply 函数引用去重：克隆须换名并包一层新的 apply
		const targetsBefore = (Logger.targets as Logger.Target[]).length;
		const fork = app.plugin(
			{
				...loggerPlugin,
				name: "logger-clone-test",
				apply: (ctx: Parameters<typeof loggerPlugin.apply>[0], config) =>
					loggerPlugin.apply(ctx, config),
			},
			{
				root: dir,
				maxAge: 0,
				maxSize: 1024 * 100,
			},
		);
		await tick(100);
		const content = await readFile(join(dir, `${today()}-1.log`), "utf8");
		expect(content).toContain("prolog-message");
		fork.dispose();
		await tick(50);
		// 卸载：清空 loader 暂存、摘除日志 target
		expect(loader.prolog).toHaveLength(0);
		expect((Logger.targets as Logger.Target[]).length).toBe(targetsBefore);
	});
});
