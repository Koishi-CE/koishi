import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ScannerModule, {
	type DependencyMetaKey,
	type PackageJson,
	type Registry,
	type RemotePackage,
} from "@koishi-ce/registry";
import { defineProperty, pick } from "cosmokit";
import { compare, satisfies } from "semver";

// tsgo(TS7) 对 CJS 默认导出的 interface+class 合并声明解析不完整，
// 静态方法在类型上不可见（运行时存在）；这里集中收敛静态访问。
//
// 互操作坑：tsdown/rolldown 的 CJS 产物里，`import X from "cjs"` 会被
// __toESM(_, 1) 包装成 "default = 整个模块对象"，X.default 才是 Scanner 类；
// 而 vitest/ESM 直读源码时 default 导入就是 Scanner 类本身（无 .default）。
// 因此这里做防御性解包，保证两条路径都拿到真正的 Scanner 类。
type ScannerStatic = {
	isPlugin(name: string): boolean;
	isCompatible(
		range: string,
		remote: Pick<RemotePackage, "peerDependencies">,
	): boolean;
};

const RegistryExports = ScannerModule as unknown as { default?: ScannerStatic };

export const Scanner: ScannerStatic =
	RegistryExports.default ?? (ScannerModule as unknown as ScannerStatic);

export interface ScannerLike {
	objects: import("@koishi-ce/registry").SearchObject[];
	total: number;
	progress: number;
	version?: string | undefined;
	collect(config?: { timeout?: number }): Promise<void>;
	analyze(config: {
		version: string;
		onFailure?: (name: string, reason: unknown) => void;
		onRegistry?: (registry: { name: string }, versions: unknown[]) => void;
		onSuccess?: (
			object: import("@koishi-ce/registry").SearchObject,
			versions: unknown[],
		) => void;
		after?: () => void;
	}): Promise<unknown>;
}

export function createScanner(
	request: (url: string, config?: { timeout?: number }) => Promise<unknown>,
): ScannerLike {
	const ctor = (RegistryExports.default ?? ScannerModule) as unknown as new (
		request: (url: string, config?: { timeout?: number }) => Promise<unknown>,
	) => ScannerLike;
	return new ctor(request);
}

interface LocalPackage extends PackageJson {
	private?: boolean;
	$workspace?: boolean | undefined;
}

/** 读取本地已安装包的 package.json；$workspace 标记是否 workspace 包（非 node_modules 解析）。 */
export function loadManifest(name: string, baseDir?: string) {
	const resolver = baseDir
		? createRequire(resolve(baseDir, "package.json"))
		: createRequire(import.meta.url);
	const filename = resolver.resolve(`${name}/package.json`);
	const meta: LocalPackage = JSON.parse(readFileSync(filename, "utf8"));
	meta.dependencies ||= {};
	defineProperty(meta, "$workspace", !filename.includes("node_modules"));
	return meta;
}

export function resolvePackageManifest(name: string, baseDir: string) {
	const resolver = createRequire(resolve(baseDir, "package.json"));
	return resolver.resolve(`${name}/package.json`);
}

/** 版本表 → 按 semver 降序的 peer 依赖元数据摘要（fullCache 的值结构）。 */
export function getVersions(versions: RemotePackage[]) {
	return Object.fromEntries(
		versions
			.map(
				(item) =>
					[
						item.version,
						pick(item, [
							"peerDependencies",
							"peerDependenciesMeta",
							"deprecated",
						]),
					] as const,
			)
			.sort(([a], [b]) => compare(b, a)),
	);
}

/** 依赖列表里用于路由探测的探针包优先级：koishi > console > 任意插件 > 首个。 */
export function pickMetadataProbe(names: string[]) {
	return (
		names.find((name) => name === "koishi") ||
		names.find((name) => name === "@koishijs/plugin-console") ||
		names.find((name) => Scanner.isPlugin(name)) ||
		names[0]
	);
}

/** 插件短名 → 候选包名列表（@koishijs/plugin-x 与 koishi-plugin-x）。 */
export function resolvePluginName(name: string) {
	if (name.startsWith("@koishijs/plugin-")) return [name];
	if (name.match(/(^|\/)koishi-plugin-/)) return [name];
	if (name[0] === "@") {
		const [left, right] = name.split("/");
		return [`${left}/koishi-plugin-${right}`];
	}
	return [`@koishijs/plugin-${name}`, `koishi-plugin-${name}`];
}

/** registry.versions → 兼容 koishi4 的版本摘要过滤（_getPackage 的包过滤规则）。 */
export function filterCompatibleVersions(name: string, registry: Registry) {
	return getVersions(
		Object.values(registry.versions).filter((remote) => {
			if (name === "koishi") return satisfies(remote.version, "4");
			return !Scanner.isPlugin(name) || Scanner.isCompatible("4", remote);
		}),
	);
}

export type { DependencyMetaKey, PackageJson, Registry, RemotePackage };
