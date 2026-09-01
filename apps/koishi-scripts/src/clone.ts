// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * `koishi-scripts clone` 子命令：把已有插件仓库克隆到宿主工作区的
 * external/ 目录下并安装依赖（bun install），便于本地联动开发第三方插件。
 * 旧版的 yakumo prepare 环节已随 yakumo 范式一并移除——Bun 运行时原生
 * 执行 TS，克隆下来的源码型插件可直接被宿主加载调试。
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { cwd } from "./index.ts";

/** 交互式读取一行输入（Ctrl+C 退出由 readline 自行处理）。 */
async function ask(message: string): Promise<string> {
	if (!process.stdin.isTTY) {
		throw new Error("非交互环境下必须提供全部位置参数：clone <repo> [name]");
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return (await rl.question(message)).trim();
	} finally {
		rl.close();
	}
}

/**
 * clone 主流程：规范化仓库地址（owner/repo → https://github.com/owner/repo.git，
 * 目标目录名默认取 repo 名去掉 koishi-plugin- 前缀）→ git clone 到 external/ →
 * bun install。返回退出码（0 成功）。
 */
export default async function runClone(
	args: readonly string[],
): Promise<number> {
	const positional = args.filter((arg) => !arg.startsWith("-"));
	let repo = positional[0] ?? "";
	let name = positional[1] ?? "";
	if (repo === "") {
		repo = await ask("📦 仓库地址（owner/repo 或完整 URL）：");
	}
	// 匹配 owner/repo、完整 URL 等写法，统一补全为 .git 结尾的 HTTPS 地址
	const cap = /^(?:https:\/\/github\.com\/)?([\w-]+)\/([\w-]+)(?:\.git)?$/.exec(
		repo,
	);
	if (cap?.[1] !== undefined && cap[2] !== undefined) {
		name ||= cap[2].replace("koishi-plugin-", "");
		if (!repo.startsWith("https:")) {
			repo = `https://github.com/${repo}`;
		}
		if (!repo.endsWith(".git")) {
			repo = `${repo}.git`;
		}
	}
	if (name === "") {
		name = await ask("📁 目标目录名：");
	}

	const clone = spawnSync("git", ["clone", repo, join("external", name)], {
		stdio: "inherit",
	});
	if (clone.status !== 0) {
		console.log(`[clone] ❌ git clone 失败（退出码 ${clone.status ?? 1}）`);
		return clone.status ?? 1;
	}
	console.log(`[clone] ✅ 已克隆到 external/${name}，安装依赖（bun install）…`);
	const install = spawnSync("bun", ["install"], { cwd, stdio: "inherit" });
	if (install.status !== 0) {
		console.log(`[clone] ❌ bun install 失败（退出码 ${install.status ?? 1}）`);
		return install.status ?? 1;
	}
	console.log(
		`[clone] 🎉 完成：external/${name} 已就绪，可在宿主 koishi.yml 中启用调试`,
	);
	return 0;
}
