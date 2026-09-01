#!/usr/bin/env bun

// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Koishi 命令行入口。
 *
 * 基于 cac 构建名为 `koishi` 的命令行程序，注册 `start`（别名 `run`）子命令后解析
 * 进程参数。若用户未输入任何子命令（且未请求帮助），则自动打印帮助信息退出。
 */

import { cac } from "cac";
import pkg from "../../package.json" with { type: "json" };

const { version } = pkg;

import registerStartCommand from "./start.ts";

const cli = cac("koishi").help().version(version);

registerStartCommand(cli);

const argv = cli.parse();

// 未匹配到子命令且未请求 --help 时，主动输出帮助信息，避免静默退出
if (!cli.matchedCommand && !argv.options["help"]) {
	cli.outputHelp();
}
