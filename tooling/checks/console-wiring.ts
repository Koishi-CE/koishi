// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * console 类型源头共享的接线对账门禁（bun 直跑，零依赖）。
 *
 * 用法：bun tooling/checks/console-wiring.ts
 *
 * 浏览器端对 console 服务类型的消费走「类型源头共享」：各插件 client 侧
 * 不写 declare module 镜像，node 侧的 Services / Events 增强声明
 * （declare module "@koishi-ce/console"）经 lib 产物 d.ts 携带，由基座
 * paths + 接线文件（packages/web/client/console-services.d.ts 的副作用
 * 导入）拉入浏览器类型程序。本脚本把这套间接链路的两个易漂移点固化为
 * 对账：
 *
 *   1. 接线对账：node 侧声明了 console 增强的插件包集合，须与接线文件
 *      的导入包集合双向一致——新增插件忘了接线会让其 store 键 / 事件
 *      类型在浏览器端静默缺失（推导退化为 never / any）；
 *   2. paths 层对账：基座 tsconfig.client.json 的 paths 键集必须被
 *      tsconfig.web.json 完整覆盖——extends 的 paths 是整体替换语义，
 *      大一统程序须手工重写基座映射，漏写即全程序断链。
 *
 * 发现任何问题时退出码置 1。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readJsonFile } from "../shared/workspace.ts";

const problems: string[] = [];

/** 读 JSONC（tsconfig 带注释与尾逗号，用 Bun 内置 JSONC 解析）。 */
function readJsonc(
	relativePath: string,
): Record<string, unknown> {
	try {
		const parsed: unknown = Bun.JSONC.parse(
			readFileSync(join(ROOT, relativePath), "utf8"),
		);
		return parsed as Record<string, unknown>;
	} catch {
		problems.push(`${relativePath} 解析失败`);
		return {};
	}
}

// ---------------------------------------------------------- 1. 接线对账

/** 递归收集目录下的 .ts 文件（跳过测试与声明文件）。 */
function collectTsFiles(dir: string): string[] {
	const out: string[] = [];
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (
				entry.name === "__tests__" ||
				entry.name === "node_modules"
			) {
				continue;
			}
			out.push(...collectTsFiles(full));
		} else if (
			entry.name.endsWith(".ts") &&
			!entry.name.endsWith(".d.ts") &&
			!entry.name.endsWith(".test.ts")
		) {
			out.push(full);
		}
	}
	return out;
}

const AUGMENT_RE =
	/declare\s+module\s+(['"])@koishi-ce\/console\1/;

/** 是否声明 console 增强；整行注释不参与匹配（注释里的示例会假阳）。 */
function declaresConsoleAugmentation(
	text: string,
): boolean {
	return text.split("\n").some((line) => {
		const trimmed = line.trim();
		if (
			trimmed.startsWith("//") ||
			trimmed.startsWith("/*") ||
			trimmed.startsWith("*")
		) {
			return false;
		}
		return AUGMENT_RE.test(line);
	});
}

/** node 侧声明了 console 增强的插件包名集合（包名取 manifest 真实 name）。 */
const WIRING_FILE =
	"packages/web/client/console-services.d.ts";

const augmentedPackages = new Set<string>();
const webuiRoot = join(ROOT, "plugins/webui");
for (const entry of readdirSync(webuiRoot, {
	withFileTypes: true,
})) {
	if (!entry.isDirectory()) continue;
	const dir = join(webuiRoot, entry.name);
	const name = readJsonFile(join(dir, "package.json"))?.[
		"name"
	];
	if (typeof name !== "string") continue;
	const hasAugmentation = collectTsFiles(
		join(dir, "src"),
	).some((file) =>
		declaresConsoleAugmentation(readFileSync(file, "utf8")),
	);
	if (hasAugmentation) {
		augmentedPackages.add(name);
	}
}

/** 接线文件的副作用导入包名集合。 */
const wiringPackages = new Set<string>();
for (const line of readFileSync(
	join(ROOT, WIRING_FILE),
	"utf8",
).split("\n")) {
	const match = /^import "(@koishi-ce\/[^"]+)";$/.exec(
		line.trim(),
	);
	if (match?.[1]) wiringPackages.add(match[1]);
}

for (const pkg of augmentedPackages) {
	if (!wiringPackages.has(pkg)) {
		problems.push(
			`${pkg} 在 node 侧声明了 console 增强，但接线文件 ${WIRING_FILE} 缺少对应导入（浏览器端该插件的 store 键 / 事件类型会静默缺失）`,
		);
	}
}
for (const pkg of wiringPackages) {
	if (!augmentedPackages.has(pkg)) {
		problems.push(
			`${pkg} 在接线文件中导入，但其 node 侧未扫到任何 console 增强声明（包已删增强则接线行应同步移除）`,
		);
	}
}

// ---------------------------------------------------------- 2. paths 层对账

/** 从 tsconfig 提取 compilerOptions.paths 的键集。 */
function pathsKeys(relativePath: string): Set<string> {
	const config = readJsonc(relativePath);
	const options = config.compilerOptions as
		| { paths?: Record<string, unknown> }
		| undefined;
	return new Set(Object.keys(options?.paths ?? {}));
}

const basePaths = pathsKeys("tsconfig.client.json");
const webPaths = pathsKeys("tsconfig.web.json");

for (const key of basePaths) {
	if (!webPaths.has(key)) {
		problems.push(
			`基座 tsconfig.client.json 的 paths 键 "${key}" 未被 tsconfig.web.json 重写（extends 的 paths 是整体替换语义，大一统程序漏写即全程序断链）`,
		);
	}
}

// ---------------------------------------------------------------- 汇总输出

if (problems.length) {
	console.error(
		`console 类型接线对账发现 ${problems.length} 个问题：`,
	);
	for (const problem of problems) {
		console.error(`  - ${problem}`);
	}
	process.exit(1);
} else {
	console.log(
		`console 类型接线对账通过：${augmentedPackages.size} 个插件增强已接线，paths 基座键 ${basePaths.size} 个全部被 web 层覆盖`,
	);
}
