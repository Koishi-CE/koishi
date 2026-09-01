// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 娴忚鍣ㄧ绫诲瀷鍨墖(packages/web/client 鑷韩浣跨敤;app 椤圭洰閫氳繃
 * app/shims.d.ts 寮曠敤鏈枃浠?:
 *
 * 1. "schemastery-vue/client" 铏氭嫙瀛愯矾寰?鐢辨牴 tsconfig.client.json 鐨? *    paths 瑙ｆ瀽鍒?packages/web/components/client/schemastery-vue-client.ts
 *    (鐪熷疄妯″潡,鍗曚竴浜嬪疄婧?,杩愯鏃剁粡鏋勫缓鍣ㄥ埆鍚嶆槧灏勫洖鐪熷疄鍖呫€? * 2. "@koishi-ce/plugin-console":鏈寘 node_modules 涓病鏈夎鎻掍欢鐨勯摼鎺? *    (渚濊禆鏂瑰悜鐩稿弽,娴忚鍣ㄧ tsconfig 涔熸病鏈?paths),涓旇鎻掍欢婧愮爜鍚湁
 *    node 涓撳睘瀵煎叆,鏃犳硶鐩存帴杩涘叆娴忚鍣ㄧ▼搴?鏁呭湪姝ゆ寜鍏跺叕寮€闈㈡墜鍐欏０鏄庛€? *    瀛楁涓?plugins/webui/console/src/node/index.ts 鐨?ClientConfig 浠ュ強
 *    packages/node/console 鐨?DataService / Console.Services 淇濇寔涓€鑷淬€? */

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

	/** 鏈嶅姟绔暟鎹湇鍔＄殑绫诲瀷楠ㄦ灦锛堜粎绫诲瀷灞傞潰浣跨敤锛屾祻瑙堝櫒绔棤瀹炵幇锛?*/
	export abstract class DataService<T = unknown> {}

	/** 鎵╁睍鍏ュ彛鎻忚堪锛氱敱鏈嶅姟绔?entry 鏈嶅姟鎺ㄩ€侊紝loader 鎹鍔ㄦ€佸姞杞芥墿灞?*/
	export interface EntryData {
		files: string[];
		paths?: string[];
		data: unknown;
	}

	export namespace Console {
		/** 鏈嶅姟绔彲鐢ㄦ暟鎹湇鍔＄殑娓呭崟锛孲tore 绫诲瀷鎹鎺ㄥ鍚勯敭鐨勮礋杞芥暟鎹?*/
		export interface Services {
			entry: DataService<Dict<EntryData>>;
			schema: DataService<Dict<Schema>>;
			permissions: DataService<string[]>;
		}
	}
}
