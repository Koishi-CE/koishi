// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

// 沙盒目标目录的生命周期：身份标记读写、准入检查、模板基线落盘。

import {
	cpSync,
	existsSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	GENERATOR,
	MARKER,
	red,
	TEMPLATE_DIR,
	yellow,
} from "./config.ts";

/** 沙盒身份标记的读取（不存在或损坏一律视为非本工具目录）。 */
function readMarker(
	target: string,
): { mode: string } | undefined {
	try {
		const data = JSON.parse(
			readFileSync(join(target, MARKER), "utf8"),
		) as { generator?: string; mode?: string };
		if (
			data.generator !== GENERATOR &&
			data.generator !== "tooling/sandbox.ts"
		) {
			return undefined;
		}
		return { mode: data.mode ?? "link" };
	} catch {
		return undefined;
	}
}

/** 写身份标记（每次运行刷新，记录模式与时间）。 */
export function writeMarker(
	target: string,
	mode: "link" | "pack",
) {
	writeFileSync(
		join(target, MARKER),
		`${JSON.stringify(
			{
				generator: GENERATOR,
				mode,
				createdAt: new Date().toISOString(),
			},
			null,
			"\t",
		)}\n`,
	);
}

/** 目标目录的准入检查：不存在直接放行；存在则须为本工具目录（--force 重建）。 */
export function claimTarget(
	target: string,
	force: boolean,
): { fresh: boolean; marker?: { mode: string } } {
	if (!existsSync(target)) return { fresh: true };
	const marker = readMarker(target);
	if (!marker) {
		console.error(
			red(
				`拒绝处理：${target} 已存在且非本工具生成的沙盒（无 ${MARKER}）。`,
			),
		);
		console.error("请更换目录，或手动清理该目录后重试。");
		process.exit(1);
	}
	if (!force) return { fresh: false, marker };
	rmSync(target, { recursive: true, force: true });
	console.log(yellow(`已按 --force 清空重建：${target}`));
	return { fresh: true };
}

/** 复用脚手架内置模板生成基线文件：仅首次生成时落盘，不覆盖用户改动。 */
export function copyTemplateBaselines(target: string) {
	const copies: Array<[string, string]> = [
		["koishi.yml", "koishi.yml"],
		["env", ".env"],
		["gitignore", ".gitignore"],
	];
	for (const [from, to] of copies) {
		const dest = join(target, to);
		const src = join(TEMPLATE_DIR, from);
		if (!existsSync(src) || existsSync(dest)) continue;
		cpSync(src, dest);
	}
}
