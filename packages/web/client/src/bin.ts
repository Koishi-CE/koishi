#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * `koishi-console` CLI 入口（构建产物 lib/bin.mjs 由 package.json 的
 * bin 字段指向，仓库内亦可用 Bun 直接运行本源文件）。
 *
 * 极简手写 CLI（不引 CLI 框架）：仅 `build [root]` 一个子命令 +
 * help/version。带 root（或 cwd 本身是含 client/ 的插件目录）时构建
 * 该 webui 插件的前端；否则执行宿主控制台前端总装（scripts/client.ts，
 * 产物写入 plugins/webui/console/dist）。
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import pkg from "../package.json" with { type: "json" };

const { version } = pkg;

import { build } from "./index.ts";

const help = `koishi-console/${version}

Usage:
  $ koishi-console <command> [options]

Commands:
  build [root]  build the frontend of given webui plugin, or the host
                console when omitted (or when cwd has no client/ dir)

Options:
  -h, --help     Display this message
  -v, --version  Display version number`;

async function main() {
	const [command, ...args] = process.argv.slice(2);
	if (command === undefined || command === "-h" || command === "--help") {
		console.log(help);
		return;
	}
	if (command === "-v" || command === "--version") {
		console.log(`koishi-console/${version}`);
		return;
	}
	if (command === "build") {
		// root 缺省时：cwd 是插件目录则构建它，否则视为宿主总装
		const root = args.find((arg) => !arg.startsWith("-"));
		const target = root ?? (existsSync("client") ? "." : undefined);
		if (target !== undefined) {
			await build(resolve(process.cwd(), target));
			return;
		}
		const host = await import("../scripts/client.ts");
		await host.default();
		return;
	}
	console.error(`Unknown command ${JSON.stringify(command)}.`);
	console.log(help);
	process.exitCode = 1;
}

await main();
