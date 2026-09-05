// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/plugin-locales（控制台本地化文件管理）的行为测试。
 *
 * 覆盖：启动扫描各根目录的 yml 并注册 i18n（非 yml 跳过）、entry 文件的
 * 三种环境形态（默认 dev/prod、KOISHI_BASE、KOISHI_ENV=browser）、
 * l10n 编辑回写链路（含空根目录守卫）与 internal/i18n 变化后的防抖刷新。
 * 注意：同一应用重复插载本插件时后续 inject 回调不执行（cordis 行为），
 * 各环境形态以独立应用验证。
 */

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import {
	mkdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Client,
	Console,
	type Entry,
} from "@koishi-ce/console";
import {
	App,
	type Plugin,
	type Universal,
} from "@koishi-ce/koishi";
import * as locales from "@koishi-ce/plugin-locales";

/** 出站消息形状 */
interface SentMessage {
	type: string;
	body: { id?: number; key?: string; value?: unknown };
}

/** 内存 WebSocket 桩 */
class FakeSocket {
	sent: string[] = [];
	// message 与 close 的监听器统一为同构签名（never 载荷），保证集合存取类型一致
	private messageHandlers = new Set<
		(event: never) => void
	>();
	private closeHandlers = new Set<(event: never) => void>();

	send(data: string) {
		this.sent.push(data);
	}

	addEventListener(
		type: string,
		listener: (event: never) => void,
	) {
		if (type === "message")
			this.messageHandlers.add(listener);
		if (type === "close") this.closeHandlers.add(listener);
	}

	removeEventListener(
		type: string,
		listener: (event: never) => void,
	) {
		if (type === "message")
			this.messageHandlers.delete(listener);
		if (type === "close")
			this.closeHandlers.delete(listener);
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
			typeof files === "string" || Array.isArray(files)
				? files
				: files.prod;
		return [String(list), key];
	}

	acceptClient(
		socket: Universal.WebSocket,
		request: IncomingMessage,
	): Client {
		let accepted: Client | undefined;
		const dispose = this.ctx.on(
			"console/connection",
			(client) => {
				accepted = client;
			},
		);
		this.accept(socket, request);
		dispose();
		if (!accepted) throw new Error("client not accepted");
		return accepted;
	}
}

/** 建立带初始文件的临时根目录 */
async function makeRoot(
	name: string,
	files: Record<string, string>,
) {
	const dir = join(
		tmpdir(),
		`koishi-locales-${name}-${Date.now()}`,
	);
	await mkdir(dir, { recursive: true });
	for (const [filename, content] of Object.entries(files)) {
		await writeFile(join(dir, filename), content, "utf8");
	}
	return dir;
}

// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
const mountConsole = (target: App) =>
	target.plugin(
		TestConsole as unknown as Plugin.Constructor<App>,
	);

const app = new App();
mountConsole(app);

const root1 = await makeRoot("primary", {
	"zh-CN.yml": "greeting:\n  hello: 你好\n",
	"readme.txt": "ignored",
});
const root2 = await makeRoot("secondary", {
	"ja-JP.yml": "greeting:\n  hello: こんにちは\n",
});

const localesFork = app.plugin(locales, {
	root: [root1, root2],
});
let socket: FakeSocket;
let client: Client;

beforeAll(async () => {
	await app.start();
	socket = new FakeSocket();
	client = (app.console as TestConsole).acceptClient(
		socket.socket,
		fakeRequest(),
	);
	await tick();
});

afterAll(async () => {
	for (const entry of Object.values(
		(app.console as TestConsole).entries,
	)) {
		entry.dispose();
	}
	await tick();
	await app.stop();
});

/** i18n 存储视图（点路径扁平字典） */
function store() {
	return app.i18n._data as Record<
		string,
		Record<string, string>
	>;
}

