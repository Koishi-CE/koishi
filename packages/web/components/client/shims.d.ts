// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 绫诲瀷鍨墖:schemastery-vue 浠呬互 TS 婧愮爜鍙戝竷(main 鐩存帴鎸囧悜 src),鍏舵簮鐮? * 鏃犳硶閫氳繃鏈粨搴撶殑瓒呬弗鏍肩紪璇戦厤缃?verbatimModuleSyntax / noUncheckedIndexedAccess
 * 绛?杩涘叆绫诲瀷绋嬪簭銆傛祻瑙堝櫒绔唬鐮佺粺涓€浠?"schemastery-vue/client" 瀵煎叆:
 * 璇ュ瓙璺緞鍦ㄥ寘鍐呭苟涓嶅瓨鍦?绫诲瀷鐢辨湰 ambient 澹版槑鎻愪緵;杩愯鏃剁敱鏋勫缓鍣ㄥ埆鍚? * 鏄犲皠鍒板悓鐩綍 schemastery-vue-runtime.ts(琛ラ綈鐪熷疄鍖呯己澶辩殑 SchemaBase
 * 鍏峰悕瀵煎嚭,瑙?packages/web/client/src/index.ts 鐨?resolve.alias)銆? *
 * 鍙岃建璇存槑:vue 鐨?compiler-sfc 瑙ｆ瀽 .vue 鍐?defineProps 绛夌被鍨嬫椂璧? * TypeScript 妯″潡瑙ｆ瀽,鍙 tsconfig paths 鎸囧悜鐨勭湡瀹炴枃浠?鏃笉璁?vite
 * 鍒悕涔熶笉璁ゆ湰 ambient 澹版槑鈥斺€旀晠鍚屼竴濂楀疄浣撳湪 schemastery-vue-client.ts
 * (鐪熷疄妯″潡,渚?compiler-sfc 缁忔牴 tsconfig.client.json 鐨?paths 瑙ｆ瀽)
 * 鏈変竴浠介暅鍍?涓ゅ蹇呴』鍚屾淇敼銆傛敞鎰?declare module 鍐呯殑鐩稿瀵煎嚭涓嶅彲
 * 瑙ｆ瀽,鍙兘鍐呰仈澹版槑;閮ㄥ垎鎻掍欢 client tsconfig 鑷甫 paths 浼氭暣浣撹鐩? * 缁ф壙鐨?paths,鏁?tsc 渚т篃涓嶈兘鍙潬 paths 涓€濂楁満鍒躲€? *
 * 鏈枃浠剁粡 form/index.ts 鐨?/// reference 寮曞叆,鍑＄被鍨嬬▼搴忓寘鍚? * form/index.ts 鍗宠嚜鍔ㄧ敓鏁堛€俻ackages/web/client 鐨?client / app 椤圭洰
 * 閫氳繃 client/client/shims.d.ts 寮曠敤鏈枃浠躲€? *
 * Schema 绫诲瀷鍙栬嚜 "@koishi-ce/koishi"(鍏?lib 澹版槑鍐嶅鍑?schemastery 鐨? * Schema,涓庤鍖呰繍琛屾椂瀵煎嚭鐨勬槸鍚屼竴瀹炵幇)銆? */
declare module "schemastery-vue/client" {
	import type { Schema } from "@koishi-ce/koishi";
	import type { App, Component } from "vue";

	export { Schema } from "@koishi-ce/koishi";

	export namespace SchemaBase {
		export interface Extension {
			type?: string;
			role?: string;
			validate?: (value: unknown, schema: Schema) => boolean;
			component: Component;
			important?: boolean;
		}
	}

	const SchemaBase: {
		extensions: Set<SchemaBase.Extension>;
		install(app: App): void;
	};

	export default SchemaBase;
	export { SchemaBase, SchemaBase as form };

	export const IconAdd: Component;
	export const IconArrowDown: Component;
	export const IconArrowUp: Component;
	export const IconBranch: Component;
	export const IconClose: Component;
	export const IconCode: Component;
	export const IconCollapse: Component;
	export const IconDelete: Component;
	export const IconEllipsis: Component;
	export const IconExpand: Component;
	export const IconExternal: Component;
	export const IconEyeSlash: Component;
	export const IconEye: Component;
	export const IconInsertAfter: Component;
	export const IconInsertBefore: Component;
	export const IconInvalid: Component;
	export const IconRedo: Component;
	export const IconReset: Component;
	export const IconSquareCheck: Component;
	export const IconSquareEmpty: Component;
	export const IconUndo: Component;
}
