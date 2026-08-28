/**
 * 浏览器端类型垫片(packages/web/client 自身使用;app 项目通过
 * app/shims.d.ts 引用本文件):
 *
 * 1. "schemastery-vue/client" 虚拟子路径:由根 tsconfig.client.json 的
 *    paths 解析到 packages/web/components/client/schemastery-vue-client.ts
 *    (真实模块,单一事实源),运行时经构建器别名映射回真实包。
 * 2. "@koishi-ce/plugin-console":本包 node_modules 中没有该插件的链接
 *    (依赖方向相反,浏览器端 tsconfig 也没有 paths),且该插件源码含有
 *    node 专属导入,无法直接进入浏览器程序,故在此按其公开面手写声明。
 *    字段与 plugins/webui/console/src/node/index.ts 的 ClientConfig 以及
 *    packages/node/console 的 DataService / Console.Services 保持一致。
 */

declare module "@koishi-ce/plugin-console" {
	import type { Schema } from "@koishi-ce/koishi";
	import type { Dict } from "cosmokit";

	export interface ClientConfig {
		devMode: boolean;
		uiPath: string;
		endpoint: string;
		static?: boolean;
		heartbeat?: HeartbeatConfig;
		proxyBase?: string;
	}

	interface HeartbeatConfig {
		interval?: number;
		timeout?: number;
	}

	export interface Events {
		ping(): string;
	}

	/** 服务端数据服务的类型骨架（仅类型层面使用，浏览器端无实现） */
	export abstract class DataService<T = any> {}

	/** 扩展入口描述：由服务端 entry 服务推送，loader 据此动态加载扩展 */
	export interface EntryData {
		files: string[];
		paths?: string[];
		data: () => any;
	}

	export namespace Console {
		/** 服务端可用数据服务的清单，Store 类型据此推导各键的负载数据 */
		export interface Services {
			entry: DataService<Dict<EntryData>>;
			schema: DataService<Dict<Schema>>;
			permissions: DataService<string[]>;
		}
	}
}
