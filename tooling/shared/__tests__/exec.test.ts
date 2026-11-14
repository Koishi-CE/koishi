// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { expect, test } from "bun:test";
import {
	capture,
	execCapture,
	runPool,
	wrapCmdShim,
} from "../exec.ts";

test("wrapCmdShim：非 win32 原样透传，参数数组不被展开", () => {
	if (process.platform === "win32") return;
	expect(wrapCmdShim("git", ["status"])).toEqual([
		"git",
		["status"],
	]);
});

test("execCapture：成功捕获 stdout，退出码与 ok 一致", () => {
	const res = execCapture(
		process.execPath,
		["-e", "console.log('hello')"],
		import.meta.dirname,
	);
	expect(res.ok).toBe(true);
	expect(res.status).toBe(0);
	expect(res.stdout.trim()).toBe("hello");
});

test("execCapture：非零退出 ok 为 false，stderr 保留", () => {
	const res = execCapture(
		process.execPath,
		["-e", "console.error('bad'); process.exit(3)"],
		import.meta.dirname,
	);
	expect(res.ok).toBe(false);
	expect(res.status).toBe(3);
	expect(res.stderr.trim()).toBe("bad");
});

test("capture：失败返回 null，成功返回去首尾空白的 stdout", () => {
	expect(
		capture(
			process.execPath,
			["-e", "process.exit(1)"],
			import.meta.dirname,
		),
	).toBeNull();
	expect(
		capture(
			process.execPath,
			["-e", "console.log('  spaced  ')"],
			import.meta.dirname,
		),
	).toBe("spaced");
});

test("execCapture：env 在继承环境之上合并覆盖", () => {
	const res = execCapture(
		process.execPath,
		[
			"-e",
			"console.log(process.env.FOO, process.env.PATH ? 'has-path' : 'no-path')",
		],
		import.meta.dirname,
		{ env: { FOO: "bar" } },
	);
	expect(res.stdout.trim()).toBe("bar has-path");
});

test("runPool：限流内全量完成，失败停止调度并抛出首个错误", async () => {
	const done: number[] = [];
	await runPool([1, 2, 3], 2, async (n) => {
		done.push(n);
	});
	expect(done.sort()).toEqual([1, 2, 3]);
	await expect(
		runPool([1, 2, 3], 1, async (n) => {
			if (n === 1) throw new Error("boom");
		}),
	).rejects.toThrow("boom");
});
