/**
 * 插件名解析测试：候选说明符生成规则（对齐历史 ns-require 语义）
 * 与 Bun.resolveSync 实际解析。
 */
import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pluginCandidates, resolvePlugin } from "../resolve";

describe("pluginCandidates", () => {
	it("裸短名：本组织优先，其次上游官方，最后社区前缀", () => {
		expect(pluginCandidates("foo", "/base")).toEqual([
			"@koishi-ce/plugin-foo",
			"@koishijs/plugin-foo",
			"koishi-plugin-foo",
		]);
	});

	it("已带社区前缀的完整包名直接采用", () => {
		expect(pluginCandidates("koishi-plugin-foo", "/base")).toEqual([
			"koishi-plugin-foo",
		]);
	});

	it("已带官方组织前缀的完整包名直接采用", () => {
		expect(pluginCandidates("@koishi-ce/plugin-foo", "/base")).toEqual([
			"@koishi-ce/plugin-foo",
		]);
	});

	it("scoped 名为内层补全社区前缀", () => {
		expect(pluginCandidates("@scope/foo", "/base")).toEqual([
			"@scope/koishi-plugin-foo",
		]);
		expect(pluginCandidates("@scope/koishi-plugin-foo", "/base")).toEqual([
			"@scope/koishi-plugin-foo",
		]);
	});

	it("仅组织名（无内层）抛错", () => {
		expect(() => pluginCandidates("@broken", "/base")).toThrow(
			'cannot resolve plugin "@broken"',
		);
	});

	it("相对路径相对 baseDir 解析为绝对路径", () => {
		expect(pluginCandidates("./local", "/base/dir")).toEqual([
			resolve("/base/dir", "./local"),
		]);
	});

	it("绝对路径直接采用", () => {
		expect(pluginCandidates(resolve("/x/y"), "/base")).toEqual([
			resolve("/x/y"),
		]);
	});
});

describe("resolvePlugin", () => {
	it("从 baseDir 的 node_modules 解析社区包入口", async () => {
		const dir = await fs.mkdtemp(join(tmpdir(), "koishi-loader-res-"));
		try {
			await fs.mkdir(join(dir, "node_modules", "koishi-plugin-foo"), {
				recursive: true,
			});
			await Bun.write(
				join(dir, "node_modules", "koishi-plugin-foo", "package.json"),
				JSON.stringify({ name: "koishi-plugin-foo", main: "index.js" }),
			);
			await Bun.write(
				join(dir, "node_modules", "koishi-plugin-foo", "index.js"),
				"module.exports = {}",
			);
			const resolved = resolvePlugin("foo", dir);
			expect(resolved).toBe(
				join(dir, "node_modules", "koishi-plugin-foo", "index.js"),
			);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("全部候选失败时抛错", () => {
		expect(() => resolvePlugin("definitely-not-a-plugin", "/")).toThrow(
			'cannot resolve plugin "definitely-not-a-plugin"',
		);
	});
});
