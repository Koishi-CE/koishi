// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import net from "node:net";
import type { Plugin } from "@koishi-ce/koishi";
import {
	App,
	FakeConsole,
	FakeLoader,
	flakyIndexHits,
	http,
	itQuiet,
	market,
	memory,
	registryServer,
	setFlakyIndexHits,
	setFlakyIndexMisses,
	setSlowIndexHits,
	slowIndexHits,
	startApp,
	stopApp,
	type TestApp,
} from "./helpers.ts";

beforeAll(startApp);
afterAll(stopApp);

describe("镜像索引瞬态重试", () => {
	/** 搭建配了 search.endpoint 的独立宿主（镜像索引经本测试桩提供）。 */
	async function createMirrorApp(search: {
		endpoint: string;
		timeout?: number;
	}) {
		const mirror = new App();
		mirror.plugin(memory);
		mirror.plugin(http);
		mirror.plugin(
			FakeConsole as unknown as Plugin.Constructor<TestApp>,
		);
		mirror.plugin(FakeLoader);
		mirror.plugin(market, {
			registry: {
				endpoint: `http://127.0.0.1:${registryServer.port}/`,
			},
			search,
		});
		await mirror.start();
		return mirror;
	}

	it("镜像索引部署窗口 404 经退避重试后恢复", async () => {
		setFlakyIndexHits(0);
		setFlakyIndexMisses(2);
		const mirror = await createMirrorApp({
			endpoint: `http://127.0.0.1:${registryServer.port}/flaky-index`,
		});
		const svc = mirror.get("console.services.market");
		// start(true) 内部 await prepare：前两次 404，退避重试后第三次成功
		await svc?.start(true);
		expect(flakyIndexHits).toBeGreaterThanOrEqual(3);
		const payload = await svc?.get();
		expect(Object.keys(payload?.data ?? {})).toEqual([
			"koishi-plugin-demo",
		]);
		expect(payload?.total).toBe(1);
		await mirror.stop();
	}, 10000);

	itQuiet(
		"镜像索引持续超时经重试后优雅失败",
		async () => {
			setSlowIndexHits(0);
			const mirror = await createMirrorApp({
				endpoint: `http://127.0.0.1:${registryServer.port}/slow-index`,
				timeout: 50,
			});
			const svc = mirror.get("console.services.market");
			// 每次尝试 50ms 即超时，退避 1s + 2s 后仍失败；重试确实发生
			await svc?.start(true);
			expect(slowIndexHits).toBeGreaterThanOrEqual(3);
			// start 末尾的 refresh 会再触发一轮 collect，等待其失败落地
			await new Promise((resolve) =>
				setTimeout(resolve, 3600),
			);
			const error = svc?.["_error" as keyof typeof svc];
			expect(error).toBeDefined();
			await mirror.stop();
		},
		15000,
	);

	// 裸 TCP 桩：前 planned 次请求收到请求头后直接销毁连接（复现
	// 证书验证失败 / 连接重置等 fetch 网络层瞬态错误），随后回正常索引
	function startFlakyTcpServer(planned: number) {
		let hits = 0;
		const server = net.createServer((socket) => {
			socket.on("data", () => {
				hits++;
				if (hits <= planned) {
					socket.destroy();
					return;
				}
				const body = JSON.stringify({
					version: "4",
					objects: [
						{
							package: {
								name: "koishi-plugin-demo",
								version: "2.0.0",
								date: "2024-06-01T00:00:00Z",
								keywords: ["koishi", "plugin"],
							},
						},
					],
				});
				socket.end(
					`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
				);
			});
		});
		return new Promise<{
			port: number;
			hits: () => number;
			close: () => void;
		}>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				const { port } =
					server.address() as net.AddressInfo;
				resolve({
					port,
					hits: () => hits,
					close: () => {
						server.close();
					},
				});
			});
		});
	}

	it("网络层瞬态错误（连接重置）经退避重试后恢复", async () => {
		const stub = await startFlakyTcpServer(2);
		const mirror = await createMirrorApp({
			endpoint: `http://127.0.0.1:${stub.port}/`,
		});
		const svc = mirror.get("console.services.market");
		// 前两次连接被重置（fetch 抛 TypeError，plugin-http 包装为无 code
		// 无 response 的 HTTP.Error），退避重试后第三次成功
		await svc?.start(true);
		expect(stub.hits()).toBeGreaterThanOrEqual(3);
		const payload = await svc?.get();
		expect(Object.keys(payload?.data ?? {})).toEqual([
			"koishi-plugin-demo",
		]);
		expect(payload?.total).toBe(1);
		await mirror.stop();
		stub.close();
	}, 10000);
});
