// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 旧配置迁移测试：request / 代理 / 服务器配置改写为插件形式、http
 * 插件 proxyAgent 的提取与写回（含嵌套 group）、package.json 依赖登记
 * 与字典序回写、无变更不回写及异常吞掉（不阻断启动）。
 *
 * migrateManifest 按进程工作目录读写 package.json，测试全程 chdir 进
 * 临时目录；依赖版本取自 koishi 元包依赖表（按 loader 自身位置解析，
 * 与 cwd 无关）。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@koishi-ce/koishi";
import { migrateManifest } from "../migration.ts";

/** 三个迁移目标插件名（依赖登记的键） */
const pluginDeps = [
	"@koishi-ce/plugin-http",
	"@koishi-ce/plugin-proxy-agent",
	"@koishi-ce/plugin-server",
];

const rootDir = process.cwd();

/** 建立临时目录（含基础 package.json）并 chdir 进去，用后清理 */
async function withDir(
	fn: (dir: string) => Promise<void>,
	meta: Record<string, unknown> = { name: "test-app" },
) {
	const dir = await fs.mkdtemp(join(tmpdir(), "koishi-loader-mig-"));
	try {
		await Bun.write(join(dir, "package.json"), JSON.stringify(meta));
		process.chdir(dir);
		await fn(dir);
	} finally {
		process.chdir(rootDir);
		await fs.rm(dir, { recursive: true, force: true });
	}
}

/** 读取临时目录下 package.json 的解析结果 */
async function readMeta(dir: string) {
	return JSON.parse(await Bun.file(join(dir, "package.json")).text()) as {
		name?: string;
		dependencies?: Record<string, string>;
	};
}

