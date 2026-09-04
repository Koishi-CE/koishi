// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 远程模板分支（--template <包名>）的下载-解包-改写全流程：拉取 npm
 * registry 包元数据解析目标版本，经 giget 下载 tarball 并解包到目标
 * 目录，最后改写 package.json。HttpError 与 RegistryMeta 只在本流程
 * 消费，就近定义不另立文件；本机 registry 配置探测见 registry.ts。
 *
 * 运行期状态（argv / project / rootDir）不跨文件共享——它们留在
 * index.ts 顶层（e2e 测试以模块 query 隔离实例）；本模块所需字段一律
 * 经 RemoteOptions 显式传入，由 index.ts 的 scaffold 组装，避免子模块
 * 与顶层状态的隐式耦合。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { downloadTemplate } from "giget";
import pc from "picocolors";
import {
	type Manifest,
	renderManifest,
} from "./manifest.ts";

/** registry 包元数据中本流程消费的字段 */
interface RegistryMeta {
	"dist-tags": Record<string, string>;
	versions: Record<string, { dist?: { tarball?: string } }>;
}

/** fetch 请求非 2xx 时抛出的错误，携带 HTTP 状态码与状态文本 */
class HttpError extends Error {
	status: number;
	statusText: string;
	constructor(status: number, statusText: string) {
		super(`HTTP ${status} ${statusText}`);
		this.status = status;
		this.statusText = statusText;
	}
}

/** scaffoldRemote 的显式参数（由 index.ts 的 scaffold 组装传入） */
interface RemoteOptions {
	/** npm registry 地址（--registry > 本机配置 > 官方源，已去尾斜杠） */
	registry: string;
	/** 模板包名（--template <包名>） */
	template: string;
	/** 版本引用（--ref，默认 latest） */
	ref: string;
	/** 生产模式（改写 package.json 时移除 devDependencies / workspaces） */
	prod: boolean;
	/** 项目名（写入生成项目 package.json 的 name） */
	project: string;
	/** 目标目录绝对路径 */
	rootDir: string;
}

/**
 * 远程模板下载与解包：
 * 1. 拉取模板包元数据，按 dist-tags 解析目标版本（ref，默认 latest）；
 * 2. 下载 tarball 并解包到目标目录（解包走 giget，其按 npm tarball 惯例
 *    剥离顶层 package/ 目录，等价于 strip: 1），网络错误统一以 HttpError
 *    提示后退出；
 * 3. 最后改写 package.json。
 */
export async function scaffoldRemote({
	registry,
	template,
	ref,
	prod,
	project,
	rootDir,
}: RemoteOptions) {
	try {
		const metaRes = await fetch(`${registry}/${template}`);
		if (!metaRes.ok)
			throw new HttpError(
				metaRes.status,
				metaRes.statusText,
			);
		const remote = (await metaRes.json()) as RegistryMeta;
		const version = remote["dist-tags"][ref];
		if (version === undefined) {
			throw new HttpError(
				404,
				`模板 ${template}@${ref} 不存在`,
			);
		}
		const url = remote.versions[version]?.dist?.tarball;
		if (url === undefined) {
			throw new HttpError(
				404,
				`模板 ${template}@${ref} 不存在`,
			);
		}

		// 解包交给 giget：provider 的 tar 字段是函数，giget 需要时才发起
		// 下载（HttpError 在下载阶段抛出，不经 giget 包装可直接识别）；
		// giget 先把 tarball 落入本地缓存再解压到 rootDir，解压失败
		// （gzip 损坏 / 归档截断）走下方非 HttpError 分支原样上抛。
		await downloadTemplate(template, {
			provider: "npm",
			providers: {
				npm: async () => ({
					name: template,
					version,
					tar: async () => {
						const tarballRes = await fetch(url);
						if (!tarballRes.ok || !tarballRes.body) {
							throw new HttpError(
								tarballRes.status,
								tarballRes.statusText,
							);
						}
						return tarballRes.body;
					},
				}),
			},
			dir: rootDir,
		});
	} catch (err) {
		if (!(err instanceof HttpError)) throw err;
		console.log(
			`${pc.red("error")} 请求失败：HTTP ${err.status} ${err.statusText}`,
		);
		process.exit(1);
	}

	writePackageJson(rootDir, project, prod);
}

/** 把改写结果写回下载解包出的 package.json */
function writePackageJson(
	rootDir: string,
	project: string,
	prod: boolean,
) {
	const filename = join(rootDir, "package.json");
	const meta = JSON.parse(
		readFileSync(filename, "utf8"),
	) as Manifest;
	writeFileSync(
		filename,
		renderManifest(meta, project, prod),
	);
}
