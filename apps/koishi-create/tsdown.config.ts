// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { defineConfig } from "tsdown";

/**
 * create-koishi-ce 的包级构建配置（只补差异，其余沿用根 tsdown 配置的
 * workspace 模式自动合并）：补 bin 入口，产物 lib/bin.mjs —— 首行
 * shebang（#!/usr/bin/env bun）由 rolldown 原样保留，package.json 的
 * bin 字段指向它（范式同 apps/koishi-scripts）。
 */
export default defineConfig({
	entry: ["src/index.ts", "src/bin.ts"],
});
