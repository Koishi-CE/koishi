// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * workspace 包元数据与架构纪律门禁（零依赖，bun 直跑）。
 *
 * 用法：bun tooling/checks/packages.ts
 *
 * 把 AGENTS.md「硬性约束」与 docs/reference/architecture.md §3「依赖纪律」
 * 中靠人工遵守的纪律固化为自动检查，共四类：
 *
 *   1. 包名纪律：依赖声明与源码导入一律 @koishi-ce/*，不得写回上游名
 *      （koishi 裸名 / @koishijs/*）。豁免仅 @koishijs/plugin-server-proxy
 *      ——console 的类型引用（硬性约束 2 的唯一例外），且只允许出现在
 *      devDependencies。cli 包 cordis.ecosystem.pattern 列官方插件名属
 *      运行时生态匹配字段，不属依赖声明，天然不在检查范围。
 *   2. 元数据统一：顶层类型字段一律 types，不混用旧别名 typings
 *      （exports 内的 types 条件是标准解析字段，不受约束）。
 *   3. ESM-only：全部 workspace 包 type: module，exports 不得出现
 *      require 条件；main 不得指向 CJS 形态（.cjs / .js；.mjs 与指向
 *      源码的 .ts 均合法）。
 *   4. 依赖方向（architecture.md §3，查 dependencies + peerDependencies，
 *      devDependencies 属测试面豁免）：
 *      - packages/web/*（浏览器侧）不得依赖 node 侧运行时（core / loader /
 *        cli 聚合 / plugin-*）；web 家族内部互引（components / client）除外；
 *      - packages/node/*（node 侧）不得依赖浏览器侧包（client / components）；
 *      - plugins/common/* 不得依赖 webui 宿主（console）；
 *      - plugins/** 的声明依赖与 peer 不得依赖浏览器侧包（client /
 *        components 仅允许 devDependencies 测试面）。
 *
 * 经评估**不**纳入检查的项：`sideEffects` 字段声明（2026-09-18 拍板不做）
 * ——上游官方包同样不标；cordis 插件包顶层副作用多（Schema / provide /
 * inject 声明），逐包判断误摇风险的成本高于 tree-shaking 收益（本仓产物
 * 为 bundle 单文件）。再收到补标建议时引本条，勿重复评估。
 *
 * 发现任何问题时退出码置 1。
 */
import { join, relative, resolve, sep } from "node:path";

/** 仓库根目录（本脚本位于 tooling/checks/ 下）。 */
const ROOT = resolve(import.meta.dirname, "../..");

/** path 分隔符归一为 posix（win32 下 Bun.Glob 返回反斜杠路径）。 */
function toPosix(path: string): string {
	return path.split(sep).join("/");
}

