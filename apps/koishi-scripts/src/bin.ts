#!/usr/bin/env bun
/**
 * koishi-scripts CLI 入口（包名 @koishi-ce/scripts）。
 *
 * 手写极简 CLI（不引 CLI 框架，先例 packages/web/client/src/bin.ts），
 * 注册五个子命令：
 * - setup：按本仓库范式初始化插件项目（别名 create / init / new）；
 * - clone：把已有插件仓库克隆到宿主工作区 external/ 并安装依赖；
 * - version / build / publish：发布链三环（跨仓库 changeset version、
 *   全工作区串行构建、registry 比对后逐包 npm publish）。
 */
import pkg from "../package.json" with { type: "json" };

const { version } = pkg;

import runClone from "./clone.ts";
import runBuild from "./release/build.ts";
import runPublish from "./release/publish.ts";
import runVersion from "./release/version.ts";
import runSetup from "./setup.ts";

const HELP = `koishi-scripts v${version} —— Koishi 插件脚手架与发布链

用法：koishi-scripts <命令> [参数]

命令：
  setup [name]        初始化插件项目到宿主工作区 external/（别名 create/init/new）
                      --monorepo, -m      插件集合仓库形态（根级 changesets + paths 映射）
                      --console, -c       附带控制台前端扩展（client/ 目录）
                      --name= --desc= --owner=   非交互模式
  clone [repo] [name] 克隆插件仓库到 external/ 并 bun install
  version             对 external/ 下有 pending changeset 的项目执行 changeset version
  build               串行构建 external/ 下全部可构建项目（失败即中断）
  publish [--dry-run] 发布链末环：registry 比对 → 所有权预检 → 拓扑序逐包 npm publish

选项：
  -h, --help          显示本帮助
  -v, --version       显示版本号`;

type Run = (args: readonly string[]) => Promise<number> | number;

const commands: Record<string, Run> = {
	setup: runSetup,
	create: runSetup,
	init: runSetup,
	new: runSetup,
	clone: runClone,
	version: () => runVersion(),
	build: () => runBuild(),
	publish: runPublish,
};

const argv = process.argv.slice(2);

if (argv.includes("-h") || argv.includes("--help")) {
	console.log(HELP);
} else if (argv.includes("-v") || argv.includes("--version")) {
	console.log(version);
} else {
	const [command, ...rest] = argv;
	const run = command === undefined ? undefined : commands[command];
	if (run === undefined) {
		console.log(HELP);
		// 裸执行（无参数）只是看帮助，不算错误；拼错命令名则报退出码
		process.exitCode = command === undefined ? 0 : 1;
	} else {
		try {
			process.exitCode = await run(rest);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[koishi-scripts] ❌ ${message}\n`);
			process.exitCode = 1;
		}
	}
}
