// 逐 project 并行跑 TS7 类型检查：根 tsconfig 是 paths-only 空壳（files: []），
// 各 project 独立对照兄弟包源码检查，故需扫描 packages / plugins / apps 下全部
// tsconfig 分别执行。50 个 project 全量 Promise.all 并发，调度交给操作系统。
// 直连 spawn @typescript/native 的 tsc（即 bunx tsc 解析到的同一二进制）。
// 输出重定向到临时文件而非管道：Bun.spawn 管道在 win32 高并发下存在读端
// EOF 不送达的竞态（曾挂死全量检查），文件重定向不经过管道机制；
// --pretty 使诊断携带 ANSI 色码，回显到终端即为彩色输出。
import {
	closeSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const skipDirs = new Set(["node_modules", "lib", "dist", ".git"]);

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!skipDirs.has(entry.name)) yield* walk(`${dir}/${entry.name}`);
		} else if (entry.name === "tsconfig.json") {
			yield `${dir}/${entry.name}`;
		}
	}
}

const projects = [
	...walk("packages"),
	...walk("plugins"),
	...walk("apps"),
].sort();

const tsc = join(
	process.cwd(),
	"node_modules",
	"@typescript",
	"native",
	"bin",
	"tsc",
);
const outDir = mkdtempSync(join(tmpdir(), "koishi-typecheck-"));

interface Result {
	project: string;
	code: number;
	errors: number;
	output: string;
}

async function run(project: string, index: number): Promise<Result> {
	const outPath = join(outDir, `${index}.log`);
	const fd = openSync(outPath, "w");
	try {
		const proc = Bun.spawn(
			[process.execPath, tsc, "--noEmit", "--pretty", "-p", project],
			{
				stdin: "ignore",
				stdout: fd,
				stderr: fd,
			},
		);
		const code = await proc.exited;
		const output = readFileSync(outPath, "utf8");
		return {
			project,
			code,
			errors: (output.replace(ansi, "").match(/error TS/g) ?? []).length,
			output,
		};
	} finally {
		closeSync(fd);
	}
}

// --pretty 让 tsc 输出彩色诊断；计数前剥离 ANSI 色码。
// biome-ignore lint/suspicious/noControlCharactersInRegex: 匹配对象本就是 ANSI 控制序列
const ansi = /\x1b\[[0-9;]*m/g;

const results = await Promise.all(projects.map(run));
rmSync(outDir, { recursive: true, force: true });
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
