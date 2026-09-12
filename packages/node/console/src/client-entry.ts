// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 插件前端入口的三环境路径解析。
 *
 * webui 插件向控制台注册前端产物时的公共样板：KOISHI_BASE 部署（静态托管
 * 根路径下的构建产物）、browser 构建（由宿主按 import.meta.url 推导源文件）、
 * 本地开发（dev 指向 client 源码走 HMR，prod 指向构建产物）。原先这份
 * 三分支在各插件入口各复制一份，现收敛于此；调用方传入自身模块的
 * import.meta.url，以该文件所在目录（约定为插件 src/）为基准推导。
 *
 * 落点说明：放在 console 核心（而非宿主插件 plugin-console）导出，是因为
 * 各插件的 node 侧本就依赖本包，宿主插件则会牵出 server/open 等一整条
 * 依赖图——workspace 构建下每个引用包都会重复解析该图，内存随之膨胀。
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Entry } from "./entry.ts";

export function clientEntry(metaUrl: string): Entry.Files {
	if (process.env["KOISHI_BASE"]) {
		return [
			`${process.env["KOISHI_BASE"]}/dist/index.js`,
			`${process.env["KOISHI_BASE"]}/dist/style.css`,
		];
	}
	if (process.env["KOISHI_ENV"] === "browser") {
		return [
			metaUrl.replace(/\/src\/[^/]+$/, "/client/index.ts"),
		];
	}
	const dir = fileURLToPath(new URL(".", metaUrl));
	return {
		dev: resolve(dir, "../client/index.ts"),
		prod: resolve(dir, "../dist"),
	};
}
