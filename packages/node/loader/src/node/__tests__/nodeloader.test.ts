/**
 * NodeLoader 装配链测试：init 定位与 env 文件路径、readConfig 的 env
 * 注入/撤销与迁移回写、migrateEntry 数据库默认值、import 的解析缓存与
 * 失败告警、fullReload 的共享数据回传（mock process.send / process.exit）。
 */
import { afterEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { revertEnv } from "../env.ts";
import NodeLoader, { Loader } from "../index.ts";

const rootDir = process.cwd();

/** 建立临时目录并在用后清理（清理前先离开该目录，避免 win32 句柄占用） */
async function withDir(fn: (dir: string) => Promise<void>) {
	const dir = await fs.mkdtemp(join(tmpdir(), "koishi-loader-node-"));
	try {
		await fn(dir);
	} finally {
		if (process.cwd() === dir) process.chdir(rootDir);
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("NodeLoader.init", () => {
	it("定位默认配置文件并生成 env 文件路径列表", async () => {
		await withDir(async (dir) => {
			await Bun.write(join(dir, "koishi.yml"), "plugins: {}");
			const loader = new NodeLoader();
			loader.baseDir = dir;
			await loader.init();
			expect(loader.baseDir).toBe(dir);
			expect(loader.filename).toBe(join(dir, "koishi.yml"));
			expect(loader.mime).toBe("application/yaml");
			expect(loader.writable).toBe(true);
			expect(loader.envFiles).toEqual([
				join(dir, ".env"),
				join(dir, ".env.local"),
			]);
		});
	});

	it("显式传入配置文件时以其所在目录为 baseDir", async () => {
		await withDir(async (dir) => {
			await fs.mkdir(join(dir, "instance"));
			await Bun.write(join(dir, "instance", "koishi.config.json"), "{}");
			const loader = new NodeLoader();
			loader.baseDir = dir;
			await loader.init("instance");
			expect(loader.filename).toBe(join(dir, "instance", "koishi.config.json"));
			expect(loader.baseDir).toBe(join(dir, "instance"));
			expect(loader.mime).toBe("application/json");
		});
	});
});

describe("NodeLoader.readConfig", () => {
	afterEach(() => {
		process.chdir(rootDir);
	});

	it("注入 env 文件、执行迁移并回写规范化配置", async () => {
		await withDir(async (dir) => {
			await Bun.write(
				join(dir, "koishi.yml"),
				"name: ${{ env.NLO_TEST_NAME }}\nplugins: {}\n",
			);
			await Bun.write(
				join(dir, ".env"),
				"NLO_TEST_NAME=from-dot-env\nNLO_TEST_SHARED=1\n",
			);
			await Bun.write(join(dir, ".env.local"), "NLO_TEST_NAME=from-local\n");
			// readConfig(initial) 会经 migrate() 迁移 package.json 依赖
			await Bun.write(join(dir, "package.json"), '{"name":"test-app"}');
			process.chdir(dir);

			const loader = new NodeLoader();
			loader.baseDir = dir;
			await loader.init();
			const config = await loader.readConfig(true);

			// .env.local 覆盖 .env；插值生成最终配置
			expect(config.name).toBe("from-local");
			expect(process.env["NLO_TEST_NAME"]).toBe("from-local");
			expect(process.env["NLO_TEST_SHARED"]).toBe("1");

			// 回写的是插值前的原始配置（模板原样保留；YAML 序列化可能带引号）
			const text = await Bun.file(join(dir, "koishi.yml")).text();
			expect(text).toContain("${{ env.NLO_TEST_NAME }}");
			// initial 迁移在配置中补挂了 proxy-agent / http 插件
			expect(text).toContain("proxy-agent");

			// 二次读取：撤销上一轮注入后重新注入；删除 .env.local 后回落 .env 值
			await fs.rm(join(dir, ".env.local"));
			await loader.readConfig();
			expect(process.env["NLO_TEST_NAME"]).toBe("from-dot-env");

			// 清理注入的环境变量
			revertEnv(loader.localKeys);
			expect(process.env["NLO_TEST_NAME"]).toBeUndefined();
			expect(process.env["NLO_TEST_SHARED"]).toBeUndefined();
		});
	});
});

describe("NodeLoader.migrateEntry", () => {
	it("数据库插件补默认数据库名 / 路径", () => {
		const loader = new NodeLoader();
		expect(loader.migrateEntry("database-mysql", undefined)).toEqual({
			database: "koishi",
		});
		expect(loader.migrateEntry("database-mongo", {})).toEqual({
			database: "koishi",
		});
		// 已有配置不覆盖
		expect(
			loader.migrateEntry("database-postgres", { database: "custom" }),
		).toEqual({ database: "custom" });
		expect(loader.migrateEntry("database-sqlite", undefined)).toEqual({
			path: "data/koishi.db",
		});
	});

	it("其余名字交给基类处理（非 group 返回 undefined）", () => {
		const loader = new NodeLoader();
		expect(loader.migrateEntry("other", undefined)).toBeUndefined();
	});

	it("group 键经基类重建并补齐随机标识", () => {
		const loader = new NodeLoader();
		const result = loader.migrateEntry("group", {
			$if: true,
			"a:x": { foo: 1 },
			b: {},
		});
		// $ 前缀原样保留；已有标识保持；缺标识的键生成 name:ident 形态
		expect(result).toMatchObject({ $if: true, "a:x": { foo: 1 } });
		const keys = Object.keys(result ?? {});
		expect(keys[0]).toBe("$if");
		expect(keys[1]).toBe("a:x");
		expect(keys[2]).toMatch(/^b:[0-9a-z]{6}$/);
	});
});

describe("NodeLoader.import", () => {
	it("解析失败记录错误并返回 undefined", async () => {
		const loader = new NodeLoader();
		await expect(
			loader.import("definitely-not-exist-xyz"),
		).resolves.toBeUndefined();
	});

	it("相对路径加载本地模块并缓存解析结果", async () => {
		await withDir(async (dir) => {
			await Bun.write(
				join(dir, "plugin-a.js"),
				"module.exports = { tag: 'a' }",
			);
			const loader = new NodeLoader();
			loader.baseDir = dir;
			const mod = (await loader.import("./plugin-a.js")) as { tag: string };
			expect(mod).toEqual({ tag: "a" });
			// 解析结果进入缓存（再次导入不再解析）
			expect(loader.cache["./plugin-a.js"]).toBeTruthy();
			expect(await loader.import("./plugin-a.js")).toBe(mod);
		});
	});

	it("Bun 的 require 可直接加载 ESM 产物", async () => {
		await withDir(async (dir) => {
			await Bun.write(join(dir, "plugin-b.mjs"), "export default { tag: 'b' }");
			const loader = new NodeLoader();
			loader.baseDir = dir;
			const mod = (await loader.import("./plugin-b.mjs")) as {
				default: { tag: string };
			};
			expect(mod.default).toEqual({ tag: "b" });
		});
	});
});

describe("NodeLoader.fullReload", () => {
	/** 进程 API 的可写视图（mock 期间替换、测毕恢复） */
	const proc = process as unknown as {
		send?: unknown;
		exit?: unknown;
	};
	const originalSend = proc.send;
	const originalExit = proc.exit;
	/** 恢复被 mock 的进程 API */
	function restore() {
		if (originalSend === undefined) delete proc.send;
		else proc.send = originalSend;
		proc.exit = originalExit;
	}

	it("向父进程回传共享数据并按传入退出码退出", () => {
		const loader = new NodeLoader();
		loader.envData = { startTime: 123, message: null };
		const sends: unknown[] = [];
		const exits: number[] = [];
		try {
			proc.send = (message: unknown, callback: (err: Error | null) => void) => {
				sends.push(message);
				callback(null);
			};
			proc.exit = (code?: number) => {
				exits.push(code ?? -1);
			};
			loader.fullReload(99);
			expect(sends).toEqual([
				{
					type: "shared",
					body: JSON.stringify({ startTime: 123, message: null }),
				},
			]);
			expect(exits).toEqual([99]);
		} finally {
			restore();
		}
	});

	it("回传失败时记录错误，仍以默认退出码退出", () => {
		const loader = new NodeLoader();
		const exits: number[] = [];
		try {
			proc.send = (
				_message: unknown,
				callback: (err: Error | null) => void,
			) => {
				callback(new Error("channel closed"));
			};
			proc.exit = (code?: number) => {
				exits.push(code ?? -1);
			};
			loader.fullReload();
			// 默认退出码为 Loader.exitCode（51）
			expect(exits).toEqual([Loader.exitCode]);
		} finally {
			restore();
		}
	});
});

describe("NodeLoader 静态装配", () => {
	it("Bun require 登记的脚本扩展名并入受支持集合", () => {
		// 模块加载期已执行合并：Loader.extensions 应包含 require.extensions 的键
		for (const key in require.extensions) {
			expect(Loader.extensions.has(key)).toBe(true);
		}
		expect(Loader.extensions.has(".yaml")).toBe(true);
	});
});
