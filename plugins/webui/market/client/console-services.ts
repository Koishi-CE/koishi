// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * market 客户端的 console 服务类型注入。
 *
 * 浏览器端工程对 console 类型的消费走 packages/web/client/client/shims.d.ts
 * 手写的 "@koishi-ce/plugin-console" 骨架（浏览器端没有指向真实插件的
 * node_modules 链接与 paths），因此本文件向同一模块名镜像 market 侧注入的
 * Services / Events / store 载荷。载荷一律用骨架自带的 DataService<T> 包装，
 * 保证 client 侧 Store 映射类型（Services[K] extends DataService<infer T>）
 * 能推导出真实负载数据。类型实体取自各包 lib 产物 d.ts（本 tsconfig 的
 * paths 已指向产物）。node 侧真实声明位于 src/node/index.ts 与
 * src/shared/index.ts，两处须保持同步（含下方内联的 Dict / Dependency 镜像）。
 */

declare module "@koishi-ce/plugin-console" {
	/** cosmokit.Dict 镜像（浏览器端工程无 cosmokit 链接） */
	type Dict<T> = { [key: string]: T };

	/** src/node/installer.ts 的 Dependency 镜像（严格同步） */
	interface Dependency {
		request: string;
		resolved?: string | undefined;
		workspace?: boolean | undefined;
		invalid?: boolean | undefined;
		latest?: string | undefined;
	}

	namespace Console {
		interface Services {
			market: DataService<
				import("@koishi-ce/plugin-market").MarketProvider.Payload
			>;
			dependencies: DataService<Dict<Dependency>>;
			registry: DataService<
				Dict<
					Dict<
						Pick<
							import("@koishi-ce/registry").RemotePackage,
							import("@koishi-ce/registry").DependencyMetaKey
						>
					>
				>
			>;
			packages: DataService<
				Dict<
					import("@koishi-ce/plugin-config").PackageProvider.Data
				>
			>;
		}
	}

	interface Events {
		"market/refresh"(): void;
		"market/install"(
			deps: Dict<string>,
			forced?: boolean,
		): Promise<number>;
		"market/registry"(
			names: string[],
		): Promise<
			Dict<
				Dict<
					Pick<
						import("@koishi-ce/registry").RemotePackage,
						import("@koishi-ce/registry").DependencyMetaKey
					>
				>
			>
		>;
	}
}
