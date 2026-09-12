#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Koishi-CE monorepo 构建发布一条龙（零第三方依赖，Bun 运行时）。
 *
 * 面向本仓库 workspace 自身的全部可发布包；与 apps/koishi-scripts 的
 * release 链（面向宿主工作区 external/* 插件项目）互不相干。版本由
 * changesets 管理（.changeset/config.json），本工具编排发布链：
 *
 *   status    概览：pending changeset、本地版本 vs registry、发布序
 *   version   消费 .changeset/ 条目（changeset version）+ bun install 刷新 lockfile
 *   build     根 tsdown → 宿主控制台总装（console/dist）→ 各 webui 插件前端 dist
 *   publish   registry 比对 → 所有权预检 → 拓扑序逐包 npm publish（workspace:* 改写）
 *   pipeline  一条龙：preflight → version → 提交 → build → test → publish → push
 *
 * 设计取向（同 qq-releases / koishi-scripts 工具先例）：任何一步失败立即
 * 中断并保留现场；重跑幂等（已发布版本经 registry 比对自动跳过）；
 * --dry-run 只打印计划不落盘。webui 插件 dist 不入 git，发布前必须现
 * 构建——build 环遗漏任一插件都会导致发布缺前端，故 targets 由 files
 * 字段自动推导而非手工列举。
 *
 * 模块划分：index（入口 / HELP / 命令分发）→ { status, pipeline } →
 * { version, build, publish } → { shared, options }，proc / registry /
 * workspace 为底层能力（进程执行 / registry 查询 / workspace 纯逻辑），
 * 依赖严格单向、无回边。
 */
import { runBuildSteps } from "./build.ts";
import { parseOptions } from "./options.ts";
import { cmdPipeline } from "./pipeline.ts";
import { runPublishSteps } from "./publish.ts";
import { cmdStatus } from "./status.ts";
import { runVersion } from "./version.ts";

const HELP = `Koishi-CE 发布工具链（tooling/release）

用法：bun run release <命令> [旗标]

命令：
  status            概览：pending changeset、本地版本 vs registry、发布序
  version           消费 .changeset/ 条目（changeset version + bun install）
  build             根 tsdown + 宿主控制台总装 + 各 webui 插件前端 dist
  publish           registry 比对 → 所有权预检 → 拓扑序逐包 npm publish
  pipeline          一条龙：preflight → version → 提交 → build → test → publish

旗标：
  --dry-run         只看计划，不做任何变更
  --only <名单>     publish 仅发布名单内的包（逗号分隔包名）。补发漏发 /
                    重发坏版本用（须先 bump 版本），同样走 workspace:*
                    改写与终局断言——2026-08-31 事故（绕链手动发布把
                    workspace:* 带上 npm、下游 install 全炸）后，禁止手动 npm publish
  --push            pipeline 末尾推送 main
  --allow-dirty     跳过工作区洁净检查（版本提交仍只含版本相关文件）
  --skip-build      pipeline 跳过构建环
  --skip-test       pipeline 跳过测试环
  -h, --help        显示本帮助

环境变量：RELEASE_REGISTRY 可切换 registry 查询源（默认 registry.npmjs.org）。`;

/** CLI 入口：解析命令与旗标并分发。 */
async function main(): Promise<number> {
	const [command, ...rest] = process.argv.slice(2);
	if (
		command === undefined ||
		command === "-h" ||
		command === "--help"
	) {
		console.log(HELP);
		return 0;
	}
	const options = parseOptions(rest);
	if (options === null) {
		process.stderr.write(
			"[release] ❌ 未知旗标（支持 --dry-run / --push / --allow-dirty / --skip-build / --skip-test）\n",
		);
		console.log(HELP);
		return 1;
	}
	switch (command) {
		case "status": {
			return await cmdStatus();
		}
		case "version": {
			return (await runVersion(options)).code;
		}
		case "build": {
			return await runBuildSteps(options);
		}
		case "publish": {
			return await runPublishSteps(options);
		}
		case "pipeline": {
			return await cmdPipeline(options);
		}
		default: {
			process.stderr.write(
				`[release] ❌ 未知命令 ${JSON.stringify(command)}\n`,
			);
			console.log(HELP);
			return 1;
		}
	}
}

try {
	process.exitCode = await main();
} catch (err) {
	const message =
		err instanceof Error ? err.message : String(err);
	process.stderr.write(`[release] ❌ ${message}\n`);
	process.exitCode = 1;
}
