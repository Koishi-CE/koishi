/**
 * 插件市场扫描器（apps/registry）的类型定义：覆盖 npm registry 协议里
 * 用到的各层数据结构——package.json（本地与远程形态）、Koishi 清单
 * （manifest，来自 package.json 的 koishi 字段与约定关键词）、搜索结果
 * 与最终产出的 SearchObject。Scanner（index.ts）与 LocalScanner
 * （local.ts）共用这套类型。
 */
import type { Dict } from "cosmokit";

/** 包作者 / 维护者信息（npm registry 的 User 结构） */
export interface User {
	name?: string;
	email: string;
	url?: string;
	username?: string;
}

/** 包的基础标识：名称、版本、描述 */
export interface BasePackage {
	name: string;
	version: string;
	description: string;
}

/** package.json 中四类依赖字段名 */
export type DependencyKey =
	| "dependencies"
	| "devDependencies"
	| "peerDependencies"
	| "optionalDependencies";
/** 远程清单上额外关心的元信息字段名（SearchPackage 从 RemotePackage 挑选的部分） */
export type DependencyMetaKey =
	| "deprecated"
	| "peerDependencies"
	| "peerDependenciesMeta";

/** package.json 的结构（只声明扫描器关心的字段） */
export interface PackageJson
	extends BasePackage,
		Partial<Record<DependencyKey, Record<string, string>>> {
	main?: string;
	module?: string;
	browser?: string;
	bin?: string | Dict<string>;
	scripts?: Dict<string>;
	exports?: PackageJson.Exports;
	/** Koishi 插件清单字段（manifest 的原始来源） */
	koishi?: Partial<Manifest>;
	keywords: string[];
	engines?: Dict<string>;
	os?: string[];
	cpu?: string[];
	overrides?: Dict<PackageJson.Overrides>;
	peerDependenciesMeta?: Dict<PackageJson.PeerMeta>;
}

export namespace PackageJson {
	export type Exports = string | { [key: string]: Exports };
	export type Overrides = string | { [key: string]: Overrides };

	/** peer 依赖的附加标记（如 optional 声明可选） */
	export interface PeerMeta {
		optional?: boolean;
	}
}

/** 内联 SVG 图标（市场卡片展示用，manifest.icon 的形态） */
export interface IconSvg {
	type: "svg";
	viewBox: string;
	pathData: string;
}

/**
 * Koishi 插件清单：从 package.json 的 koishi 字段与约定关键词（如
 * required:* / market:hidden）汇总而来，由 utils.ts 的 conclude() 产出。
 */
export interface Manifest {
	icon?: IconSvg;
	/** 是否在市场中隐藏 */
	hidden?: boolean;
	/** 是否为预览（未完成 / 不稳定）的插件 */
	preview?: boolean;
	/** 是否存在安全风险（如仍依赖已废弃的 cqhttp） */
	insecure?: boolean;
	/** 是否提供浏览器端功能（控制台扩展） */
	browser?: boolean;
	category?: string;
	/** 控制台扩展公开的导入路径列表 */
	public?: string[];
	exports?: Dict<string>;
	/** 插件描述，可为多语言字典 */
	description: string | Dict<string>;
	/** 插件的服务依赖与实现声明 */
	service: Manifest.Service;
	/** 支持的语言列表 */
	locales: string[];
}

export namespace Manifest {
	/** 服务声明：require / optional 为依赖的服务，implements 为提供的服务 */
	export interface Service {
		required: string[];
		optional: string[];
		implements: string[];
	}
}

/** 远程 registry 上某个版本的完整清单（含发布元信息） */
export interface RemotePackage extends PackageJson {
	deprecated?: string;
	author?: User;
	contributors?: User[];
	maintainers: User[];
	license: string;
	dist: RemotePackage.Dist;
}

export namespace RemotePackage {
	/** tarball 的分发信息（校验和、体积等） */
	export interface Dist {
		shasum: string;
		integrity: string;
		tarball: string;
		fileCount: number;
		unpackedSize: number;
	}
}

/** registry `/<pkg>` 端点返回的完整包文档：全版本清单与各版本发布时间 */
export interface Registry extends BasePackage {
	versions: Dict<RemotePackage>;
	time: Dict<string>;
	license: string;
	readme: string;
	readmeFilename: string;
}

/** 带发布时间的包（搜索端点的条目形态） */
export interface DatedPackage extends BasePackage {
	date: string;
}

/** registry `/-/v1/search` 端点返回的单条包数据 */
export interface SearchPackage
	extends DatedPackage,
		Pick<RemotePackage, DependencyMetaKey> {
	// npmmirror 的搜索结果里没有 `links` 字段
	links?: Dict<string>;
	author?: User;
	contributors?: User[];
	keywords: string[];
	publisher: User;
	maintainers: User[];
	// 仅 npmmirror 返回的字段
	versions?: string[];
	"dist-tags"?: Dict<string>;
}

/**
 * 市场扫描产出的插件对象：在搜索命中的包数据上叠加分析结果
 * （短名、manifest、时间、下载量等展示字段）。
 */
export interface SearchObject {
	/** 去掉 koishi-plugin- / @koishijs/plugin- 前缀后的短名 */
	shortname: string;
	package: SearchPackage;
	searchScore: number;
	score: Score;
	rating: number;
	/** 是否为官方（@koishijs/plugin-*）插件 */
	verified?: boolean;
	deprecated?: boolean;
	/** 是否为本机 workspace 直连的包（LocalScanner 填充） */
	workspace?: boolean;
	category?: string;
	portable?: boolean;
	insecure?: boolean;
	/** 分析失败或无兼容版本时标记跳过（analyze 阶段写入） */
	ignored?: boolean;
	license: string;
	manifest: Manifest;
	createdAt: string;
	updatedAt: string;
	publishSize?: number;
	installSize?: number;
	downloads?: {
		lastMonth: number;
	};
}

/** npm 评分（quality / popularity / maintenance 加权出 final） */
export interface Score {
	final: number;
	detail: Score.Detail;
}

export namespace Score {
	export interface Detail {
		quality: number;
		popularity: number;
		maintenance: number;
	}
}

/** 一次扫描的结果集：总数、采集时间与全部插件对象 */
export interface SearchResult {
	total: number;
	time: string;
	objects: SearchObject[];
	version?: number;
	forceTime?: number;
}
