// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, Logger } from "@koishi-ce/koishi";
import http from "@koishi-ce/plugin-http";
import server from "@koishi-ce/plugin-server";
import serverTemp from "./index.ts";

/**
 * server-temp 的真实服务测试：App 装载 vendored server/http 两依赖
 * 后起真实 HTTP 服务，以 fetch 验证「create 落盘 → 路由读取 → 清理」
 * 的完整链路（create 的 Web 流入参走 Bun.write 直收路径）。
 */

/** 探测一个空闲端口（bind 后立即释放，交给 server 插件复用）。 */
function getFreePort(): Promise<number> {
	return new Promise((resolve) => {
		const probe = Bun.serve({
			port: 0,
			fetch: () => new Response(),
		});
		const { port } = probe;
		probe.stop(true);
		// port: 0 时运行时恒为实际分配端口，类型面可空仅是声明保守
		resolve(port ?? 0);
	});
}

const serverPort = await getFreePort();
const baseDir = mkdtempSync(join(tmpdir(), "server-temp-"));
const app = new App();
// baseDir 是 cordis Context 的公共字段（非 config），构造后赋值即可
app.baseDir = baseDir;

app.plugin(server, { host: "127.0.0.1", port: serverPort });
app.plugin(http);
app.plugin(serverTemp, {
	path: "/temp",
	selfUrl: `http://127.0.0.1:${serverPort}/`,
	maxAge: 60_000,
});

const temp = () => app["server.temp"];

beforeAll(() => {
	// server listening/closing 是生命周期 info，收敛为仅错误级
	(Logger.levels as Record<string, number>)["server"] = 1;
	// 缺省 selfUrl 的 warn 属预期（本测试已显式配置），同样收敛
	(Logger.levels as Record<string, number>)["temp"] = 1;
	return app.start();
});

afterAll(async () => {
	await app.stop();
	rmSync(baseDir, { recursive: true, force: true });
});

describe("server-temp 插件", () => {
	it("start 时在 baseDir/temp 下创建一次性随机目录", () => {
		expect(temp().baseDir).toMatch(
			/[\\/]temp[\\/][0-9a-f-]{36}[\\/]$/,
		);
		expect(existsSync(temp().baseDir)).toBe(true);
	});

	it("create(Buffer) 落盘并经路由可读回", async () => {
		const entry = await temp().create(
			Buffer.from("buffer-body"),
		);
		expect(existsSync(entry.path)).toBe(true);
		const response = await fetch(entry.url);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("buffer-body");
	});

	it("create(ReadableStream) 经 Bun.write 直收落盘", async () => {
		const chunks = ["stream-", "part-a", "-part-b"];
		const stream = new ReadableStream({
			start(controller) {
				for (const chunk of chunks) {
					controller.enqueue(
						new TextEncoder().encode(chunk),
					);
				}
				controller.close();
			},
		});
		const entry = await temp().create(stream);
		const response = await fetch(entry.url);
		expect(await response.text()).toBe(chunks.join(""));
	});

	it("create(file: URL) 直接复用原路径不复制", async () => {
		const entry = await temp().create(
			`file:///${join(baseDir, "x").replaceAll("\\", "/")}`,
		);
		// 该路径不存在文件，但条目 path 即 file: 转换结果本身
		expect(entry.path).toBe(join(baseDir, "x"));
	});

	it("未知文件名与未知路由均 404", async () => {
		const response = await fetch(
			`${`http://127.0.0.1:${serverPort}`}/temp/no-such-entry`,
		);
		expect(response.status).toBe(404);
	});

	it("dispose 删除文件并使路由失效", async () => {
		const entry = await temp().create(
			Buffer.from("dispose-me"),
		);
		expect(existsSync(entry.path)).toBe(true);
		await entry.dispose!();
		expect(existsSync(entry.path)).toBe(false);
		const response = await fetch(entry.url);
		expect(response.status).toBe(404);
	});

	it("maxAge 到期自动清理（真实短定时器）", async () => {
		const shortLived = new App();
		shortLived.baseDir = baseDir;
		shortLived.plugin(server, {
			host: "127.0.0.1",
			port: 0,
		});
		shortLived.plugin(http);
		shortLived.plugin(serverTemp, {
			path: "/temp",
			selfUrl: "http://127.0.0.1/",
			maxAge: 30,
		});
		await shortLived.start();
		const service = shortLived["server.temp"];
		const entry = await service.create(
			Buffer.from("short-lived"),
		);
		expect(existsSync(entry.path)).toBe(true);
		// maxAge 30ms + 定时器触发后的异步 rm，让渡足够时间
		await new Promise((resolve) =>
			setTimeout(resolve, 200),
		);
		expect(existsSync(entry.path)).toBe(false);
		expect(
			service.entries[entry.url.split("/").pop()!],
		).toBeUndefined();
		await shortLived.stop();
	});
});
