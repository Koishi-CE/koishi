// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * workspace 包元数据与架构纪律门禁（零依赖，bun 直跑）。
 *
 * 用法：bun tooling/checks/packages.ts
 *
 * 把 AGENTS.md「硬性约束」与 docs/reference/architecture.md §3「依赖纪律」
 * 中靠人工遵守的纪律固化为自动检查，共五类：
 *
 *   1. 包名纪律：依赖声明与源码导入一律 @koishi-ce/*，不得写回上游名
 *      （koishi 裸名 / @koishijs/*）。无豁免：上游薄壳自带 peer koishi，
 *      会诱使 Bun 自动装官方全家桶；cli 包 cordis.ecosystem.pattern 列
 *      官方插件名属运行时生态匹配字段，不属依赖声明，天然不在检查范围。
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
 *   5. catalog 纪律：跨包共享外部依赖（≥2 成员包引用，deps / devDeps /
 *      optionalDeps 口径）一律以 catalog: / catalog:<名> 引用根清单
 *      workspaces.catalog / catalogs.* 的定义（唯一版本真源，字面 spec
 *      即漂移温床）；peerDependencies 豁免强制（components 对 vue 系的
 *      宽松主版本契约与 catalog 精确 spec 分属两套语义），但悬空引用
 *      检查覆盖全字段；根清单定义另做孤儿条目对账。
 *
 * `sideEffects` 字段不纳入检查：上游官方包同样不标；cordis 插件包顶层
 * 副作用多（Schema / provide / inject 声明），逐包判断误摇风险高于
 * tree-shaking 收益（本仓产物为 bundle 单文件）。
 *
 * 发现任何问题时退出码置 1。
 */
import { join, relative } from "node:path";
import {
	discoverWorkspaceDirs,
	ROOT,
	readCatalogSpecs,
	readJsonFile,
	toPosix,
} from "../shared/workspace.ts";

const issues: string[] = [];
function report(target: string, message: string): void {
	issues.push(`${target}\n    ${message}`);
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

const packages: WorkspacePackage[] = [];
for (const dir of discoverWorkspaceDirs(ROOT)) {
	const data = readJsonFile(
		join(dir, "package.json"),
	) as PackageJson | null;
	if (!data) continue;
	const file = toPosix(
		relative(ROOT, join(dir, "package.json")),
	);
	packages.push({
		file,
		dir: file.slice(0, -"/package.json".length),
		name:
			typeof data.name === "string" ? data.name : "(无名)",
		data,
	});
}

// 包发现护栏：根 workspaces 形态未被适配（或清单损坏）时，上面会静默收集
// 到 0 个包、所有检查在空集上 vacuous 通过——静默失职比报错危险，空集直接
// 判死（本仓 53 个包，空集只可能是解析问题而非真实状态）
if (packages.length === 0) {
	console.error(
		"check:packages 异常终止：workspace 包发现结果为空（根 package.json 的 workspaces 形态未被适配？）",
	);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// 检查 1：包名纪律（依赖声明不写回上游名）
// ---------------------------------------------------------------------------

const UPSTREAM_NAME_RE = /^(?:koishi|@koishijs\/.+)$/;

for (const pkg of packages) {
	for (const block of DEP_BLOCKS) {
		for (const dep of depNames(pkg.data, block)) {
			if (!UPSTREAM_NAME_RE.test(dep)) continue;
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
// 检查 6：catalog 纪律（根清单为跨包共享外部依赖的唯一版本真源）
// ---------------------------------------------------------------------------

// 强制范围：deps / devDeps / optionalDeps；peerDependencies 是运行时
// 兼容性契约（components 对 vue 系声明的是刻意宽松的主版本范围，与
// catalog 的精确 spec 分属两套语义），不做共享统计也不强制入册，
// 但悬空引用检查覆盖它（peer 里写 catalog: 同样必须可解析）
const CATALOG_CHECK_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

const memberNames = new Set(
	packages
		.map((pkg) => pkg.name)
		.filter((name) => name !== "(无名)"),
);

/** 根清单 catalog 定义（default + named，解析逻辑在 shared 层）。 */
const catalogs = readCatalogSpecs(ROOT);
const catalogDefault = catalogs.default;
const catalogNamed = catalogs.named;

interface DepRef {
	file: string;
	field: string;
	name: string;
	spec: string;
	isPeer: boolean;
}

const depRefs: DepRef[] = [];
for (const pkg of packages) {
	for (const field of CATALOG_CHECK_FIELDS) {
		const block = asRecord(pkg.data[field]);
		if (!block) continue;
		for (const [name, value] of Object.entries(block)) {
			depRefs.push({
				file: pkg.file,
				field,
				name,
				spec: typeof value === "string" ? value : "",
				isPeer: field === "peerDependencies",
			});
		}
	}
}

// 共享外部依赖统计（deps/devDeps/optionalDeps 口径，≥2 个成员包引用）
const consumers = new Map<string, Set<string>>();
for (const ref of depRefs) {
	if (ref.isPeer || memberNames.has(ref.name)) continue;
	const set = consumers.get(ref.name);
	if (set) {
		set.add(ref.file);
	} else {
		consumers.set(ref.name, new Set([ref.file]));
	}
}
const sharedNames = new Set(
	[...consumers.entries()]
		.filter(([, set]) => set.size >= 2)
		.map(([name]) => name),
);

// 共享依赖必须以 catalog: 引用（字面 spec 即漂移温床）
for (const ref of depRefs) {
	if (ref.isPeer || !sharedNames.has(ref.name)) continue;
	if (ref.spec.startsWith("catalog:")) continue;
	report(
		ref.file,
		`catalog 纪律：${ref.field} 的共享外部依赖 "${ref.name}" 应以 catalog: 引用（现 "${ref.spec}"；根清单为唯一版本真源）`,
	);
}

// 悬空引用：catalog: 指向的键必须在根清单存在
for (const ref of depRefs) {
	if (!ref.spec.startsWith("catalog:")) continue;
	const group = ref.spec.slice("catalog:".length);
	const resolved =
		group === ""
			? catalogDefault.get(ref.name)
			: catalogNamed.get(group)?.get(ref.name);
	if (resolved === undefined) {
		report(
			ref.file,
			`catalog 纪律：${ref.field} 引用 "${ref.spec}" 在根清单 catalog 中无定义（${group === "" ? "默认目录" : `目录 "${group}"`}缺失该键）`,
		);
	}
}

// 孤儿条目：根清单 catalog 定义的键必须至少被一个成员引用
const usedKeys = new Set<string>();
for (const ref of depRefs) {
	if (!ref.spec.startsWith("catalog:")) continue;
	const group = ref.spec.slice("catalog:".length);
	usedKeys.add(
		group === "" ? `:${ref.name}` : `${group}:${ref.name}`,
	);
}
for (const [name] of catalogDefault) {
	if (!usedKeys.has(`:${name}`)) {
		report(
			"package.json",
			`catalog 纪律：默认目录条目 "${name}" 无任何成员引用（孤儿条目）`,
		);
	}
}
for (const [group, entries] of catalogNamed) {
	for (const [name] of entries) {
		if (!usedKeys.has(`${group}:${name}`)) {
			report(
				"package.json",
				`catalog 纪律：目录 "${group}" 条目 "${name}" 无任何成员引用（孤儿条目）`,
			);
		}
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
