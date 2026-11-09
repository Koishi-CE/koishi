// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * `--docker` 生成的容器化模板（Dockerfile / docker-entrypoint.sh /
 * compose.yaml / .dockerignore）。
 *
 * 设计前提（与「不可变镜像」相反）：容器是可变工作区。控制台插件市场
 * 必须能安装 / 卸载 / 更新插件，koishi.yml、package.json、bun.lock、
 * node_modules 与 data/ 在容器重启或重建后完整保留。因此：
 * - 镜像在 /seed 预热初始依赖，/app 是工作区（compose 直接挂载宿主
 *   项目目录），entrypoint 首次遇到空工作区时从 /seed 初始化；
 * - 平台与架构差异交给官方 oven/bun 多架构镜像，不在本模板里分叉；
 * - 静态文本一律放在 src/docker/ 下的真实文件里（与 src/template 同款），
 *   本模块只负责定位与读取；npm 包的 files 含 src，lib 产物与 src 直跑
 *   两种形态都能按相对路径定位。
 */
import {
	existsSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";

/** 定位容器化模板目录（src 直跑与 lib 产物两种形态各按相对路径探测） */
function locateDockerDir(): string {
	const base = import.meta.dir;
	for (const dir of [
		join(base, "docker"),
		join(base, "../src/docker"),
	]) {
		if (existsSync(dir)) return dir;
	}
	throw new Error(
		"create-koishi-ce 容器化模板目录缺失（src/docker）",
	);
}

const dockerDir = locateDockerDir();

/**
 * 无点前缀的模板源文件名 → 生成项目中的目标路径。`.dockerignore` 以点
 * 开头，npm 发布与各路工具对点文件有特殊处理，模板目录里存无点文件名。
 */
const dotFiles: Record<string, string> = {
	dockerignore: ".dockerignore",
};

/**
 * 容器化模板文件（相对项目根的路径 → 文件内容）。
 *
 * 统一归一为 LF：entrypoint 的 shebang 若带 CRLF，容器内会以
 * `#!/bin/sh\r` 执行失败；仓库虽已配置 eol=lf，生成侧再兜一层。
 */
export const dockerFiles: Record<string, string> =
	Object.fromEntries(
		readdirSync(dockerDir)
			.filter((file) => !file.startsWith("."))
			.map((file) => [
				dotFiles[file] ?? file,
				readFileSync(join(dockerDir, file), "utf8").replace(
					/\r\n/g,
					"\n",
				),
			]),
	);
