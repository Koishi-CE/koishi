/**
 * @file 模块扩充声明:把本插件的 Installer 与 console 服务/RPC 事件
 * 合入 koishi 与 @koishi-ce/console 的全局类型。
 *
 * 模块职责:
 * - declare module "@koishi-ce/core":Context 上挂 installer 服务,使
 *   ctx.installer.* 在全部 node 代码中获得完整类型;
 * - declare module "@koishi-ce/console":Services 增补四个 DataService 键
 *   (dependencies/registry/registryStatus/marketData),Events 增补全部
 *   market/* RPC 的入参/返回签名——这是 console 前后端 RPC 的单一契约源,
 *   listeners 的实现必须与这里的签名一致。
 *
 * 关键设计:契约类型只在这里集中声明(类型从 core/shared 导入),listener
 * 文件与前端 client 共享同一份签名,避免两处漂移。
 *
 * 架构位置:node 适配层根文件,仅类型、无运行时代码,被 setup/listeners
 * 隐式依赖(编译期生效)。
 */
// 宿主 @koishi-ce/plugin-config 提供 packages/services/config 三个 Console 服务的
// 类型声明（Services 键），setup/listeners 中多处 refresh('packages')/refresh('config') 依赖它

import type { Dict } from "@koishi-ce/koishi";
import type {} from "@koishi-ce/plugin-config";
import type {
	DependencyMetaKey,
	Registry,
	RemotePackage,
} from "@koishi-ce/registry";
import type { EnvironmentSnapshotPreview } from "../core/environment/diff.js";
import type { EnvironmentSnapshotSummary } from "../core/environment/snapshot.js";
import type {
	InstallHistoryEntry,
	InstallLogDetail,
	InstallOptions,
	LocalBindingResult,
} from "../core/install/types.js";
import type {
	LocalPackageUploadChunkRequest,
	LocalPackageUploadCommitResult,
	LocalPackageUploadFinishRequest,
	LocalPackageUploadPreview,
	LocalPackageUploadProgress,
	LocalPackageUploadStartRequest,
	LocalPackageUploadStartResult,
} from "../core/upload/types.js";
import type {
	BundleConfigRemoveRequest,
	BundleConfigRemoveResult,
	BundleInstallRequest,
	BundleInstallResult,
} from "../shared/bundle.js";
import type { InstallFallbackCandidate } from "../shared/types.js";
import type { AvatarFetchResult } from "./avatar/index.js";
import type { Config } from "./config/index.js";
import type {
	DependencyProvider,
	RegistryProvider,
	RegistryStatusProvider,
} from "./console/providers.js";
import type { Installer } from "./installer/index.js";
import type {
	MarketDataStore,
	MarketDataStorePayload,
} from "./market/data-store.js";

declare module "@koishi-ce/core" {
	interface Context {
		/** 本插件在 apply 时注入的安装/依赖管理服务(installer/index.ts)。 */
		installer: Installer;
	}
}

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			/** 依赖快照通道(console/providers.ts)。 */
			dependencies: DependencyProvider;
			/** registry 包版本元数据全量缓存通道。 */
			registry: RegistryProvider;
			/** npm 端点状态通道。 */
			registryStatus: RegistryStatusProvider;
			/** marketData:override/忽略规则/合包记录/折叠状态(market/data-store.ts)。 */
			marketData: MarketDataStore;
		}
	}

	/** market/* RPC 事件契约:与 console/contracts.ts(zod)及 listeners 实现一一对应。 */
	interface Events {
		"market/install"(
			deps: Dict<string>,
			forced?: boolean,
			options?: InstallOptions,
		): Promise<number>;
		"market/install-bundle"(
			request: BundleInstallRequest,
			forced?: boolean,
			options?: InstallOptions,
		): Promise<BundleInstallResult>;
		"market/install-fallback-candidate"(
			failedEndpoint?: string,
		): Promise<InstallFallbackCandidate | undefined>;
		"market/install-history"(limit?: number): Promise<InstallHistoryEntry[]>;
		"market/install-history-detail"(
			id: string,
		): Promise<InstallLogDetail | undefined>;
		"market/local-package-upload-start"(
			request: LocalPackageUploadStartRequest,
		): Promise<LocalPackageUploadStartResult>;
		"market/local-package-upload-chunk"(
			request: LocalPackageUploadChunkRequest,
		): Promise<LocalPackageUploadProgress>;
		"market/local-package-upload-finish"(
			request: LocalPackageUploadFinishRequest,
		): Promise<LocalPackageUploadPreview>;
		"market/local-package-upload-commit"(
			uploadId: string,
		): Promise<LocalPackageUploadCommitResult>;
		"market/local-package-upload-cancel"(uploadId: string): Promise<boolean>;
		"market/prepare-local-binding"(name: string): Promise<LocalBindingResult>;
		"market/environment-snapshots"(): Promise<EnvironmentSnapshotSummary[]>;
		"market/environment-snapshot-preview"(
			id: string,
		): Promise<EnvironmentSnapshotPreview | undefined>;
		"market/environment-snapshot-apply"(
			id: string,
			options?: InstallOptions,
		): Promise<number>;
		"market/remove-bundle-configs"(
			request: BundleConfigRemoveRequest,
		): Promise<BundleConfigRemoveResult>;
		"market/update-config"(patch: Partial<Config>): Promise<boolean>;
		"market/update-data"(
			patch: Partial<MarketDataStorePayload>,
		): Promise<MarketDataStorePayload>;
		"market/package"(name: string): Promise<Registry | undefined>;
		"market/registry"(
			names: string[],
		): Promise<Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>>>;
		"market/ensure-config"(name: string): Promise<boolean>;
		"market/avatar"(
			key: string,
			url?: string,
		): Promise<AvatarFetchResult | undefined>;
	}
}
