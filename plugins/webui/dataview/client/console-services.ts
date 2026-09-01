// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * dataview 客户端的 console 服务类型注入。
 *
 * 浏览器端工程对 console 类型的消费走 packages/web/client/client/shims.d.ts
 * 手写的 "@koishi-ce/plugin-console" 骨架（浏览器端没有指向真实插件的
 * node_modules 链接与 paths），因此本文件向同一模块名镜像 dataview 侧注入的
 * Services / Events。载荷一律用骨架自带的 DataService<T> 包装，保证 client
 * 侧 Store 映射类型（Services[K] extends DataService<infer T>）能推导出
 * 真实负载数据。载荷类型取自本插件 lib 产物 d.ts（本 tsconfig 的 paths 已
 * 指向产物）。node 侧真实声明位于 src/index.ts，两处须保持同步（含下方
 * 内联的 DbEvents 镜像）。
 */

declare module "@koishi-ce/plugin-console" {
	/** src/index.ts 的 DbEvents 镜像（严格同步）：参数与返回值均为序列化后的字符串 */
	type DbEvents = {
		[M in import("@koishi-ce/plugin-dataview").Methods as `database/${M}`]: (
			...args: string[]
		) => Promise<string | undefined>;
	};

	namespace Console {
		interface Services {
			database: DataService<import("@koishi-ce/plugin-dataview").DatabaseInfo>;
		}
	}

	interface Events extends DbEvents {}
}