describe("@koishi-ce/plugin-locales", () => {
	it("扫描根目录的 yml 注册 i18n（非 yml 文件跳过）", () => {
		expect(store()["$zh-CN"]?.["greeting.hello"]).toBe(
			"你好",
		);
		expect(store()["$ja-JP"]?.["greeting.hello"]).toBe(
			"こんにちは",
		);
	});

	it("entry 数据携带全部 i18n 存储，文件声明默认走 dev/prod 形态", async () => {
		const console_ = app.console as TestConsole;
		const data = (await console_.get(client)) as Record<
			string,
			{ data?: unknown }
		>;
		const entry = Object.values(console_.entries)[0];
		expect(entry).toBeTruthy();
		const entryData = data[entry?.id ?? ""];
		expect(entryData).toBeTruthy();
		const storeData = entryData?.data as Record<
			string,
			unknown
		>;
		expect(storeData["$zh-CN"]).toBeTruthy();

		const files = entry?.files as Entry.EntryOptions;
		// Windows 分隔符归一后断言（本用例的 prod 声明恒为字符串形态）
		expect(
			files.dev
				.replace(/\\/g, "/")
				.endsWith("client/index.ts"),
		).toBe(true);
		expect(
			(files.prod as string)
				.replace(/\\/g, "/")
				.endsWith("dist"),
		).toBe(true);
	});

	it("l10n 监听器更新 i18n 并写回第一个根目录", async () => {
		const listener = app.console.listeners["l10n"];
		expect(listener).toBeTruthy();
		await listener?.callback.call(
			client as never,
			{
				"zh-CN": { greeting: { hi: "嘿" } },
				// 空语言包直接跳过
				"fr-FR": null,
			} as never,
		);
		await tick();

		const content = await readFile(
			join(root1, "zh-CN.yml"),
			"utf8",
		);
		expect(content).toContain("hi: 嘿");
		expect(store()["$zh-CN"]?.["greeting.hi"]).toBe("嘿");
	});

	it("l10n 变化经防抖刷新 entry（entry-data 推送）", async () => {
		socket.sent.length = 0;
		app.i18n.define("$xx-XX", { a: "b" });
		// upstream: koishijs/koishi#1462——回推防抖对齐客户端的 1 秒
		await tick(1100);
		const messages = socket.sent
			.map((line) => JSON.parse(line) as SentMessage)
			.filter((msg) => msg.type === "entry-data");
		expect(messages.length).toBeGreaterThan(0);
	});

	it("插件卸载注销其入口", () => {
		const console_ = app.console as TestConsole;
		expect(Object.keys(console_.entries)).toHaveLength(1);
		localesFork.dispose();
		expect(Object.keys(console_.entries)).toHaveLength(0);
	});

	it("KOISHI_BASE 环境下 entry 指向在线加载地址", async () => {
		const base = process.env["KOISHI_BASE"];
		process.env["KOISHI_BASE"] = "/koishi-base";
		const localApp = new App();
		mountConsole(localApp);
		localApp.plugin(locales, { root: [root1] });
		await localApp.start();
		await tick();
		const entry = Object.values(
			(localApp.console as TestConsole).entries,
		)[0];
		expect(entry?.files).toEqual([
			"/koishi-base/dist/index.js",
			"/koishi-base/dist/style.css",
		]);
		await localApp.stop();
		// 原值缺失时删除键（赋 undefined 会变成字符串 "undefined"）
		if (base === undefined) {
			delete process.env["KOISHI_BASE"];
		} else {
			process.env["KOISHI_BASE"] = base;
		}
	});

	it("KOISHI_ENV=browser 环境下 entry 指向 client 源码", async () => {
		const env = process.env["KOISHI_ENV"];
		process.env["KOISHI_ENV"] = "browser";
		const localApp = new App();
		mountConsole(localApp);
		localApp.plugin(locales, { root: [root1] });
		await localApp.start();
		await tick();
		const entry = Object.values(
			(localApp.console as TestConsole).entries,
		)[0];
		// 插件自身 src/index.ts 的 URL 经 /client/index.ts 替换（测试文件位于 src/__tests__，需上溯两级）
		expect(entry?.files).toEqual([
			new URL("../../client/index.ts", import.meta.url)
				.href,
		]);
		await localApp.stop();
		if (env === undefined) {
			delete process.env["KOISHI_ENV"];
		} else {
			process.env["KOISHI_ENV"] = env;
		}
	});

	it("空根目录列表时跳过扫描且 l10n 监听器不落盘", async () => {
		const localApp = new App();
		mountConsole(localApp);
		localApp.plugin(locales, { root: [] });
		await localApp.start();
		await tick();
		const listener = localApp.console.listeners["l10n"];
		expect(listener).toBeTruthy();
		await listener?.callback.call(
			client as never,
			{
				"zz-ZZ": { k: "v" },
			} as never,
		);
		await tick();
		// primary 为空：直接跳过写盘与 i18n 更新
		expect(
			(localApp.i18n._data as Record<string, unknown>)[
				"$zz-ZZ"
			],
		).toBeUndefined();
		await localApp.stop();
	});
});
