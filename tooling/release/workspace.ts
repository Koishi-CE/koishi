/**
 * workspace 包发现与发布计划纯逻辑。
 *
 * 包发现以根 package.json 的 workspaces globs 为唯一事实源（本仓库全部
 * 是 "base/*" 单层形态，其余模式忽略），排除 private 包；发布序按内部
 * 依赖（dependencies / peerDependencies / optionalDependencies 中命中
 * workspace 包名者）拓扑排序，被依赖者在前——npm 逐个发包时依赖方能先
 * 落到 registry。纯函数不触网；文件系统访问集中在 discoverPackages。
 */
import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 工作区内一个可发布包（非 private、含 name 与 version）。 */
export interface PkgInfo {
	/** npm 包名。 */
	name: string;
	/** 当前版本号。 */
	version: string;
	/** 包目录绝对路径。 */
	dir: string;
	/** package.json 绝对路径。 */
	manifestPath: string;
	dependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
	optionalDependencies: Record<string, string>;
	/** files 白名单（构建编排判断是否需要前端 dist）。 */
	files: readonly string[];
}

/** 单包跳过原因（planPublish 产出）。 */
export interface SkippedPkg {
	/** 被跳过的包。 */
	pkg: PkgInfo;
	/** 跳过原因（如 "版本已在 registry"）。 */
	reason: string;
}

/** 发布计划。 */
export interface PublishPlan {
	/** 需要发布的包（保持入参顺序）。 */
	toPublish: PkgInfo[];
	/** 因版本已在 registry 等原因跳过的包。 */
	skipped: SkippedPkg[];
}

/** 从根清单读 workspaces globs（非字符串项忽略）。 */
function readWorkspaceGlobs(root: string): string[] {
	try {
		const manifest = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		) as { workspaces?: unknown };
		if (!Array.isArray(manifest.workspaces)) {
			return [];
		}
		return manifest.workspaces.filter(
			(item): item is string => typeof item === "string",
		);
	} catch {
		return [];
	}
}

/** 展开 "base/*" 单层 glob 为子目录列表（其余模式忽略）。 */
function expandGlob(root: string, glob: string): string[] {
	if (!glob.endsWith("/*")) {
		return [];
	}
	const base = join(root, glob.slice(0, -2));
	let entries: Dirent[];
	try {
		entries = readdirSync(base, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(base, entry.name));
}

/** 读取单个目录的 package.json；不可发布（缺失/无名/无版本/private）→ null。 */
function loadPkg(dir: string): PkgInfo | null {
	const manifestPath = join(dir, "package.json");
	if (!existsSync(manifestPath)) {
		return null;
	}
	let manifest: Record<string, unknown>;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
			string,
			unknown
		>;
	} catch {
		return null;
	}
	const name = manifest["name"];
	const version = manifest["version"];
	if (
		typeof name !== "string" ||
		name === "" ||
		typeof version !== "string" ||
		version === "" ||
		manifest["private"] === true
	) {
		return null;
	}
	const record = (key: string): Record<string, string> => {
		const value = manifest[key];
		return typeof value === "object" && value !== null
			? (value as Record<string, string>)
			: {};
	};
	const files = manifest["files"];
	return {
		name,
		version,
		dir,
		manifestPath,
		dependencies: record("dependencies"),
		peerDependencies: record("peerDependencies"),
		optionalDependencies: record("optionalDependencies"),
		files: Array.isArray(files)
			? files.filter((item): item is string => typeof item === "string")
			: [],
	};
}

/** 发现工作区全部可发布包（按目录路径排序，顺序稳定）。 */
export function discoverPackages(root: string): PkgInfo[] {
	const dirs: string[] = [];
	for (const glob of readWorkspaceGlobs(root)) {
		dirs.push(...expandGlob(root, glob));
	}
	return dirs
		.sort()
		.map(loadPkg)
		.filter((pkg): pkg is PkgInfo => pkg !== null);
}

/** 包的内部依赖名集合（deps + peers + optional 命中 workspace 包名者，去重）。 */
function internalDeps(pkg: PkgInfo, names: ReadonlySet<string>): string[] {
	return [
		...new Set(
			[
				...Object.keys(pkg.dependencies),
				...Object.keys(pkg.peerDependencies),
				...Object.keys(pkg.optionalDependencies),
			].filter((name) => names.has(name)),
		),
	];
}

/**
 * 按内部依赖拓扑排序：被依赖者在前。入度为内部依赖数，Kahn 算法；
 * 存在环 → 抛错（发布链中断，人工排查）。
 */
export function topoSort(pkgs: readonly PkgInfo[]): PkgInfo[] {
	const names = new Set(pkgs.map((pkg) => pkg.name));
	const byName = new Map(pkgs.map((pkg) => [pkg.name, pkg]));
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	for (const pkg of pkgs) {
		const deps = internalDeps(pkg, names);
		inDegree.set(pkg.name, deps.length);
		for (const dep of deps) {
			const list = dependents.get(dep) ?? [];
			list.push(pkg.name);
			dependents.set(dep, list);
		}
	}
	const queue = pkgs
		.filter((pkg) => (inDegree.get(pkg.name) ?? 0) === 0)
		.map((pkg) => pkg.name);
	const ordered: string[] = [];
	while (queue.length > 0) {
		const name = queue.shift();
		if (name === undefined) {
			break;
		}
		ordered.push(name);
		for (const dependent of dependents.get(name) ?? []) {
			const next = (inDegree.get(dependent) ?? 0) - 1;
			inDegree.set(dependent, next);
			if (next === 0) {
				queue.push(dependent);
			}
		}
	}
	if (ordered.length !== pkgs.length) {
		const cyclic = pkgs
			.map((pkg) => pkg.name)
			.filter((name) => !ordered.includes(name));
		throw new Error(`内部依赖存在环，无法确定发布顺序: ${cyclic.join(", ")}`);
	}
	return ordered.map((name) => byName.get(name) as PkgInfo);
}

