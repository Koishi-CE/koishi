import type { Dict } from "@koishi-ce/koishi";

/**
 * 插件捆绑包（plugin bundle / 合包）清单的类型定义与命名约定常量。
 *
 * 合包约定：一个 npm 包通过 package.json 里的 `koishi.bundle` 字段声明一组
 * 插件成员（各自的包名/插件键/版本范围/预置配置），并以关键字 `market:package`
 * 与 `koishi-plugin-pa-*` 命名互相印证。安装合包时按成员逐项安装并把配置
 * 写入 koishi.yml 的 `group:pa-*` 分组（分组标识派生见 bundle-idents.ts）。
 *
 * 架构位置：位于 shared 共享语言层，node 端（market/bundle.ts 安装编排、
 * 契约校验 zod）与 client 端（bundle-install 对话框的成员勾选/冲突展示）
 * 引用同一份类型，避免两端对清单规则的理解漂移。
 * 本文件只有类型与常量，无任何 I/O；解析与校验函数族见 bundle-validate.ts，
 * 敏感配置扫描（scanSensitiveConfig）因同样服务于合包配置，放在 bundle-idents.ts。
 */

/** 合包清单中的单个成员（包名 package.json 内 koishi.bundle.members 的结构化形态）。 */
export interface PluginBundleMember {
	/** 成员插件的 npm 包名（必须小写且符合 Koishi 插件包命名） */
	package: string;
	/** 插件在配置文件中使用的键名（koishi.yml plugins 下的键，如 "chat"） */
	plugin: string;
	/** 成员的 semver 版本范围（如 ^1.0.0） */
	version: string;
	/** 是否必装成员（client 默认勾选且不可取消） */
	required?: boolean | undefined;
	/** 预置的插件配置（安装时可作为初始配置写入） */
	config?: Dict | undefined;
}

/** 合包清单（package.json 的 koishi.bundle 字段解析结果）。 */
export interface PluginBundleManifest {
	/** 展示名（写入配置分组的 $label） */
	label?: string | undefined;
	/** 合包描述 */
	description?: string | undefined;
	/** 成员列表（校验要求非空） */
	members: PluginBundleMember[];
}

/** 合包清单校验结果。 */
export interface PluginBundleValidation {
	/** 是否通过校验（无 error 即通过，warning 不影响） */
	valid: boolean;
	/** 阻断性错误列表（命名/结构/成员字段不合法） */
	errors: string[];
	/** 非阻断性警告列表（缺关键字、重复包名、插件键可能冲突等） */
	warnings: string[];
}

/** 安装后持久化的成员记录（PluginBundleRecord.members 的元素，记录当时的安装状态）。 */
export interface PluginBundleRecordMember extends PluginBundleMember {
	/** 安装时是否勾选 */
	selected: boolean;
	/** 是否因本次合包安装而新装（此前 package.json 中不存在） */
	installedByBundle?: boolean | undefined;
	/** 是否为它写入了插件配置 */
	configured?: boolean | undefined;
	/** 已有配置是否被移动进了合包分组 */
	moved?: boolean | undefined;
	/** 是否被跳过（已有可用配置等原因未处理） */
	skipped?: boolean | undefined;
	/** 是否应用了清单预置配置 */
	usePreset?: boolean | undefined;
}

/** 合包安装记录（写入 MarketDataStore，供后续卸载/展示回放）。 */
export interface PluginBundleRecord {
	/** 合包 npm 包名 */
	package: string;
	/** 安装的合包版本 */
	version: string;
	/** 展示名（来自清单 label） */
	label?: string | undefined;
	/** 对应 koishi.yml 的分组键（group:pa-*，无则为 undefined） */
	groupKey?: string | undefined;
	/** 安装时间戳（Date.now()） */
	installedAt: number;
	/** 成员安装状态明细 */
	members: PluginBundleRecordMember[];
}

/** 安装请求中的成员（client 勾选后的形态，在清单成员之上补充安装选项）。 */
export interface BundleInstallMember extends PluginBundleMember {
	/** 是否勾选安装（未勾选的成员不参与安装） */
	selected: boolean;
	/** 是否为其创建插件配置（组内已有配置时无意义） */
	createConfig: boolean;
	/** 是否使用清单里的预置 config 作为初始配置 */
	usePreset: boolean;
	/** 与本地现状的冲突类别：组内已有配置 / 组外已有配置 / 已装版本不满足范围 */
	conflict?: "same-group" | "other-config" | "package-mismatch";
	/** 是否把组外已有配置移动进合包分组 */
	move?: boolean;
}

/** 合包安装请求（market/bundle-install RPC 的载荷）。 */
export interface BundleInstallRequest {
	/** 合包 npm 包名 */
	package: string;
	/** 要安装的合包版本（用于从 registry 元数据取清单） */
	version: string;
	/** 解析后的合包清单（服务端会重新解析校验，不直接信任此字段） */
	bundle: PluginBundleManifest;
	/** client 侧勾选完成的成员选项 */
	members: BundleInstallMember[];
}

/** 合包安装结果。 */
export interface BundleInstallResult {
	/** 包管理器退出码（0 为成功） */
	code: number;
	/** 参与安装的包名（合包自身 + 勾选成员） */
	installed: string[];
	/** 写入了插件配置的成员包名 */
	configured: string[];
	/** 已有配置被移动进分组的成员包名 */
	moved: string[];
	/** 被跳过配置写入的成员包名 */
	skipped: string[];
	/** koishi.yml 分组键（group:pa-*） */
	groupKey?: string | undefined;
	/** 安装成功时生成的安装记录（失败为 undefined） */
	record?: PluginBundleRecord | undefined;
}

/** 移除合包配置请求（卸载/管理场景，只清配置不动依赖）。 */
export interface BundleConfigRemoveRequest {
	/** 合包 npm 包名（用于定位分组键） */
	package: string;
	/** 要移除的成员；缺省表示移除全部分组成员 */
	members?: Array<Pick<PluginBundleMember, "package" | "plugin">>;
	/** 成员清空后是否连带删除空分组（默认 true） */
	removeEmptyGroup?: boolean;
}

/** 移除合包配置结果。 */
export interface BundleConfigRemoveResult {
	/** 被操作的分组键（找不到分组时为 undefined） */
	groupKey?: string | undefined;
	/** 被移除的配置键列表 */
	removed: string[];
	/** 分组本身是否被整体删除 */
	removedGroup?: boolean;
}

/** 标识合包的 package.json 关键字（与命名约定共同构成合包识别依据）。 */
export const BUNDLE_KEYWORD = "market:package";

/** 合包命名约定：koishi-plugin-pa-*（pa = package bundle），可带 @scope。 */
export const BUNDLE_PACKAGE_RE =
	/^(?:@[0-9a-z-]+\/)?koishi-plugin-pa-[0-9a-z-]+$/;

/** 合法 Koishi 插件包名：普通 koishi-plugin-* 或官方 @koishijs/plugin-*。 */
export const PLUGIN_PACKAGE_RE =
	/^(?:@[^/]+\/)?koishi-plugin-[0-9a-z-]+$|^@koishijs\/plugin-[0-9a-z-]+$/;
