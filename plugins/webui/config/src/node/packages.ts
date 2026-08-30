/**
 * PackageProvider 的 Node 端实现：基于 LocalScanner 扫描本机
 * node_modules 中的插件包，并在扫描过程中顺带解析已加载插件的
 * 运行时信息写入共享 cache。
 *
 * 本仓库 koishi.yml 的插件键统一是相对路径（./plugins/...），而 Bun
 * 不会把未被依赖的 workspace 包链入 node_modules，仅靠 LocalScanner
 * 会漏掉大部分源码包——因此 collect 时额外按配置键逐个加载
 * workspace 包，并写入 paths（配置键 → 包名映射，供前端解析插件名）。
 */
import { resolve } from "node:path";
import { Logger } from "@koishi-ce/koishi";
import { getPluginShortname, LocalScanner } from "@koishi-ce/registry";
import * as shared from "../shared/index.ts";

const logger = new Logger("config");

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
			// require.resolve(name) 的结果可能与 require.resolve(path) 不同,
			// 因为 tsconfig-paths 可能以不同方式解析路径
			const entry = require.resolve(name);
			if (require.cache[entry]) {
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
	 * 递归遍历 loader 配置的插件表（分组键的值内嵌套插件表），收集
	 * 其中以相对路径键引用的 workspace 源码包：按目录读取 package.json
	 * 生成数据条目，已存在于 node_modules 扫描结果中的包则就地合并
	 * paths 字段，避免同名条目重复。
	 */
	private async collectWorkspacePackages(): Promise<
		shared.PackageProvider.Data[]
	> {
		// 以完整包名为键索引全部条目（浅拷贝，避免跨 forced 扫描累积 paths）
		const index = new Map<string, shared.PackageProvider.Data>();
		for (const object of this.scanner.objects) {
			index.set(object.package.name, { ...object, paths: [] });
		}
		try {
			await walkPlugins(
				this.ctx.loader?.config?.plugins as Record<string, unknown> | undefined,
				async (key) => {
					// 配置键形如 ./plugins/webui/config:uid，取 : 前的路径部分
					const path = key.split(":", 1)[0];
					if (!path?.startsWith("./")) return;
					const object = await this.scanner.loadPath(
						resolve(this.scanner.baseDir, path),
					);
					if (!object) return;
					const name = object.package.name;
					const entry = index.get(name) ?? { ...object, paths: [] };
					entry.paths ||= [];
					if (!entry.paths.includes(path)) entry.paths.push(path);
					index.set(name, entry);
					// 登记「包名 → 配置键」反查，供 request-runtime 按路径解析
					this.pathKeys[name] ||= path;
					// 顺带解析运行时信息（loader.resolve 对路径键原生支持）
					this.cache[path] ||= await this.parseExports(path);
				},
			);
		} catch (error) {
			logger.warn(error);
		}
		return [...index.values()];
	}
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
				(value ?? {}) as Record<string, unknown> | undefined,
				handler,
			);
		} else {
			await handler(key);
		}
	}
}
