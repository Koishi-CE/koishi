/**
 * @file 本地上传/绑定服务门面(core/install/sources 域)。
 *
 * 职责:把 upload 域的 LocalPackageUploadStore(分块上传会话)与
 * prepareLocalBinding(本地插件打包绑定)包装成安装域对外的统一服务;
 * finishLocalPackageUpload 额外结合当前 package.json 与依赖缓存生成
 * 预览信息(操作语义、风险脚本提示)。
 *
 * 架构位置:被 node/installer 持有并映射为 console RPC;真正逻辑在
 * core/upload 域,本层只做组合与"当前状态"补充。
 */
import type { Dict } from "@koishi-ce/koishi";
import type { DependencyResolver } from "../../deps/resolver.js";
import type { Dependency } from "../../deps/types.js";
import { prepareLocalBinding } from "../../upload/local-binding.js";
import type { LocalPackageUploadStore } from "../../upload/session.js";
import {
	getLocalPackageOperation,
	type LocalPackageUploadChunkRequest,
	type LocalPackageUploadCommitResult,
	type LocalPackageUploadFinishRequest,
	type LocalPackageUploadPreview,
	type LocalPackageUploadProgress,
	type LocalPackageUploadStartRequest,
	type LocalPackageUploadStartResult,
} from "../../upload/types.js";
import type { InstallLogger, LocalBindingResult } from "../types.js";
import { snapshotPackageManifest } from "./manifest-restore.js";

/** 上传/绑定服务的依赖面:cwd、日志、超时、上传会话存储与依赖解析器。 */
export interface LocalPackageUploadServiceDeps {
	/** 宿主工作目录 */
	cwd: string;
	/** 安装日志通道 */
	log: InstallLogger;
	/** npm pack 超时(毫秒) */
	timeout?: number | undefined;
	/** 分块上传会话存储 */
	uploads: LocalPackageUploadStore;
	/** 依赖解析器(取当前已装版本,拼预览) */
	resolver: DependencyResolver;
}

/** 本地 .tgz 上传会话门面 + 本地插件绑定入口（绑定实现在 upload/local-binding.js）。 */
export class LocalPackageUploadService {
	private readonly deps: LocalPackageUploadServiceDeps;

	constructor(deps: LocalPackageUploadServiceDeps) {
		this.deps = deps;
	}

	/** 开始一次上传(透传 LocalPackageUploadStore.start)。 */
	startLocalPackageUpload(
		request: LocalPackageUploadStartRequest,
	): Promise<LocalPackageUploadStartResult> {
		return this.deps.uploads.start(request);
	}

	/** 追加一个分块(透传 LocalPackageUploadStore.append)。 */
	appendLocalPackageUpload(
		request: LocalPackageUploadChunkRequest,
	): Promise<LocalPackageUploadProgress> {
		return this.deps.uploads.append(request);
	}

	/** 提交落盘(透传 LocalPackageUploadStore.commit)。 */
	commitLocalPackageUpload(
		uploadId: string,
	): Promise<LocalPackageUploadCommitResult> {
		return this.deps.uploads.commit(uploadId);
	}

	/** 取消上传(透传 LocalPackageUploadStore.cancel)。 */
	cancelLocalPackageUpload(uploadId: string) {
		return this.deps.uploads.cancel(uploadId);
	}

	/**
	 * 完成上传并生成预览:在解包校验结果之上,叠加 package.json 里该包的
	 * 当前请求、依赖缓存中的已装版本、manifest 里的安装脚本名单,并推导
	 * 操作语义(install/upgrade/downgrade/replace),供前端确认页展示。
	 */
	async finishLocalPackageUpload(
		request: LocalPackageUploadFinishRequest,
	): Promise<LocalPackageUploadPreview> {
		const result = await this.deps.uploads.finish(request);
		const snapshot = await snapshotPackageManifest(this.deps.cwd);
		const currentRequest = snapshot.dependencies[result.manifest.name];
		const depCache = this.deps.resolver.getDeps({
			background: false,
		}) as Dict<Dependency>;
		const currentVersion = depCache[result.manifest.name]?.resolved;
		// 只挑有副作用风险的安装期生命周期脚本,用于前端的安全提示
		const scripts = Object.keys(result.manifest.scripts ?? {}).filter((name) =>
			["preinstall", "install", "postinstall", "prepare"].includes(name),
		);
		return {
			uploadId: result.uploadId,
			filename: result.filename,
			name: result.manifest.name,
			version: result.manifest.version,
			description:
				typeof result.manifest.description === "string"
					? result.manifest.description
					: undefined,
			size: result.size,
			hash: result.hash,
			scripts,
			currentRequest,
			currentVersion,
			operation: getLocalPackageOperation(
				currentRequest,
				currentVersion,
				result.manifest.version,
			),
		};
	}

	/** 把已加载的本地插件打包绑定到 .yarn/local(透传 upload/local-binding)。 */
	prepareLocalBinding(name: string): Promise<LocalBindingResult> {
		return prepareLocalBinding(this.deps, name);
	}
}
