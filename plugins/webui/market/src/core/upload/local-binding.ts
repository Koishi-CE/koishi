/**
 * @file 本地插件绑定(core/upload 域):把宿主内已存在的本地插件打成 .tgz
 * 归档并放入 .yarn/local,生成 file: 协议依赖串,使其可以像普通依赖一样
 * 被 package.json 引用与重装。
 *
 * 关键设计:
 * - 只允许绑定"来源未绑定(unbound)"的本地插件依赖,防止误绑定 registry 包;
 * - npm pack 加 --ignore-scripts,打包过程不执行插件的生命周期脚本;
 * - 产物按内容 sha256 命名,同内容天然幂等(重复绑定直接复用已有归档);
 * - rename 落位时处理并发竞态:目标已出现且内容一致则复用,不一致才报错。
 *
 * 架构位置:core/upload 域入口,被 core/install/sources/upload.ts 包装,
 * 供 node/installer 对外的 prepareLocalBinding 使用;依赖解析状态来自
 * deps/resolver,manifest 快照来自 install/sources/manifest-restore;
 * 纯校验/命名工具(parseNpmPackOutput、assertBindableDependency 等)拆至
 * local-binding-utils.ts。
 */
import { createHash } from "node:crypto";
import { promises as fsp, type Stats } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Dict } from "@koishi-ce/koishi";
import type { PackageJson } from "@koishi-ce/registry";
import { execa } from "execa";
import type { DependencyResolver } from "../deps/resolver.js";
import type { Dependency } from "../deps/types.js";
import { snapshotPackageManifest } from "../install/sources/manifest-restore.js";
import type { InstallLogger, LocalBindingResult } from "../install/types.js";
import { resolvePackageManifest } from "../registry/manifest.js";
import { MINUTE } from "../utils/time.js";
import {
	assertBindableDependency,
	createHashedLocalBindingFilename,
	createLocalBindingRequest,
	type LocalBindingPackResult,
	MAX_LOCAL_BINDING_PACK_SIZE,
	parseNpmPackOutput,
} from "./local-binding-utils.js";

export type { LocalBindingPackResult } from "./local-binding-utils.js";
export {
	createHashedLocalBindingFilename,
	createLocalBindingRequest,
	MAX_LOCAL_BINDING_PACK_SIZE,
	parseNpmPackOutput,
} from "./local-binding-utils.js";

/** 本地绑定准备所需的宿主依赖面（LocalPackageUploadServiceDeps 的结构性子集）。 */
export interface LocalBindingPrepareDeps {
	/** 宿主工作目录 */
	cwd: string;
	/** 安装日志通道(InstallLogger) */
	log: InstallLogger;
	/** npm pack 超时(毫秒,缺省至少 1 分钟) */
	timeout?: number | undefined;
	/** 依赖解析器(读取 depCache 判定依赖是否为 unbound 本地插件) */
	resolver: DependencyResolver;
}

/** 定位并读取本地插件清单，校验与当前依赖状态一致。 */
async function readLocalPluginManifest(
	deps: LocalBindingPrepareDeps,
	name: string,
	expectedVersion: string,
): Promise<{ manifestFile: string; manifest: PackageJson }> {
	let manifestFile: string;
	try {
		manifestFile = resolvePackageManifest(name, deps.cwd);
	} catch {
		throw new Error(
			"无法定位本地插件目录；请确认插件仍可被当前 Koishi 实例加载。",
		);
	}
	const manifest = JSON.parse(
		await fsp.readFile(manifestFile, "utf8"),
	) as PackageJson;
	if (manifest.name !== name || manifest.version !== expectedVersion) {
		throw new Error("本地插件清单与当前依赖状态不一致，请刷新依赖后重试。");
	}
	return { manifestFile, manifest };
}

