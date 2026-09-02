// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 安装子进程的创建封装（原依赖 execa）。
 *
 * execa 本质是 node:child_process 的事件流封装，本仓只用到其
 * spawn + exit/error 事件 + stdout/stderr 流读取的子集，直接用
 * node:child_process 等价实现即可，Bun 运行时完全兼容。刻意不用
 * Bun.spawn 的捕获管道：win32 下其读端存在 EOF 竞态（见
 * tooling/release/proc.ts 注释），而单进程安装场景 child_process
 * 无此问题。子进程以 process.execPath 启动——宿主必为 Bun 运行时，
 * 直接复用当前可执行文件，不依赖 PATH 中的 bun。
 *
 * 独立成模块是为了让测试能以 mock.module 按相对路径精确拦截，
 * 不真正拉起安装进程（此前 mock execa 包名，全局替换同样可行，
 * 但本地模块拦截范围更小、不受其它包使用 child_process 的干扰）。
 */
import { type ChildProcess, spawn } from "node:child_process";

/** 在指定工作目录启动 bun 子进程（args 已含子命令与参数），stdio 三路 pipe。 */
export function spawnBun(args: string[], cwd: string): ChildProcess {
	return spawn(process.execPath, args, { cwd });
}
