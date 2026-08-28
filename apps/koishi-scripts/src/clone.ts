/**
 * `koishi-scripts clone` 子命令：把已有插件仓库克隆到工作区的
 * external/ 目录下并完成依赖安装，便于在本地联动开发第三方插件。
 */
import { execSync } from "node:child_process";
import type { CAC } from "cac";
import prompts from "prompts";
import { whichPMRuns } from "which-pm-runs";

/** 交互式询问插件仓库名（接受 owner/repo 简写或完整 GitHub URL） */
async function getRepo() {
	const { name } = await prompts({
		type: "text",
		name: "name",
		message: "repository name:",
	});
	return name.trim() as string;
}

/** 交互式询问克隆到的目标目录名（未提供 name 参数时触发） */
async function getName() {
	const { name } = await prompts({
		type: "text",
		name: "name",
		message: "target directory:",
	});
	return name.trim() as string;
}

/**
 * 向 CAC 实例注册 clone 命令。
 *
 * 流程：规范化仓库地址（owner/repo → https://github.com/owner/repo.git，
 * 目标目录名默认取 repo 名去掉 koishi-plugin- 前缀）→ git clone 到
 * external/ → 用当前包管理器执行 yakumo prepare（生成各包的
 * package.json 元信息）→ 安装依赖（yarn 自身即 install，其余 agent
 * 显式带 install 参数）。
 */
export default function (cli: CAC) {
	cli
		.command("clone [repo] [name]", "clone a plugin")
		.action(async (repo: string, name: string, _options) => {
			repo ||= await getRepo();
			// 匹配 owner/repo、完整 URL 等写法，统一补全为 .git 结尾的 HTTPS 地址
			const cap =
				/^(?:https:\/\/github\.com\/)?([\w-]+)\/([\w-]+)(?:\.git)?$/.exec(repo);
			if (cap) {
				name ||= cap[2].replace("koishi-plugin-", "");
				if (!repo.startsWith("https:")) {
					repo = `https://github.com/${repo}`;
				}
				if (!repo.endsWith(".git")) {
					repo = `${repo}.git`;
				}
			}
			name ||= await getName();
			execSync(["git", "clone", repo, `external/${name}`].join(" "), {
				stdio: "inherit",
			});
			const agent = whichPMRuns()?.name || "npm";
			execSync([agent, "exec", "yakumo", "prepare"].join(" "), {
				stdio: "inherit",
			});
			const args: string[] = agent === "yarn" ? [] : ["install"];
			execSync([agent, ...args].join(" "), { stdio: "inherit" });
		});
}
