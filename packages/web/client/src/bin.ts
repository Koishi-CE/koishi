#!/usr/bin/env node

/**
 * `koishi-console` CLI 入口（经根目录 bin.js 以 CJS 加载本文件的构建产物）。
 * 目前只提供 `build [root]` 子命令：对指定 webui 插件目录执行前端构建。
 */

import { cac } from "cac";
import { resolve } from "path";
import { version } from "../package.json";
import { build } from ".";

const cli = cac("koishi-console").help().version(version);

cli.command("build [root]").action((root) => {
	// root 缺省为当前工作目录
	root = resolve(process.cwd(), root || ".");
	build(root);
});

cli.parse();

// 未匹配任何子命令且未请求帮助时，主动打印帮助信息
if (!cli.matchedCommand && !cli.options["help"]) {
	cli.outputHelp();
}
