#!/usr/bin/env node

/**
 * `koishi-console` CLI 入口（构建产物 lib/bin.mjs 由 package.json 的
 * bin 字段指向，仓库内亦可用 Bun 直接运行本源文件）。
 * 子命令 `build [root]`：带 root（或 cwd 本身是含 client/ 的插件目录）
 * 时构建该 webui 插件的前端；否则执行宿主控制台前端总装
 * （scripts/client.ts，产物写入 plugins/webui/console/dist）。
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cac } from "cac";
import { version } from "../package.json";
import { build } from ".";

const cli = cac("koishi-console").help().version(version);

cli.command("build [root]").action(async (root) => {
	// root 缺省时：cwd 是插件目录则构建它，否则视为宿主总装
	const target = root ?? (existsSync("client") ? "." : undefined);
	if (target !== undefined) {
		await build(resolve(process.cwd(), target));
		return;
	}
	const host = await import("../scripts/client.ts");
	await host.default();
});

cli.parse();

// 未匹配任何子命令且未请求帮助时，主动打印帮助信息
if (!cli.matchedCommand && !cli.options["help"]) {
	cli.outputHelp();
}
