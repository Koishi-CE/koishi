// 逐 spec 文件串行执行:每个文件独立 bun 进程,彻底隔离跨文件全局状态
// (fake-timers 冻结全局时钟、cordis 单例等在同进程多文件下会互相污染)。
// 使用 process.execPath 直接调用 bun(Windows 无需 shell);cwd 必须经
// path.resolve 归一为原生分隔符,否则 bun 的测试发现会失灵。
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(
	dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")).replace(
		/\/scripts\/testing$/,
		"",
	),
);

const targets = [
	"packages/node/utils/tests",
	"packages/node/i18n-utils/tests",
	"packages/node/core/tests",
	"packages/node/loader/tests",
	"plugins/common/*/tests",
	"plugins/webui/*/tests",
];

const failedFiles = [];
let passedFiles = 0;
for (const file of targets
	.flatMap((t) => globSync(t))
	.flatMap((d) => globSync(`${d}/*.spec.ts`))) {
	const display = file.replaceAll("\\", "/");
	console.log(`\n=== ${display} ===`);
	const r = spawnSync(
		process.execPath,
		["test", "--conditions", "source", `./${display}`, "--timeout", "30000"],
		{ stdio: "inherit", cwd: repoRoot },
	);
	if (r.status !== 0) failedFiles.push(display);
	else passedFiles++;
}

console.log("\n========== SUMMARY ==========");
if (failedFiles.length) {
	console.log(`FAILED files (${failedFiles.length}):`);
	for (const f of failedFiles) console.log("  - " + f);
	process.exit(1);
}
console.log(`ALL ${passedFiles} TEST FILES PASSED`);
