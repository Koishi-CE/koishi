// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * PackageProvider 的 Node 端实现：基于 LocalScanner 扫描本机
 * node_modules 中的插件包，并在扫描过程中顺带解析已加载插件的
 * 运行时信息写入共享 cache。
 *
 * 本仓库 koishi.yml 的插件键统一是相对路径（./plugins/...），而 Bun
 * 不会把未被依赖的 workspace 包链入 node_modules，仅靠 LocalScanner
 * 会漏掉大部分源码包——因此 collect 时额外按配置键逐个加载
 * workspace 包，并写入 paths（配置键 → 包名映射，供前端解析插件名）；
 * 未启用的包（含嵌套 monorepo 子包）则按 workspaces 声明展开收录。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Logger } from "@koishi-ce/koishi";
import {
	getPluginShortname,
	isResidentInCache,
	LocalScanner,
} from "@koishi-ce/registry";
import * as shared from "../shared/index.ts";

const logger = new Logger("config");

/** 插件包名的收录口径：只认三种插件命名前缀（与 LocalScanner 一致） */
const PLUGIN_NAME_PATTERN =
	/^(koishi-plugin-|@koishi(?:-ce)?\/plugin-)/;

/** 宿主未声明 workspaces 时的兜底约定（模板默认布局） */
const FALLBACK_WORKSPACES = ["plugins/*", "external/*"];

/**
 * 本机插件扫描器：在 LocalScanner 的基础上扩展 parsePackage，
 * 让"扫描到某个包"与"解析该插件的运行时信息"在同一次遍历中完成。
 */
class PackageScanner extends LocalScanner {
	private service: shared.PackageProvider;

	constructor(service: shared.PackageProvider) {
		super(service.ctx.baseDir);
		this.service = service;
	}

	/** 单个包解析失败时仅记录警告，不中断整体扫描。 */
	override async onError(error: unknown, name: string) {
		logger.warn("failed to resolve %c", name);
		logger.warn(error);
	}

	/**
	 * 解析包元数据后，若该插件的入口模块已被 require 进内存，
	 * 则顺带解析其导出并写入服务缓存，供前端立即取用。
	 */
	override async parsePackage(name: string) {
		const result = await super.parsePackage(name);
		try {
			// 驻留判断不能用 require.resolve(name)：裸名形态可能已被市场
			// 安装前的探测写入 Bun 的父目录快照缓存（装完插件后同进程内
			// 必然失败，生产上报 "failed to resolve" 假警的根因）。改用
			// isResidentInCache：纯 fs 取包目录 + require.cache 前缀扫描，
			// 全程不触碰解析 API（比「入口模块驻留」稍宽：包目录下任何
			// 模块驻留即视为可预热，多一次 parseExports 无副作用）。
			if (isResidentInCache(name)) {
				const shortname = getPluginShortname(name);
				this.service.cache[shortname] =
					await this.service.parseExports(shortname);
			}
		} catch (error) {
			void this.onError(error, name);
		}
		return result;
	}
}

/** Node 端包提供器：collect 委托给本机扫描器，并补齐 workspace 源码包。 */
export class PackageProvider extends shared.PackageProvider {
	scanner = new PackageScanner(this);

	/**
	 * 扫描本机插件包并返回扫描结果。
	 *
	 * @param forced 为 true 时强制重新扫描（不走缓存）
	 */
	async collect(forced: boolean) {
		await this.scanner.collect(forced);
		return this.collectWorkspacePackages();
	}

	/**
	 * 收集全部 workspace 源码包：koishi.yml 已有相对路径键引用的（已启用）
	 * 加上 workspaces 声明覆盖的（可能尚未启用，含嵌套 monorepo 子包）。
	 */
	private async collectWorkspacePackages(): Promise<
		shared.PackageProvider.Data[]
	> {
		// 以完整包名为键索引全部条目（浅拷贝，避免跨 forced 扫描累积 paths）
		const index = new Map<
			string,
			shared.PackageProvider.Data
		>();
		for (const object of this.scanner.objects) {
			index.set(object.package.name, {
				...object,
				paths: [],
			});
		}
		/**
		 * 收录一个相对路径引用的 workspace 包：合并 paths、登记
		 * 「包名 → 配置键」反查；warm 控制是否预热运行时缓存。
		 */
		const addPath = async (path: string, warm: boolean) => {
			const object = await this.scanner.loadPath(
				resolve(this.scanner.baseDir, path),
			);
			if (!object) return;
			const name = object.package.name;
			const entry = index.get(name) ?? {
				...object,
				paths: [],
			};
			entry.paths ||= [];
			if (!entry.paths.includes(path))
				entry.paths.push(path);
			index.set(name, entry);
			// 登记「包名 → 配置键」反查，供 request-runtime 按路径解析
			this.pathKeys[name] ||= path;
			// 顺带解析运行时信息（loader.resolve 对路径键原生支持）。
			// 已启用插件的模块本来就在 require.cache，预热无副作用；
			// 未启用的 external 包不做预热——require 会提前求值模块，
			// 其 peer 缺失时产生告警噪音，运行时信息留待前端选中时
			// 经 request-runtime 按需解析
			if (warm)
				this.cache[path] ||= await this.parseExports(path);
		};
		try {
			await walkPlugins(
				this.ctx.loader?.config?.plugins as
					| Record<string, unknown>
					| undefined,
				async (key) => {
					// 配置键形如 ./plugins/webui/config:uid，取 : 前的路径部分
					const path = key.split(":", 1)[0];
					if (!path?.startsWith("./")) return;
					await addPath(path, true);
				},
			);
			await this.collectWorkspacePlugins(addPath);
		} catch (error) {
			logger.warn(error);
		}
		return [...index.values()];
	}

