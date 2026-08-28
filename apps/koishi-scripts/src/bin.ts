/**
 * koishi-scripts CLI 入口（包名 @koishi-ce/scripts）。
 *
 * 基于 CAC 组装命令行界面并注册两个子命令：
 * - clone：把已有插件仓库克隆到 external/ 并安装依赖；
 * - setup：按模板初始化一个新插件项目。
 * 由仓库根的 bin.js 经 require("./lib/bin") 引导进入。
 */
import CAC from "cac";
import registerCloneCommand from "./clone";
import registerSetupCommand from "./setup";

// 自身版本号（构建产物为 CJS，require 可用）
const { version } = require("../package.json");

// 创建 CLI 实例：--help / --version 由 CAC 内建支持
const cli = CAC("koishi-scripts").help().version(version);

registerCloneCommand(cli);
registerSetupCommand(cli);

cli.parse();

// 未匹配到任何子命令时打印帮助信息（如裸执行 koishi-scripts）
if (!cli.matchedCommand) {
	cli.outputHelp();
}
