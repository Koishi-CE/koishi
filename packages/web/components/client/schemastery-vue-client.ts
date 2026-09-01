// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * "schemastery-vue/client" 铏氭嫙瀛愯矾寰勭殑鐪熷疄鏂囦欢杞戒綋锛坈ompiler-sfc 涓撶敤锛夈€? *
 * - 杩愯鏃讹細璇ュ瓙璺緞鍦ㄥ寘鍐呭苟涓嶅瓨鍦紝鏋勫缓鍣ㄧ敤 resolve.alias 鎶婂畠鏄犲皠鍒? *   鍚岀洰褰?schemastery-vue-runtime.ts锛堣 packages/web/client/src/index.ts
 *   涓?scripts/client.ts锛夛紝鏈枃浠朵笉浼氳繘鍏ヤ换浣曚骇鐗┿€? * - 绫诲瀷锛歷ue 鐨?compiler-sfc 鍦ㄨВ鏋?.vue 鏂囦欢鍐?defineProps 绛夌被鍨嬫椂璧? *   TypeScript 妯″潡瑙ｆ瀽锛坈ompiler-sfc 鐨?resolveWithTS锛夛紝鏃笉璁?vite
 *   鍒悕涔熶笉璁?ambient declare module锛屽繀椤荤敱 tsconfig 鐨?paths 鎶婂瓙璺緞
 *   钀藉埌鏈湡瀹炴枃浠讹紙瑙佹牴 tsconfig.client.json锛夈€倀sc 绫诲瀷绋嬪簭鍒欑粺涓€娑堣垂
 *   client/shims.d.ts 鐨?ambient 澹版槑锛堢粡 form/index.ts 鐨?/// reference
 *   鑷姩浼犳挱锛屼笖 ambient 浼氶伄钄?paths 瑙ｆ瀽锛夛紝涓よ€呮槸鍚屼竴濂楀疄浣撶殑闀滃儚锛? *   蹇呴』鍚屾淇敼銆? *
 * 绫诲瀷鍒绘剰鎵嬪啓鑰岄潪鍐嶅鍑?schemastery-vue 婧愮爜锛氳鍖呬粎浠?TS 婧愮爜鍙戝竷锛? * 鍏舵簮鐮佹棤娉曢€氳繃鏈粨搴撶殑瓒呬弗鏍肩紪璇戦厤缃紙verbatimModuleSyntax /
 * noUncheckedIndexedAccess 绛夛級锛屼笉鑳戒綔涓?.ts 渚濊禆杩涘叆绫诲瀷绋嬪簭銆? *
 * Schema 绫诲瀷鍙栬嚜 "@koishi-ce/koishi"锛堝叾 lib 澹版槑鍐嶅鍑?schemastery 鐨? * Schema锛屼笌璇ュ寘杩愯鏃跺鍑虹殑鏄悓涓€瀹炵幇锛夈€? */
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

declare const SchemaBase: {
	extensions: Set<SchemaBase.Extension>;
	install(app: App): void;
};

export default SchemaBase;
export { SchemaBase, SchemaBase as form };

export declare const IconAdd: Component;
export declare const IconArrowDown: Component;
export declare const IconArrowUp: Component;
export declare const IconBranch: Component;
export declare const IconClose: Component;
export declare const IconCode: Component;
export declare const IconCollapse: Component;
export declare const IconDelete: Component;
export declare const IconEllipsis: Component;
export declare const IconExpand: Component;
export declare const IconExternal: Component;
export declare const IconEyeSlash: Component;
export declare const IconEye: Component;
export declare const IconInsertAfter: Component;
export declare const IconInsertBefore: Component;
export declare const IconInvalid: Component;
export declare const IconRedo: Component;
export declare const IconReset: Component;
export declare const IconSquareCheck: Component;
export declare const IconSquareEmpty: Component;
export declare const IconUndo: Component;
