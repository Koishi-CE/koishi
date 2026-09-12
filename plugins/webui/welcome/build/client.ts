// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * welcome 前端的 vite 构建配置。
 *
 * 静音 rolldown 的 [EVAL] 单项检查：lottie-web 的 AE 表达式求值器上游实现
 * 即直接 eval（源码自带 eslint-disable-line no-eval），属第三方固有能力。
 * 本插件只加载打包内置的 splash.json，不接受外部动画文件，该 eval 分支
 * 对本插件的实际输入不可达，关闭检查仅为消除构建噪音。
 *
 * 动这块构建链前请先读 AGENTS.md 的"特殊构建 hack"条目。
 */
import { defineConfig } from "vite";

export default defineConfig({
	build: {
		rollupOptions: {
			checks: {
				eval: false,
			},
		},
	},
});
