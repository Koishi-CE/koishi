#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * create-koishi-ce 的 CLI 可执行入口：shebang 由 rolldown 原样保留到
 * lib/bin.mjs，package.json 的 bin 字段指向它（范式同 @koishi-ce/scripts）。
 */
import { start } from "./index.ts";

start().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
