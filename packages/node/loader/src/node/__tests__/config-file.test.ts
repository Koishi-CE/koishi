/**
 * 配置文件 I/O（Bun 实现）测试：定位优先级、解析与原子写回。
 */
import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateConfig, parseConfig, saveConfig } from "../config-file.ts";

/** 建立临时目录并在用后清理 */
async function withDir(fn: (dir: string) => Promise<void>) {
	const dir = await fs.mkdtemp(join(tmpdir(), "koishi-loader-cfg-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("locateConfig", () => {
	it("目录为空时抛错", async () => {
		await withDir(async (dir) => {
			expect(locateConfig(dir)).rejects.toThrow("config file not found");
		});
	});

	it("按 basename 与扩展名优先级查找默认配置", async () => {
		await withDir(async (dir) => {
			await Bun.write(join(dir, "koishi.yml"), "plugins: {}");
			await Bun.write(join(dir, "koishi.config.json"), "{}");
			// koishi.config.* 优先于 koishi.*；同类内 .json 优先于 .yaml/.yml
			const resolved = await locateConfig(dir);
			expect(resolved.filename).toBe(join(dir, "koishi.config.json"));
			expect(resolved.mime).toBe("application/json");
			expect(resolved.writable).toBe(true);
		});
	});

	it("显式指向文件时直接采用并校验扩展名", async () => {
		await withDir(async (dir) => {
			await Bun.write(join(dir, "custom.yml"), "plugins: {}");
			const resolved = await locateConfig(dir, "custom.yml");
			expect(resolved.filename).toBe(join(dir, "custom.yml"));
			expect(resolved.baseDir).toBe(dir);
			expect(resolved.mime).toBe("application/yaml");

			await Bun.write(join(dir, "bad.txt"), "x");
			expect(locateConfig(dir, "bad.txt")).rejects.toThrow(
				'extension ".txt" not supported',
			);
		});
	});

	it("显式指向目录时在该目录内查找", async () => {
		await withDir(async (dir) => {
			await fs.mkdir(join(dir, "instance"));
			await Bun.write(join(dir, "instance", "koishi.yml"), "plugins: {}");
			const resolved = await locateConfig(dir, "instance");
			expect(resolved.filename).toBe(join(dir, "instance", "koishi.yml"));
			expect(resolved.baseDir).toBe(join(dir, "instance"));
		});
	});

	it("只读配置文件标记为不可写", async () => {
		await withDir(async (dir) => {
			const filename = join(dir, "koishi.yml");
			await Bun.write(filename, "plugins: {}");
			await fs.chmod(filename, 0o444);
			try {
				const resolved = await locateConfig(dir);
				expect(resolved.writable).toBe(false);
			} finally {
				// Windows 下只读属性会阻止删除，先恢复再交给 withDir 清理
				await fs.chmod(filename, 0o666);
			}
		});
	});
});

describe("parseConfig", () => {
	it("yaml 文件走 Bun 原生解析", async () => {
		await withDir(async (dir) => {
			const filename = join(dir, "koishi.yml");
			await Bun.write(filename, "port: 5140\nplugins:\n  help: {}\n");
			expect(await parseConfig(filename, "application/yaml")).toEqual({
				port: 5140,
				plugins: { help: {} },
			});
		});
	});

	it("json 文件按文本解析", async () => {
		await withDir(async (dir) => {
			const filename = join(dir, "koishi.json");
			await Bun.write(filename, '{"port": 5140}');
			expect(await parseConfig(filename, "application/json")).toEqual({
				port: 5140,
			});
		});
	});

	it("其余扩展名按模块加载（Bun 的 require 可加载 ESM）", async () => {
		await withDir(async (dir) => {
			const filename = join(dir, "koishi.config.mjs");
			await Bun.write(filename, "export default { port: 5140, plugins: {} }");
			expect(await parseConfig(filename, undefined)).toEqual({
				port: 5140,
				plugins: {},
			});
		});
	});

	it("无 default 导出的模块以模块本身为配置（CJS）", async () => {
		await withDir(async (dir) => {
			const filename = join(dir, "koishi.config.cjs");
			await Bun.write(filename, "module.exports = { port: 5140 }");
			expect(await parseConfig(filename, undefined)).toEqual({ port: 5140 });
		});
	});
});

describe("saveConfig", () => {
	it("yaml 往返一致且不留临时文件", async () => {
		await withDir(async (dir) => {
			const filename = join(dir, "koishi.yml");
			const config = { port: 5140, plugins: { help: {} } };
			await saveConfig(filename, config, "application/yaml");
			// 块级样式输出（与历史 js-yaml 产物形态一致）
			expect(await Bun.file(filename).text()).toContain("port: 5140");
			expect(await parseConfig(filename, "application/yaml")).toEqual(config);
			// 原子写回不留 .tmp 残留
			expect(await fs.readdir(dir)).toEqual(["koishi.yml"]);
		});
	});

	it("json 往返一致", async () => {
		await withDir(async (dir) => {
			const filename = join(dir, "koishi.config.json");
			const config = { port: 5140 };
			await saveConfig(filename, config, "application/json");
			expect(await parseConfig(filename, "application/json")).toEqual(config);
		});
	});

	it("不支持的 mime 抛错", async () => {
		await expect(saveConfig("whatever", {}, "text/plain")).rejects.toThrow(
			"unsupported config mime: text/plain",
		);
	});
});