/** npm pack 落地临时目录并校验打包产物。 */
async function packLocalPluginArchive(
	deps: LocalBindingPrepareDeps,
	name: string,
	expectedVersion: string,
	sourceDir: string,
	temporary: string,
): Promise<{ pack: LocalBindingPackResult; packedFile: string; stat: Stats }> {
	const { stdout } = await execa(
		"npm",
		// --ignore-scripts:打包只取文件内容,不执行 prepare/prepack 等生命周期脚本
		[
			"pack",
			sourceDir,
			"--ignore-scripts",
			"--json",
			"--pack-destination",
			temporary,
		],
		{ cwd: deps.cwd, timeout: Math.max(MINUTE, deps.timeout ?? 0) },
	);
	const pack = parseNpmPackOutput(stdout);
	if (
		(pack.name && pack.name !== name) ||
		(pack.version && pack.version !== expectedVersion)
	) {
		throw new Error("本地插件打包结果与当前依赖不一致。");
	}
	const packedFile = resolve(temporary, pack.filename);
	if (
		dirname(packedFile) !== temporary ||
		relative(temporary, packedFile).startsWith("..")
	) {
		throw new Error("本地插件打包路径无效。");
	}
	const stat = await fsp.stat(packedFile);
	if (
		!stat.isFile() ||
		stat.size <= 0 ||
		stat.size > MAX_LOCAL_BINDING_PACK_SIZE ||
		stat.size !== pack.size
	) {
		throw new Error("本地插件打包文件无效或过大。");
	}
	return { pack, packedFile, stat };
}

/** 计算内容哈希与最终归档文件名/路径。 */
async function resolveFinalArchive(
	pack: LocalBindingPackResult,
	packedFile: string,
	destination: string,
): Promise<{ hash: string; filename: string; target: string }> {
	const content = await fsp.readFile(packedFile);
	const hash = createHash("sha256").update(content).digest("hex");
	const filename = createHashedLocalBindingFilename(
		pack.filename,
		hash.slice(0, 12),
	);
	const target = resolve(destination, filename);
	if (
		dirname(target) !== destination ||
		relative(destination, target).startsWith("..")
	) {
		throw new Error("本地插件目标路径无效。");
	}
	return { hash, filename, target };
}

/** 目标归档已存在时校验一致性；不存在/不一致返回 false 或抛错。 */
async function validateExistingTarget(
	target: string,
	stat: Stats,
	hash: string,
): Promise<boolean> {
	let targetStat: Stats;
	try {
		targetStat = await fsp.stat(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
	if (!targetStat.isFile() || targetStat.size !== stat.size) {
		throw new Error("同名本地插件归档已存在，但文件状态不一致。");
	}
	const targetHash = createHash("sha256")
		.update(await fsp.readFile(target))
		.digest("hex");
	if (targetHash !== hash) {
		throw new Error("同名本地插件归档已存在，但文件内容不一致。");
	}
	return true;
}

/** 移动打包产物到最终归档位置（目标已就绪则跳过，竞态时重试校验）。 */
async function installArchiveToTarget(
	packedFile: string,
	target: string,
	stat: Stats,
	hash: string,
) {
	if (await validateExistingTarget(target, stat, hash)) return;
	try {
		await fsp.rename(packedFile, target);
	} catch (error) {
		if (!(await validateExistingTarget(target, stat, hash))) throw error;
	}
}

/** 本地插件绑定准备：校验依赖 → npm pack → 哈希命名 → 原子落位 .yarn/local。 */
export async function prepareLocalBinding(
	deps: LocalBindingPrepareDeps,
	name: string,
): Promise<LocalBindingResult> {
	const packageSnapshot = await snapshotPackageManifest(deps.cwd);
	const depCache = deps.resolver.getDeps({
		background: false,
	}) as Dict<Dependency>;
	const dependency = assertBindableDependency(name, packageSnapshot, depCache);
	const { manifestFile } = await readLocalPluginManifest(
		deps,
		name,
		dependency.resolved,
	);
	const sourceDir = dirname(manifestFile);

	const destination = resolve(deps.cwd, ".yarn", "local");
	await fsp.mkdir(destination, { recursive: true });
	const temporary = await fsp.mkdtemp(
		resolve(destination, ".market-next-pack-"),
	);
	try {
		const { pack, packedFile, stat } = await packLocalPluginArchive(
			deps,
			name,
			dependency.resolved,
			sourceDir,
			temporary,
		);
		const { hash, filename, target } = await resolveFinalArchive(
			pack,
			packedFile,
			destination,
		);
		await installArchiveToTarget(packedFile, target, stat, hash);
		deps.log.info(
			`local plugin source prepared: ${name}@${dependency.resolved}, file=${filename}, size=${pack.size}`,
		);
		return {
			request: createLocalBindingRequest(filename),
			filename,
			size: pack.size,
		};
	} finally {
		// 无论成败都清掉打包临时目录:产物要么已 rename 走,要么作废,不留垃圾
		await fsp.rm(temporary, { recursive: true, force: true }).catch((error) => {
			deps.log.debug(
				`failed to remove local binding temp directory ${temporary}: ${error instanceof Error ? error.message : error}`,
			);
		});
	}
}
