// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { type TarEntry, tarPack, untar } from "../tar.ts";

/**
 * src/tar.ts（untar / tarPack）的单元测试。
 *
 * tarPack 产出与真实 npm tarball 同构的 .tgz（ustar + 超长名 pax 兜底 +
 * gzip），untar 全链路真实执行；另手工构造截断归档与链接条目覆盖
 * 防御分支。Windows 无开发者模式时 symlink 创建会失败，相关用例
 * 以能力探测跳过。
 */

const workspaceRoot = mkdtempSync(join(tmpdir(), "ckc-tar-"));
const encoder = new TextEncoder();

afterAll(() => {
	rmSync(workspaceRoot, { recursive: true, force: true });
});

/** 打包并解包到独立子目录，返回解包目录绝对路径 */
async function unpack(
	entries: readonly TarEntry[],
	strip = 0,
	name = "out",
): Promise<string> {
	const target = join(workspaceRoot, name);
	await untar(new Blob([await tarPack(entries)]).stream(), target, { strip });
	return target;
}

/** gzip 字节解压回原始字节（供截断用例构造畸形归档） */
function gunzip(bytes: Uint8Array): Uint8Array {
	return gunzipSync(bytes);
}

describe("untar 基本解包", () => {
	it("目录条目自动补建、内容正确、父目录递推创建", async () => {
		const content = encoder.encode("console.log('tpl');\n");
		const target = await unpack([
			{ path: "package/package.json", data: encoder.encode('{"a":1}') },
			{ path: "package/src/nested/index.js", data: content },
		]);
		// strip 0：保留 package/ 前缀
		expect(readFileSync(join(target, "package/package.json"), "utf8")).toBe(
			'{"a":1}',
		);
		expect(
			readFileSync(join(target, "package/src/nested/index.js"), "utf8"),
		).toBe("console.log('tpl');\n");
	});

	it("strip 去掉前导目录段（npm 包根为 1）", async () => {
		const target = await unpack(
			[{ path: "package/index.js", data: encoder.encode("x") }],
			1,
			"stripped",
		);
		expect(existsSync(join(target, "package"))).toBe(false);
		expect(readFileSync(join(target, "index.js"), "utf8")).toBe("x");
	});

	it("strip 大于目录深度：条目安全跳过，不抛错", async () => {
		const target = await unpack(
			[{ path: "package/index.js", data: encoder.encode("x") }],
			2,
			"overstrip",
		);
		expect(existsSync(join(target, "index.js"))).toBe(false);
	});

	it("空归档（仅收尾零块）：正常结束", async () => {
		const target = await unpack([], 0, "empty");
		expect(existsSync(target)).toBe(true);
	});

	it("超长文件名（>100 字节）经 pax 扩展头正确落盘", async () => {
		const name = `package/${"deep".repeat(30)}.txt`; // 124 字符 > ustar 上限
		const target = await unpack(
			[{ path: name, data: encoder.encode("pax") }],
			1,
			"pax-name",
		);
		const relative = name.slice("package/".length);
		expect(readFileSync(join(target, relative), "utf8")).toBe("pax");
	});
});

describe("untar 安全防护", () => {
	it("绝对路径与 .. 段条目被丢弃，不落盘、不逃逸解包目录", async () => {
		const good = join(workspaceRoot, "guard-good");
		await untar(
			new Blob([
				await tarPack([
					{ path: "pkg/ok.txt", data: encoder.encode("ok") },
					{ path: "../evil.txt", data: encoder.encode("evil") },
					{ path: "/abs.txt", data: encoder.encode("evil") },
					{ path: "pkg/../../evil2.txt", data: encoder.encode("evil") },
				]),
			]).stream(),
			good,
		);
		expect(readFileSync(join(good, "pkg/ok.txt"), "utf8")).toBe("ok");
		// 三个恶意条目既不落盘到解包目录，也不逃逸到上层临时目录
		expect(existsSync(join(good, "evil.txt"))).toBe(false);
		expect(existsSync(join(good, "abs.txt"))).toBe(false);
		expect(existsSync(join(good, "evil2.txt"))).toBe(false);
		expect(existsSync(join(workspaceRoot, "evil.txt"))).toBe(false);
		expect(existsSync(join(workspaceRoot, "evil2.txt"))).toBe(false);
	});

	it("归档截断（文件内容不足声明大小）：抛出明确错误", async () => {
		const gzip = await tarPack([
			{ path: "package/big.txt", data: new Uint8Array(65536).fill(0x41) },
		]);
		const raw = gunzip(gzip);
		// 截断在文件内容中部后重新压缩：gzip 本身完整，但 tar 数据不完整
		const bytes = gzipSync(raw.subarray(0, 512 + 512 + 128));
		const target = join(workspaceRoot, "truncated");
		await expect(untar(new Blob([bytes]).stream(), target)).rejects.toThrow(
			"tar 归档意外截断",
		);
	});
});

describe("untar 链接条目", () => {
	// 链接源/目标的包内全路径（strip:1 时与文件落盘路径对齐）
	const base: TarEntry[] = [
		{ path: "package/lib.txt", data: encoder.encode("payload") },
	];

	it("硬链接：内容与源文件一致", async () => {
		const target = await unpack(
			[
				...base,
				{ path: "package/hard.txt", type: "hardlink", link: "package/lib.txt" },
			],
			1,
			"hardlink",
		);
		expect(readFileSync(join(target, "hard.txt"), "utf8")).toBe("payload");
	});

	// Windows 无开发者模式时 symlink 需要提权，按能力跳过
	const canSymlink = (() => {
		try {
			symlinkSync("probe", join(workspaceRoot, "probe-link"));
			rmSync(join(workspaceRoot, "probe-link"), { force: true });
			return true;
		} catch {
			return false;
		}
	})();

	it.skipIf(!canSymlink)("符号链接：目标原样写入", async () => {
		const target = await unpack(
			[...base, { path: "package/alias", type: "symlink", link: "lib.txt" }],
			1,
			"symlink",
		);
		const stat = lstatSync(join(target, "alias"));
		expect(stat.isSymbolicLink()).toBe(true);
		expect(readlinkSync(join(target, "alias"))).toBe("lib.txt");
	});

	it.skipIf(!canSymlink)(
		"超长链接目标（>100 字节）经 pax linkpath 覆盖",
		async () => {
			const link = "t".repeat(110);
			const target = await unpack(
				[...base, { path: "package/alias", type: "symlink", link }],
				1,
				"pax-link",
			);
			expect(readlinkSync(join(target, "alias"))).toBe(link);
		},
	);
});
