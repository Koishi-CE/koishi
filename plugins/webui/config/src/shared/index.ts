/**
 * 服务端共享代码的汇总出口。
 *
 * 一方面把 packages / services / writer 三个模块统一 re-export 给
 * node 与 browser 两个入口使用；另一方面通过声明合并把三个数据服务
 * 注册进 console 的 Services 接口，使浏览器端能以类型安全的方式
 * 访问 `store.packages`、`store.services`、`store.config`。
 */
import type { PackageProvider } from "./packages.ts";
import type { ServiceProvider } from "./services.ts";
import type { ConfigWriter } from "./writer.ts";

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			packages: PackageProvider;
			services: ServiceProvider;
			config: ConfigWriter;
		}
	}
}

export * from "./packages.ts";
export * from "./services.ts";
export * from "./writer.ts";
