import { execSync } from "node:child_process";
import type { CAC } from "cac";
import prompts from "prompts";
import { whichPMRuns } from "which-pm-runs";

async function getRepo() {
	const { name } = await prompts({
		type: "text",
		name: "name",
		message: "repository name:",
	});
	return name.trim() as string;
}

async function getName() {
	const { name } = await prompts({
		type: "text",
		name: "name",
		message: "target directory:",
	});
	return name.trim() as string;
}

export default function (cli: CAC) {
	cli
		.command("clone [repo] [name]", "clone a plugin")
		.action(async (repo: string, name: string, _options) => {
			repo ||= await getRepo();
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