/** 计算发布计划：本地版本已在 registry → 跳过，否则待发布。 */
export function planPublish(
	pkgs: readonly PkgInfo[],
	published: ReadonlyMap<string, ReadonlySet<string>>,
): PublishPlan {
	const toPublish: PkgInfo[] = [];
	const skipped: SkippedPkg[] = [];
	for (const pkg of pkgs) {
		if (published.get(pkg.name)?.has(pkg.version)) {
			skipped.push({ pkg, reason: `版本 ${pkg.version} 已在 registry` });
		} else {
			toPublish.push(pkg);
		}
	}
	return { toPublish, skipped };
}

/** 解析版本为 [major, minor, patch] 数值（非数字段按 0，预发布段忽略）。 */
function versionParts(version: string): [number, number, number] {
	const parts = version.split(/[.+-]/, 3);
	return [
		Number.parseInt(parts[0] ?? "0", 10) || 0,
		Number.parseInt(parts[1] ?? "0", 10) || 0,
		Number.parseInt(parts[2] ?? "0", 10) || 0,
	];
}

/**
 * 本地版本是否低于 registry 已发布的某一版本（本地源码落后）。此时 npm
 * 会拒绝隐式 latest tag，与其让发布在半途失败，不如发布前识别并跳过。
 */
export function isDowngrade(
	local: string,
	published: ReadonlySet<string>,
): boolean {
	const localParts = versionParts(local);
	for (const version of published) {
		const parts = versionParts(version);
		if (
			parts[0] > localParts[0] ||
			(parts[0] === localParts[0] && parts[1] > localParts[1]) ||
			(parts[0] === localParts[0] &&
				parts[1] === localParts[1] &&
				parts[2] > localParts[2])
		) {
			return true;
		}
	}
	return false;
}

/** package.json 中可含 workspace:* 依赖的字段（发布前必须全部改写）。 */
const DEP_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

/** 单个依赖改写记录。 */
export interface WorkspaceRewrite {
	/** 所在字段。 */
	field: string;
	/** 依赖包名。 */
	dep: string;
	/** 改写后的版本范围（caret）。 */
	range: string;
}

/**
 * 把 manifest 文本中全部 workspace:* 依赖改写为 caret 真实版本（npm 不认
 * workspace 协议；changeset version 不改写 workspace:*，发布前必须处理）。
 * 返回改写文本与记录；无改写时原样返回（不改写不重排）。
 * 依赖不在版本表 / 出现 workspace:^ 等其他协议形式 → 抛错（发布链中断，
 * 禁止带 workspace 协议出包）。
 *
 * 改写后另有终局断言：依赖字段不得残留任何本地协议（workspace:/file:/
 * link:）。2026-08-31 事故（config@1.0.5 / market@1.0.6 / hmr@1.0.3 带
 * workspace:* 原样发布、下游 install 全炸）的教训——改写逻辑再完备也
 * 防不住绕过发布链的手动 publish，但至少保证走发布链的包永远干净。
 */
export function rewriteWorkspaceProtocol(
	raw: string,
	versions: ReadonlyMap<string, string>,
): { text: string; changes: WorkspaceRewrite[] } {
	const manifest = JSON.parse(raw) as Record<string, unknown>;
	const changes: WorkspaceRewrite[] = [];
	for (const field of DEP_FIELDS) {
		const deps = manifest[field];
		if (typeof deps !== "object" || deps === null) {
			continue;
		}
		for (const [dep, range] of Object.entries(
			deps as Record<string, unknown>,
		)) {
			if (typeof range !== "string" || !range.startsWith("workspace:")) {
				continue;
			}
			if (range !== "workspace:*") {
				throw new Error(
					`${dep} 声明了 ${range}（本仓库约定仅 workspace:*），拒绝发布`,
				);
			}
			const version = versions.get(dep);
			if (version === undefined) {
				throw new Error(
					`依赖 ${dep} 声明为 workspace:*，但工作区内不存在该包（无法改写为真实版本）`,
				);
			}
			(deps as Record<string, string>)[dep] = `^${version}`;
			changes.push({ field, dep, range: `^${version}` });
		}
	}
	for (const field of DEP_FIELDS) {
		const deps = manifest[field];
		if (typeof deps !== "object" || deps === null) {
			continue;
		}
		for (const [dep, range] of Object.entries(
			deps as Record<string, unknown>,
		)) {
			if (typeof range === "string" && /^(workspace|file|link):/.test(range)) {
				throw new Error(
					`${field}.${dep} 改写后仍残留本地协议 ${range}，拒绝发布`,
				);
			}
		}
	}
	const text =
		changes.length > 0 ? `${JSON.stringify(manifest, null, 4)}\n` : raw;
	return { text, changes };
}

/** .changeset/ 下待消费条目（*.md，README.md 除外）。 */
export function countPendingChangesets(root: string): {
	count: number;
	files: string[];
} {
	const dir = join(root, ".changeset");
	if (!existsSync(dir)) {
		return { count: 0, files: [] };
	}
	const files = readdirSync(dir)
		.filter(
			(name) =>
				name.toLowerCase() !== "readme.md" &&
				name.toLowerCase().endsWith(".md"),
		)
		.sort();
	return { count: files.length, files };
}
