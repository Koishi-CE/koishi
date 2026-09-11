// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, describe, expect, it } from "bun:test";
/**
 * @parcel/watcher 原生绑定冒烟测试：hmr 的文件监听建立在
 * 「Bun 运行时下原生订阅可用、ignored 规则在原生层生效（被忽略
 * 目录内的写入不产生事件）、递归监听与退订正常」这些前提上，
 * 此处逐一钉死（win32 下事件有数十毫秒延迟，断言前轮询等待）。
 */
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import watcher from "@parcel/watcher";
import { isInNodeModules } from "./index.ts";

describe("isInNodeModules 路径分隔符归一", () => {
	// upstream: koishijs/koishi#1232——win32 的 require.cache 键
	// 为反斜杠路径，字面量 includes("/node_modules/") 从不命中
	it("正斜杠与反斜杠路径形态均正确识别", () => {
		expect(
			isInNodeModules("/proj/node_modules/foo/index.js"),
		).toBe(true);
		expect(
			isInNodeModules(
				"C:\\proj\\node_modules\\foo\\index.js",
			),
		).toBe(true);
		expect(
			isInNodeModules("/proj/plugins/my-plugin/index.ts"),
		).toBe(false);
		expect(
			isInNodeModules(
				"C:\\proj\\plugins\\my-plugin\\index.ts",
			),
		).toBe(false);
	});
});

const dir = mkdtempSync(join(tmpdir(), "hmr-watch-"));
const probe = join(dir, "probe.txt");

afterAll(() =>
	rmSync(dir, { recursive: true, force: true }),
);

/** 轮询等待条件成立，超时返回 false（文件事件有延迟，不能即时断言） */
async function waitFor(cond: () => boolean, ms = 3000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (cond()) return true;
		await new Promise((r) => setTimeout(r, 20));
	}
	return cond();
}

/**
 * 反复写入 target 直到监听回调收到该路径的事件。
 *
 * Linux 的 inotify 按目录建 watch（win32 的递归订阅无此语义）：mkdir
 * 后立刻写入可能落在 watch 建立之前而丢事件，一次性写入在 CI 上偶发
 * 失败，重复写入（内容变化即 update 事件）可跨过这段就绪窗口。
 */
async function waitForWrite(
	target: string,
	seen: { type: string; path: string }[],
	ms = 5000,
): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		writeFileSync(target, `${Date.now()}`);
		await new Promise((r) => setTimeout(r, 100));
		if (seen.some((e) => resolve(e.path) === target))
			return true;
	}
	return false;
}

describe("@parcel/watcher 原生绑定", () => {
	it("递归监听产生事件且 ignored 在原生层生效", async () => {
		const seen: { type: string; path: string }[] = [];
		const sub = await watcher.subscribe(
			dir,
			(err, events) => {
				expect(err).toBeNull();
				seen.push(...events);
			},
			{ ignore: ["**/node_modules/**"] },
		);

		// 原生订阅建立需要一小段时间，立刻写入可能丢失首个事件，
		// 先让 watch 就绪再触发（Linux inotify 路径上尤为明显）
		await new Promise((r) => setTimeout(r, 300));

		// 已监听目录内的文件写入产生 create/update 事件（绝对路径）
		writeFileSync(probe, "v1");
		expect(
			await waitFor(() =>
				seen.some(
					(e) =>
						e.type === "create" &&
						resolve(e.path) === probe,
				),
			),
		).toBe(true);
		writeFileSync(probe, "v2");
		expect(
			await waitFor(() =>
				seen.some(
					(e) =>
						e.type === "update" &&
						resolve(e.path) === probe,
				),
			),
		).toBe(true);

		// 子目录内的写入递归可见（inotify 需为新目录补建 watch，
		// 一次性写入可能丢事件，交给重复写入的等待）
		mkdirSync(join(dir, "src"), { recursive: true });
		const nested = join(dir, "src/a.ts");
		expect(await waitForWrite(nested, seen)).toBe(true);

		// 被忽略目录（node_modules）内的写入不产生任何事件
		mkdirSync(join(dir, "node_modules/pkg"), {
			recursive: true,
		});
		writeFileSync(join(dir, "node_modules/pkg/x.js"), "1");
		await new Promise((r) => setTimeout(r, 300));
		expect(
			seen.some((e) => e.path.includes("node_modules")),
		).toBe(false);

		await sub.unsubscribe();
	}, 20000);
});
