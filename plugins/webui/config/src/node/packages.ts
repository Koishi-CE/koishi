/**
 * PackageProvider 的 Node 端实现：基于 LocalScanner 扫描本机
 * node_modules 中的插件包，并在扫描过程中顺带解析已加载插件的
 * 运行时信息写入共享 cache。
 */
import { Logger } from "@koishi-ce/koishi";
import { LocalScanner } from "@koishi-ce/registry";
import * as shared from "../shared";

const logger = new Logger("config");

/**
 * 本机插件扫描器：在 LocalScanner 的基础上扩展 parsePackage，
 * 让"扫描到某个包"与"解析该插件的运行时信息"在同一次遍历中完成。
 */
class PackageScanner extends LocalScanner {
	private service: PackageProvider;

	constructor(service: PackageProvider) {
		super(service.ctx.baseDir);
		this.service = service;
	}

	/** 单个包解析失败时仅记录警告，不中断整体扫描。 */
	override async onError(error: any, name: string) {
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
				name = name.replace(/(koishi-|^@koishijs\/)plugin-/, "");
				this.service.cache[name] = await this.service.parseExports(name);
			}
		} catch (error) {
			void this.onError(error, name);
		}
		return result;
	}
}

/** Node 端包提供器：collect 委托给本机扫描器。 */
export class PackageProvider extends shared.PackageProvider {
	scanner = new PackageScanner(this);

	/**
	 * 扫描本机插件包并返回扫描结果。
	 *
	 * @param forced 为 true 时强制重新扫描（不走缓存）
	 */
	async collect(forced: boolean) {
		await this.scanner.collect(forced);
		return this.scanner.objects;
	}
}
