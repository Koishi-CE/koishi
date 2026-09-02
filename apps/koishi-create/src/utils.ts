// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 平台小工具（无业务状态、不触碰 CLI 全局状态的零散函数）：包管理器
 * 探测（detectAgent）、git 可用性与配置读取（supports / gitConfig）、
 * 目录清空（emptyDir）。分别被 index.ts 主流程的 install / initGit /
 * prepare 步骤调用，也是除 manifest.ts / registry.ts 之外可脱离交互
 * 直接单测的函数集合。
 */
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * 探测后续安装/启动使用的包管理器（Bun-first）：yarn / pnpm 用户跟随其
 * 生态习惯；其余场景（npm、bun 及探测不到 user-agent）一律走 bun——
 * 本 CLI 自身以 bun 为运行时（bin shebang），能执行即已具备 bun 环境。
 */
export function detectAgent(): string {
	const ua = process.env["npm_config_user_agent"] ?? "";
	if (ua.startsWith("yarn")) return "yarn";
	if (ua.startsWith("pnpm")) return "pnpm";
	return "bun";
}

/** 静默执行命令探测其是否可用（如 git --version），失败即视为不可用 */
export function supports(command: readonly string[]) {
	return (
		spawnSync(command[0] ?? "", command.slice(1), { stdio: "ignore" })
			.status === 0
	);
}

/** 读 git 全局配置单项（读不到 → 空串） */
export function gitConfig(key: string): string {
	const res = spawnSync("git", ["config", "--get", key], { encoding: "utf8" });
	return res.status === 0 ? (res.stdout?.trim() ?? "") : "";
}

/** 递归清空目录内容（目录本身保留）。 */
export function emptyDir(root: string) {
	for (const file of readdirSync(root)) {
		rmSync(join(root, file), { recursive: true, force: true });
	}
}