describe("migrateManifest", () => {
	beforeAll(() => {
		// 迁移失败的告警走 "app" 域日志，测试中静默（阈值 0 = SILENT）
		(Logger.levels as Record<string, number>)["app"] = 0;
	});

	afterAll(() => {
		delete (Logger.levels as Record<string, number>)["app"];
	});

	afterEach(() => {
		process.chdir(rootDir);
	});

	it("全新项目：request/代理/端口配置改写为插件并登记依赖", async () => {
		await withDir(async (dir) => {
			const config: Record<string, unknown> = {
				request: { proxy: "http://127.0.0.1:7890" },
				port: 5140,
				host: "0.0.0.0",
				maxPort: 5141,
				selfUrl: "http://localhost:5140",
				plugins: { existing: { keep: true } },
			};
			await migrateManifest(config);

			expect(config).toEqual({
				plugins: {
					// 三个迁移块逐个前插，最终顺序 server → proxy-agent → http
					server: {
						port: 5140,
						host: "0.0.0.0",
						maxPort: 5141,
						selfUrl: "http://localhost:5140",
					},
					"proxy-agent": {},
					http: { proxy: "http://127.0.0.1:7890" },
					existing: { keep: true },
				},
			});

			const meta = await readMeta(dir);
			expect(Object.keys(meta.dependencies ?? {})).toEqual(pluginDeps);
			// 版本取自 koishi 元包依赖表
			expect(meta.dependencies?.["@koishi-ce/plugin-http"]).toBeTruthy();
		});
	});

	it("依赖已登记时不改写对应配置（request 原样保留）", async () => {
		const initialDeps = Object.fromEntries(
			pluginDeps.map((name) => [name, "workspace:*"]),
		);
		await withDir(
			async (dir) => {
				const config: Record<string, unknown> = {
					request: { keep: true },
					plugins: { other: {} },
				};
				await migrateManifest(config);
				// 无任何迁移发生：config 原样、package.json 保持初始内容
				expect(config).toEqual({
					request: { keep: true },
					plugins: { other: {} },
				});
				expect(await readMeta(dir)).toEqual({
					name: "test-app",
					dependencies: initialDeps,
				});
			},
			{ name: "test-app", dependencies: initialDeps },
		);
	});

	it("回写的依赖表按字典序重排且文件以换行结尾", async () => {
		await withDir(
			async (dir) => {
				await migrateManifest({ port: 5140 });
				const text = await Bun.file(join(dir, "package.json")).text();
				expect(text.endsWith("\n")).toBe(true);
				const meta = JSON.parse(text) as {
					dependencies: Record<string, string>;
				};
				// 初始 zzz 在最前，重排后 @koishi-ce/* 依字典序在前、zzz 殿后
				expect(Object.keys(meta.dependencies)).toEqual([
					"@koishi-ce/plugin-http",
					"@koishi-ce/plugin-proxy-agent",
					"@koishi-ce/plugin-server",
					"zzz",
				]);
			},
			{
				name: "test-app",
				dependencies: {
					zzz: "1",
					"@koishi-ce/plugin-http": "workspace:*",
					"@koishi-ce/plugin-proxy-agent": "workspace:*",
				},
			},
		);
	});

	it("顶层 http 插件的 proxyAgent 提取到 proxy-agent 插件", async () => {
		await withDir(
			async () => {
				// 迁移会改写 config 形状（增删嵌套键），按字典声明避免字面量类型锁死
				const config: Record<string, unknown> = {
					plugins: {
						http: { proxyAgent: "http://proxy:1", timeout: 3 },
						"proxy-agent": { keep: true },
					},
				};
				await migrateManifest(config);
				expect(config).toEqual({
					plugins: {
						http: { timeout: 3 },
						"proxy-agent": { keep: true, proxyAgent: "http://proxy:1" },
					},
				});
			},
			{
				name: "test-app",
				dependencies: Object.fromEntries(
					pluginDeps.map((name) => [name, "workspace:*"]),
				),
			},
		);
	});

	it("嵌套 group 内（含 ~ 前缀与 ident 形态）的 proxyAgent 也会被提取", async () => {
		await withDir(
			async () => {
				const config: Record<string, unknown> = {
					plugins: {
						"group:outer": {
							"~http:old": { proxyAgent: "nested", other: 1 },
						},
						"proxy-agent": {},
					},
				};
				await migrateManifest(config);
				expect(config).toEqual({
					plugins: {
						"group:outer": { "~http:old": { other: 1 } },
						"proxy-agent": { proxyAgent: "nested" },
					},
				});
			},
			{
				name: "test-app",
				dependencies: Object.fromEntries(
					pluginDeps.map((name) => [name, "workspace:*"]),
				),
			},
		);
	});

	it("proxy-agent 位于嵌套 group 内时写回其配置", async () => {
		await withDir(
			async () => {
				const config: Record<string, unknown> = {
					plugins: {
						"group:g": {
							http: { proxyAgent: "deep" },
							"proxy-agent": { exist: 1 },
						},
					},
				};
				await migrateManifest(config);
				expect(config).toEqual({
					plugins: {
						"group:g": {
							http: {},
							"proxy-agent": { exist: 1, proxyAgent: "deep" },
						},
					},
				});
			},
			{
				name: "test-app",
				dependencies: Object.fromEntries(
					pluginDeps.map((name) => [name, "workspace:*"]),
				),
			},
		);
	});

	it("group 配置为 null 时安全跳过，falsy proxyAgent 不触发写回", async () => {
		await withDir(
			async () => {
				const config: Record<string, unknown> = {
					plugins: {
						group: null,
						http: { proxyAgent: "" },
						"proxy-agent": {},
					},
				};
				await migrateManifest(config);
				expect(config).toEqual({
					plugins: {
						group: null,
						// 提取时已被移除，但空串不写回 proxy-agent
						http: {},
						"proxy-agent": {},
					},
				});
			},
			{
				name: "test-app",
				dependencies: Object.fromEntries(
					pluginDeps.map((name) => [name, "workspace:*"]),
				),
			},
		);
	});

	it("无变更时不回写 package.json（保留原始文件形态）", async () => {
		// 手工构造非规范形态（无尾换行、依赖乱序），未触发迁移则逐字节不变
		const raw =
			'{"name":"test-app","dependencies":{"@koishi-ce/plugin-http":"workspace:*","@koishi-ce/plugin-proxy-agent":"workspace:*","@koishi-ce/plugin-server":"workspace:*"}}';
		await withDir(
			async (dir) => {
				await migrateManifest({ plugins: { foo: {} } });
				expect(await Bun.file(join(dir, "package.json")).text()).toBe(raw);
			},
			JSON.parse(raw) as Record<string, unknown>,
		);
	});

	it("package.json 缺失时仅告警不抛错，config 不被修改", async () => {
		const dir = await fs.mkdtemp(join(tmpdir(), "koishi-loader-mig-"));
		try {
			process.chdir(dir);
			const config = { plugins: { foo: {} } };
			await expect(migrateManifest(config)).resolves.toBeUndefined();
			expect(config).toEqual({ plugins: { foo: {} } });
		} finally {
			process.chdir(rootDir);
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
