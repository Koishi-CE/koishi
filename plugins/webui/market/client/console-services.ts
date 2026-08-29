/**
 * market 客户端的 console 服务类型注入。
 *
 * store.market / store.dependencies / store.registry 与 market/* 事件的键
 * 类型来自 @koishi-ce/console 的 Console.Services / Console.Events 接口，
 * 服务端侧的声明在 src/node/index.ts（经产物 d.ts 扩散）。client 工程的
 * 类型检查无法经产物 d.ts 链完成合并，故在此显式镜像一份；本文件以对
 * Console 的具名类型导入激活增强（TS7 下空绑定 import type 不触发），
 * 两处声明须保持同步。
 */

import type { Dict } from "@koishi-ce/client";
import type { Console } from "@koishi-ce/console";
import type {
	DependencyProvider,
	MarketProvider,
	RegistryProvider,
} from "@koishi-ce/plugin-market";
import type { DependencyMetaKey, RemotePackage } from "@koishi-ce/registry";

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			market: MarketProvider;
			dependencies: DependencyProvider;
			registry: RegistryProvider;
		}
	}

	interface Events {
		"market/install"(deps: Dict<string>, forced?: boolean): Promise<number>;
		"market/registry"(
			names: string[],
		): Promise<Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>>>;
	}
}

// 引用 Console 以满足导入使用约束（否则 noUnusedLocals 报未使用导入）
export type ConsoleServices = Console.Services;
