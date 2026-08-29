import { defineConfig } from "tsdown";

/**
 * 包级配置只补差异，其余沿用根 tsdown 配置（workspace 模式自动合并）：
 * 补 bin 入口，产物 lib/bin.mjs —— 首行 shebang（#!/usr/bin/env bun）由
 * rolldown 原样保留，package.json 的 bin 字段指向它（先例：packages/web/client）。
 */
export default defineConfig({
	entry: ["src/index.ts", "src/bin.ts"],
});
