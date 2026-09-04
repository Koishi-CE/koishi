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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import {
	mkdir,
	readFile,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Console, type Entry } from "@koishi-ce/console";
import { App, type Plugin } from "@koishi-ce/koishi";
import explorer, {
	type Entry as TreeEntry,
} from "./index.ts";

/** 控制台服务桩：仅实现入口登记所需的最小面。 */
class FakeConsole extends Console {
	protected resolveEntry(
		_files: Entry.Files,
		_key: string,
	): string[] {
		return [];
	}
}

/** 在系统临时目录构造文件管理场景（含被忽略的隐藏文件与 node_modules）。 */
async function createScenario() {
	const root = mkdtempSync(
		join(tmpdir(), "explorer-test-"),
	);
	await writeFile(
		join(root, "b.txt"),
		"hello world",
		"utf8",
	);
	// PNG 魔数 + IHDR chunk 头（file-type 依此识别 MIME）
	await writeFile(
		join(root, "a.png"),
		Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
			0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
			0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00,
			0x00, 0x00,
		]),
	);
	await mkdir(join(root, "sub"));
	await writeFile(
		join(root, "sub", "c.txt"),
		"nested",
		"utf8",
	);
	await mkdir(join(root, "node_modules"));
	await writeFile(
		join(root, "node_modules", "x.txt"),
		"ignored",
	);
	await writeFile(join(root, ".hidden"), "ignored");
	// win32 无特权环境下用 junction 目录链接充当符号链接
	await symlink(
		join(root, "sub"),
		join(root, "link"),
		"junction",
	);
	return root;
}

const root = await createScenario();

const app = new App();

app.plugin(
	FakeConsole as unknown as Plugin.Constructor<App>,
);
app.plugin(explorer, { root });

/** 以假客户端身份调用指定 RPC 监听器。 */
async function call<K extends keyof Console["listeners"]>(
	event: K,
	...args: unknown[]
) {
	const listener = app.console.listeners[event];
	if (!listener)
		throw new Error(`listener ${String(event)} not found`);
	return listener.callback.call(
		{} as never,
		...(args as never[]),
	);
}

const service = () => app.get("console.services.explorer");

beforeAll(() => app.start());

afterAll(async () => {
	await app.stop();
	rmSync(root, { recursive: true, force: true });
});

describe("explorer 文件管理服务", () => {
	it("文件树遍历：目录优先、按名排序、忽略隐藏与 node_modules", async () => {
		const entries = (await service()?.get()) as TreeEntry[];
		const names = entries.map((entry) => entry.name);
		// 目录排最前，其余按字母序；ignored 项不出现
		expect(names).toEqual([
			"sub",
			"a.png",
			"b.txt",
			"link",
		]);
		const sub = entries[0];
		expect(sub?.type).toBe("directory");
		expect(
			sub?.children?.map((child) => child.name),
		).toEqual(["c.txt"]);
		// junction 链接识别为符号链接并给出目标
		const link = entries[3];
		expect(link?.type).toBe("symlink");
		expect(link?.target).toContain("sub");
	});

	it("read 返回文本文件的 base64 与编码探测", async () => {
		const file = (await call("explorer/read", "b.txt")) as {
			base64: string;
			encoding?: string;
			mime?: string;
		};
		expect(
			Buffer.from(file.base64, "base64").toString("utf8"),
		).toBe("hello world");
		expect(file.encoding).toBeTruthy();
		// 文本文件不携带 mime
		expect(file.mime).toBeUndefined();
	});

	it("read 返回二进制文件的 MIME 探测", async () => {
		const file = (await call("explorer/read", "a.png")) as {
			base64: string;
			mime?: string;
		};
		expect(file.mime).toBe("image/png");
	});

	it("write 支持文本与 base64 二进制写入", async () => {
		await call("explorer/write", "sub/new.txt", "新内容");
		expect(
			await readFile(join(root, "sub", "new.txt"), "utf8"),
		).toBe("新内容");

		const buffer = Buffer.from([1, 2, 3, 4]);
		await call(
			"explorer/write",
			"sub/new.bin",
			buffer.toString("base64"),
			true,
		);
		expect(
			await readFile(join(root, "sub", "new.bin")),
		).toEqual(buffer);
	});

	it("mkdir / rename / remove 执行实际文件操作", async () => {
		await call("explorer/mkdir", "made");
		expect(existsSync(join(root, "made"))).toBe(true);

		await call("explorer/rename", "made", "renamed");
		expect(existsSync(join(root, "renamed"))).toBe(true);

		await call("explorer/remove", "renamed");
		expect(existsSync(join(root, "renamed"))).toBe(false);
	});

	it("explorer/refresh 与 get 的缓存复用语义", async () => {
		const svc = service();
		// 非强制调用复用进行中的遍历任务（task 字段不更换）
		await svc?.get();
		const before = svc?.task;
		await svc?.get();
		expect(svc?.task).toBe(before);
		// 文件变动后强制刷新得到新树
		await writeFile(join(root, "z.txt"), "tail");
		const fresh = (await svc?.get(true)) as TreeEntry[];
		expect(fresh.map((entry) => entry.name)).toContain(
			"z.txt",
		);
	});

	it("read 不存在的文件时抛错", async () => {
		expect(
			call("explorer/read", "not-exist.txt"),
		).rejects.toThrow();
	});
});