function asRecord(
	value: unknown,
): Record<string, unknown> | null {
	return value !== null &&
		typeof value === "object" &&
		!Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** 检查关注的 package.json 字段；其余字段经索引签名放行。 */
interface PackageJson {
	name?: unknown;
	type?: unknown;
	main?: unknown;
	exports?: unknown;
	dependencies?: unknown;
	devDependencies?: unknown;
	peerDependencies?: unknown;
	optionalDependencies?: unknown;
	[key: string]: unknown;
}

const DEP_BLOCKS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

function depNames(
	data: PackageJson,
	block: (typeof DEP_BLOCKS)[number],
): string[] {
	const value = asRecord(data[block]);
	return value ? Object.keys(value) : [];
}

/** 违规项收集：目标（文件或 文件:行）加一行描述。 */
const issues: string[] = [];
function report(target: string, message: string): void {
	issues.push(`${target}\n    ${message}`);
}

// ---------------------------------------------------------------------------
// workspace 包收集（以根 package.json 的 workspaces 声明为准）
// ---------------------------------------------------------------------------

interface WorkspacePackage {
	/** 相对仓库根的 posix 路径（如 packages/node/core/package.json）。 */
	file: string;
	/** 包目录的相对 posix 前缀（如 packages/node/core）。 */
	dir: string;
	/** 包名，缺失时以占位符参与输出。 */
	name: string;
	data: PackageJson;
}

const rootConfig = asRecord(
	await Bun.file(join(ROOT, "package.json")).json(),
);
const workspaceGlobs = Array.isArray(rootConfig?.workspaces)
	? rootConfig.workspaces.filter(
			(glob): glob is string => typeof glob === "string",
		)
	: [];

const packages: WorkspacePackage[] = [];
for (const glob of workspaceGlobs) {
	const pattern = `${glob}/package.json`;
	for (const abs of new Bun.Glob(pattern).scanSync({
		cwd: ROOT,
		dot: true,
		absolute: true,
	})) {
		const file = toPosix(relative(ROOT, abs));
		// 脚手架模板内同名文件不是 workspace 包
		if (file.includes("/template/")) continue;
		const data = asRecord(
			await Bun.file(abs).json(),
		) as PackageJson | null;
		if (!data) continue;
		packages.push({
			file,
			dir: file.slice(0, -"/package.json".length),
			name:
				typeof data.name === "string"
					? data.name
					: "(无名)",
			data,
		});
	}
}

// ---------------------------------------------------------------------------
// 检查 1：包名纪律（依赖声明不写回上游名）
// ---------------------------------------------------------------------------

/** 上游名依赖豁免表：允许的Specifier → 允许出现的依赖块。 */
const UPSTREAM_DEP_EXEMPT: Record<
	string,
	readonly string[]
> = {
	// 硬性约束 2 的唯一例外：console 的服务端代理类型引用，仅限测试类型面
	"@koishijs/plugin-server-proxy": ["devDependencies"],
};

const UPSTREAM_NAME_RE = /^(?:koishi|@koishijs\/.+)$/;

for (const pkg of packages) {
	for (const block of DEP_BLOCKS) {
		for (const dep of depNames(pkg.data, block)) {
			if (!UPSTREAM_NAME_RE.test(dep)) continue;
			if (UPSTREAM_DEP_EXEMPT[dep]?.includes(block))
				continue;
			report(
				pkg.file,
				`包名纪律：${block} 引用上游名 "${dep}"（应指向 @koishi-ce/*）`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// 检查 2：元数据统一（顶层类型字段一律 types）
// ---------------------------------------------------------------------------

for (const pkg of packages) {
	if ("typings" in pkg.data) {
		report(
			pkg.file,
			"元数据统一：顶层类型字段用了旧别名 typings，应统一为 types",
		);
	}
}

// ---------------------------------------------------------------------------
// 检查 3：ESM-only 形态
// ---------------------------------------------------------------------------

/** exports 条件树中是否出现 require 条件。 */
function hasRequireCondition(value: unknown): boolean {
	const record = asRecord(value);
	if (!record) return false;
	return Object.entries(record).some(
		([key, child]) =>
			key === "require" || hasRequireCondition(child),
	);
}

for (const pkg of packages) {
	if (pkg.data.type !== "module") {
		const actual =
			typeof pkg.data.type === "string"
				? `"${pkg.data.type}"`
				: "未声明";
		report(
			pkg.file,
			`ESM-only：type 应为 "module"（实为 ${actual}）`,
		);
	}
	if (hasRequireCondition(pkg.data.exports)) {
		report(
			pkg.file,
			"ESM-only：exports 出现 require 条件（产物只允许 default 兜底的 ESM）",
		);
	}
	if (
		typeof pkg.data.main === "string" &&
		/\.(?:cjs|js)$/.test(pkg.data.main)
	) {
		report(
			pkg.file,
			`ESM-only：main 指向 CJS 形态 "${pkg.data.main}"（.mjs 或源码 .ts 合法）`,
		);
	}
}

// ---------------------------------------------------------------------------
// 检查 4：依赖方向（dependencies + peerDependencies）
// ---------------------------------------------------------------------------

interface DirectionRule {
	/** 包目录的相对 posix 前缀。 */
	scope: string;
	/** 命中 scope 但包目录位于这些前缀时豁免（附理由）。 */
	exemptDirs?: readonly (readonly [
		prefix: string,
		reason: string,
	])[];
	banned: RegExp;
	label: string;
}

/** architecture.md §3 依赖方向的负面规则；包目录命中 scope 即逐条检查。 */
const DIRECTION_RULES: DirectionRule[] = [
	{
		scope: "packages/web/",
		banned:
			/^@koishi-ce\/(?:core|loader|koishi|plugin-.+)$/,
		label:
			"浏览器侧不得依赖 node 侧运行时（core / loader / cli 聚合 / plugin-*）",
	},
	{
		scope: "packages/node/",
		banned: /^@koishi-ce\/(?:client|components)$/,
		label:
			"node 侧不得依赖浏览器侧包（client / components）",
	},
	{
		scope: "plugins/common/",
		banned: /^@koishi-ce\/console$/,
		label: "通用插件不得依赖 webui 宿主（console）",
	},
	{
		scope: "plugins/",
		exemptDirs: [
			// console 宿主对 client 的 peer 是防御性声明：钉住下游解析、
			// 防 Bun 自动安装官方包（AGENTS.md 硬性约束 1）
			[
				"plugins/webui/console",
				"宿主的防御性 peer（下游解析钉名）",
			],
		],
		banned: /^@koishi-ce\/(?:client|components)$/,
		label:
			"插件不得声明依赖浏览器侧包（client / components 属 devDependencies 测试面）",
	},
];

for (const pkg of packages) {
	for (const rule of DIRECTION_RULES) {
		if (!pkg.dir.startsWith(rule.scope)) continue;
		if (
			rule.exemptDirs?.some(([prefix]) =>
				pkg.dir.startsWith(prefix),
			)
		)
			continue;
		for (const block of [
			"dependencies",
			"peerDependencies",
		] as const) {
			for (const dep of depNames(pkg.data, block)) {
				if (!rule.banned.test(dep)) continue;
				report(
					pkg.file,
					`依赖方向：${block} 引用 "${dep}" —— ${rule.label}`,
				);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// 检查 5：源码导入纪律（不 import 上游名）
// ---------------------------------------------------------------------------

/** 源码导入白名单：硬性约束 2 的唯一例外（console 的类型引用）。 */
const UPSTREAM_IMPORT_EXEMPT = new Set([
	"@koishijs/plugin-server-proxy",
]);

/**
 * 排除的路径段：第三方区 / 构建产物 / 脚手架模板 / vendor 上游拷贝物 /
 * 测试目录（__tests__ 内的 import 语句文本多为被测函数的样例载荷，
 * 如 shared client 改写测试的输入字符串，非真实模块边）。
 */
const EXCLUDED_SEGMENTS = [
	"node_modules",
	"lib",
	"dist",
	"vendor",
	"template",
	"coverage",
	"__tests__",
];

const IMPORT_RE =
	/(?:\bfrom|\bimport|\brequire)\s*\(?\s*(["'])(koishi|@koishijs\/[^"']*)\1/g;

const sourceGlob = new Bun.Glob(
	"{packages,plugins,apps}/**/*.{ts,mts,vue}",
);
for (const abs of sourceGlob.scanSync({
	cwd: ROOT,
	dot: true,
	absolute: true,
})) {
	const file = toPosix(relative(ROOT, abs));
	if (
		EXCLUDED_SEGMENTS.some((segment) =>
			file.includes(`/${segment}/`),
		)
	)
		continue;
	const text = await Bun.file(abs).text();
	for (const match of text.matchAll(IMPORT_RE)) {
		const specifier = match[2];
		if (specifier && UPSTREAM_IMPORT_EXEMPT.has(specifier))
			continue;
		const line = text
			.slice(0, match.index ?? 0)
			.split("\n").length;
		report(
			`${file}:${line}`,
			`包名纪律：源码导入上游名 "${specifier ?? ""}"（应导入 @koishi-ce/*）`,
		);
	}
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

if (issues.length > 0) {
	console.error(
		`check:packages 发现 ${issues.length} 处违规：\n`,
	);
	for (const issue of issues) console.error(issue);
	process.exit(1);
}
console.log(
	`check:packages 通过：${packages.length} 个 workspace 包元数据与导入纪律无违规。`,
);
