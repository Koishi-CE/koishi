import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { basename, join, relative } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import getRegistry from "get-registry";
import kleur from "kleur";
import prompts from "prompts";
import { extract } from "tar";
import { whichPMRuns } from "which-pm-runs";
import parse from "yargs-parser";

let project: string;
let rootDir: string;

class HttpError extends Error {
	constructor(
		public status: number,
		public statusText: string,
	) {
		super(`HTTP ${status} ${statusText}`);
	}
}

const { version } = require("../package.json");

const cwd = process.cwd();
const argv = parse(process.argv.slice(2), {
	alias: {
		ref: ["r"],
		forced: ["f"],
		git: ["g"],
		prod: ["p"],
		template: ["t"],
		yes: ["y"],
		help: ["h"],
	},
});

function supports(command: string) {
	try {
		execSync(command, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

async function getName() {
	if (argv._[0]) return `${argv._[0]}`;
	const { name } = await prompts({
		type: "text",
		name: "name",
		message: "Project name:",
		initial: "koishi-app",
	});
	return name.trim() as string;
}

// baseline is Node 12 so can't use rmSync
function emptyDir(root: string) {
	for (const file of fs.readdirSync(root)) {
		const abs = join(root, file);
		if (fs.lstatSync(abs).isDirectory()) {
			emptyDir(abs);
			fs.rmdirSync(abs);
		} else {
			fs.unlinkSync(abs);
		}
	}
}

async function confirm(message: string) {
	const { yes } = await prompts({
		type: "confirm",
		name: "yes",
		initial: "Y",
		message,
	});
	return yes as boolean;
}

async function prepare() {
	if (!fs.existsSync(rootDir)) {
		return fs.mkdirSync(rootDir, { recursive: true });
	}

	const files = fs.readdirSync(rootDir);
	if (!files.length) return;

	if (!argv.forced && !argv.yes) {
		console.log(kleur.yellow(`  Target directory "${project}" is not empty.`));
		const yes = await confirm("Remove existing files and continue?");
		if (!yes) process.exit(0);
	}

	emptyDir(rootDir);
}

async function scaffold() {
	console.log(
		kleur.dim("  Scaffolding project in ") + project + kleur.dim(" ..."),
	);

	const registry = (
		argv.registry ||
		(await getRegistry()) ||
		"https://registry.npmjs.org"
	).replace(/\/$/, "");
	console.log(kleur.dim(`  Using registry: ${registry}\n`));
	const template = argv.template || "@koishijs/boilerplate";

	try {
		const metaRes = await fetch(`${registry}/${template}`);
		if (!metaRes.ok) throw new HttpError(metaRes.status, metaRes.statusText);
		const remote = await metaRes.json();
		const version = remote["dist-tags"][argv.ref || "latest"];
		const url = remote.versions[version].dist.tarball;
		const tarballRes = await fetch(url);
		const body = tarballRes.body;
		if (!tarballRes.ok || !body) {
			throw new HttpError(tarballRes.status, tarballRes.statusText);
		}

		await new Promise<void>((resolve, reject) => {
			Readable.fromWeb(body as unknown as NodeWebReadableStream)
				.pipe(extract({ cwd: rootDir, newer: true, strip: 1 }))
				.on("finish", resolve)
				.on("error", reject);
		});
	} catch (err) {
		if (!(err instanceof HttpError)) throw err;
		console.log(
			`${kleur.red("error")} request failed with status code ${err.status} ${err.statusText}`,
		);
		process.exit(1);
	}

	writePackageJson();
	writeEnvironment();

	console.log(kleur.green("  Done.\n"));
}

function writePackageJson() {
	const filename = join(rootDir, "package.json");
	const meta = require(filename);
	meta.name = project;
	meta.private = true;
	meta.version = "0.0.0";
	if (argv.prod) {
		// https://github.com/koishijs/koishi/issues/994
		// Do not use `NODE_ENV` or `--production` flag.
		// Instead, simply remove `devDependencies` and `workspaces`.
		delete meta.workspaces;
		delete meta.devDependencies;
	}
	fs.writeFileSync(filename, `${JSON.stringify(meta, null, 2)}\n`);
}

function writeEnvironment() {
	const filename = join(rootDir, ".env");
	if (!fs.existsSync(filename)) return;
	const content = fs.readFileSync(filename, "utf8");
	fs.writeFileSync(filename, content);
}

async function initGit() {
	if (!argv.git || !supports("git --version")) return;
	execSync("git init", { stdio: "ignore", cwd: rootDir });
	console.log(kleur.green("  Done.\n"));
}

async function install() {
	// with `-y` option, we don't install dependencies
	if (argv.yes) return;

	const agent = whichPMRuns()?.name || "npm";
	const yes = await confirm("Install and start it now?");
	if (yes) {
		execSync([agent, "install"].join(" "), { stdio: "inherit", cwd: rootDir });
		execSync([agent, "run", "start"].join(" "), {
			stdio: "inherit",
			cwd: rootDir,
		});
	} else {
		console.log(kleur.dim("  You can start it later by:\n"));
		if (rootDir !== cwd) {
			const related = relative(cwd, rootDir);
			console.log(kleur.blue(`  cd ${kleur.bold(related)}`));
		}
		console.log(
			kleur.blue(`  ${agent === "yarn" ? "yarn" : `${agent} install`}`),
		);
		console.log(
			kleur.blue(`  ${agent === "yarn" ? "yarn start" : `${agent} run start`}`),
		);
		console.log();
	}
}

async function start() {
	if (argv.help) {
		console.log(`
  Usage: create-koishi [name] [options]

  Options:
    -t, --template <name>  Template to use (default: @koishijs/boilerplate)
    -r, --ref <ref>        Reference to use (default: latest)
    -f, --forced           Force overwrite target directory
    -g, --git              Initialize git repository
        --registry <url>   Use specific registry (e.g., https://registry.npmmirror.com)
    -p, --prod             Production mode
    -y, --yes              Skip prompts
    -h, --help             Show this help message
`);
		return;
	}

	console.log();
	console.log(`  ${kleur.bold("Create Koishi")}  ${kleur.blue(`v${version}`)}`);
	console.log();

	const name = await getName();
	rootDir = join(cwd, name);
	project = basename(rootDir);

	await prepare();
	await scaffold();
	await initGit();
	await install();
}

start().catch((e) => {
	console.error(e);
});