	/**
	 * 收集 workspaces 声明覆盖的未启用插件包（嵌套 monorepo 兼容）。
	 *
	 * 以宿主 package.json 的 workspaces 通配为唯一真相源：声明写多深，
	 * 收录就能看多深——external/ 下克隆的 monorepo 形态插件（packages/
	 * 子包在二级及更深）无需平铺即可见。Bun 只把被依赖引用的 workspace
	 * 包链入 node_modules，未启用的插件不在本机扫描视野内（yarn 全量
	 * 链接生态的自动发现语义失效），这里是唯一补齐入口。
	 *
	 * 通配是目录模式，拼上 /package.json 以清单文件为锚点扫描
	 * （Bun.Glob 的 onlyDirs 语义不可靠，win32 实测返回文件路径且分隔符
	 * 为反斜杠，归一为 / 后再派生收录键）；负向模式（! 前缀）同样拼
	 * 锚点后对正向结果做差集——模板对 external 下 node_modules 的负向
	 * 通配即用于排除搬迁残留的依赖目录（注释里不写通配字面量，
	 * biome 会把其中的 JSDoc 起始序列误解析成类型）。收录口径与
	 * LocalScanner 的本机扫描一致：只认三种插件命名前缀，monorepo
	 * 根（@scope/monorepo 形态）与普通库不进列表；收录键
	 * ./<相对路径>（loader 的相对路径解析原生支持任意深度）。
	 */
	private async collectWorkspacePlugins(
		addPath: (path: string, warm: boolean) => Promise<void>,
	) {
		const baseDir = this.scanner.baseDir;
		const patterns = readWorkspacePatterns(baseDir);
		// 目录通配 → 清单文件锚点（去尾斜杠后拼接；负向模式去掉 ! 前缀）
		const anchor = (pattern: string) =>
			`${pattern.replace(/\/+$/, "")}/package.json`;
		const excluded = new Set<string>();
		for (const pattern of patterns) {
			if (!pattern.startsWith("!")) continue;
			for (const rel of new Bun.Glob(
				anchor(pattern.slice(1)),
			).scanSync({ cwd: baseDir })) {
				excluded.add(normalizeSlashes(rel));
			}
		}
		const seen = new Set<string>();
		for (const pattern of patterns) {
			if (pattern.startsWith("!")) continue;
			for (const rel of new Bun.Glob(
				anchor(pattern),
			).scanSync({ cwd: baseDir })) {
				const manifestPath = normalizeSlashes(rel);
				if (
					excluded.has(manifestPath) ||
					seen.has(manifestPath)
				)
					continue;
				seen.add(manifestPath);
				try {
					const manifest = JSON.parse(
						readFileSync(
							join(baseDir, manifestPath),
							"utf8",
						),
					) as { name?: unknown };
					if (
						typeof manifest.name !== "string" ||
						!PLUGIN_NAME_PATTERN.test(manifest.name)
					)
						continue;
					await addPath(
						`./${dirname(manifestPath)}`,
						false,
					);
				} catch (error) {
					logger.warn(error);
				}
			}
		}
	}
}

/**
 * 读取宿主 package.json 的 workspaces 通配声明；缺失、非数组（如 yarn
 * no-hoist 的对象形态）或为空时回退模板默认约定——旧项目与 prod 形态
 * （workspaces 已被脚手架删除）的一级目录可见性不回退。
 */
export function readWorkspacePatterns(
	baseDir: string,
): string[] {
	try {
		const manifest = JSON.parse(
			readFileSync(join(baseDir, "package.json"), "utf8"),
		) as { workspaces?: unknown };
		if (Array.isArray(manifest.workspaces)) {
			const patterns = manifest.workspaces.filter(
				(pattern): pattern is string =>
					typeof pattern === "string",
			);
			if (patterns.length) return patterns;
		}
	} catch {
		// 无宿主清单（异常环境）：走兜底约定
	}
	return FALLBACK_WORKSPACES;
}

/** Bun.Glob 的 scan 在 win32 返回反斜杠分隔的相对路径，统一归一为 / */
function normalizeSlashes(path: string): string {
	return path.split("\\").join("/");
}

/**
 * 递归遍历插件配置表并对每个插件键执行回调：`$` 开头的键是内部控制
 * 字段，`group:` 分组键的值内嵌套下一层插件表，其余键原样传入回调。
 */
async function walkPlugins(
	plugins: Record<string, unknown> | undefined,
	handler: (key: string) => Promise<void>,
) {
	for (const key of Object.keys(plugins ?? {})) {
		if (key.startsWith("$")) continue;
		if (key.split(":", 1)[0] === "group") {
			const value = plugins?.[key];
			await walkPlugins(
				(value ?? {}) as
					| Record<string, unknown>
					| undefined,
				handler,
			);
		} else {
			await handler(key);
		}
	}
}
