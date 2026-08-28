// Runs the TypeScript 7 compiler over every workspace project, because the
// root tsconfig is a paths-only shell (`files: []`) and projects are checked
// independently against sibling sources.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { availableParallelism } from "node:os";

const root = process.cwd();
const tsc = join(root, "node_modules", "@typescript", "native", "bin", "tsc");

const skipDirs = new Set(["node_modules", "lib", "dist", ".git"]);

function* walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!skipDirs.has(entry.name)) yield* walk(join(dir, entry.name));
		} else if (entry.name === "tsconfig.json") {
			yield join(dir, entry.name);
		}
	}
}

const projects = [
	...walk(join(root, "packages")),
	...walk(join(root, "plugins")),
	...walk(join(root, "apps")),
]
	.map((file) => relative(root, file).replaceAll(sep, "/"))
	// the scaffold template targets end-user projects whose dependencies are
	// not installed inside this repository
	.filter((file) => !file.startsWith("apps/koishi-scripts/template/"))
	.sort();

async function run(project) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [tsc, "--noEmit", "-p", project], {
			cwd: root,
			windowsHide: true,
		});
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.on("close", (code) =>
			resolve({
				project,
				code,
				errors: (output.match(/error TS/g) || []).length,
				output,
			}),
		);
	});
}

const queue = [...projects];
const workers = Array.from(
	{ length: Math.min(availableParallelism(), projects.length) },
	async () => {
		const results = [];
		while (queue.length) {
			const project = queue.shift();
			if (project) results.push(await run(project));
		}
		return results;
	},
);

const results = (await Promise.all(workers)).flat();
let failed = 0;
for (const { project, code, errors, output } of results.sort((a, b) =>
	a.project.localeCompare(b.project),
)) {
	if (code === 0) continue;
	failed++;
	console.log(`\n=== ${project} (${errors || "crashed"}) ===`);
	console.log(output.trimEnd());
}
console.log(
	`\n${results.length} projects checked, ${failed} failed, ${results.reduce((sum, { errors }) => sum + errors, 0)} errors`,
);
process.exit(failed ? 1 : 0);
