// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * "schemastery-vue/client" 虚拟子路径的真实文件载体（compiler-sfc 专用）。
 *
 * - 运行时：该子路径在包内并不存在，构建器用 resolve.alias 把它映射到
 *   同目录 schemastery-vue-runtime.ts（见 packages/web/client/src/index.ts
 *   与 scripts/client.ts），本文件不会进入任何产物。
 * - 类型：vue 的 compiler-sfc 在解析 .vue 文件内 defineProps 等类型时走
 *   TypeScript 模块解析（compiler-sfc 的 resolveWithTS），既不认 vite
 *   别名也不认 ambient declare module，必须由 tsconfig 的 paths 把子路径
 *   落到本真实文件（见根 tsconfig.client.json）。tsc 类型程序则统一消费
 *   client/shims.d.ts 的 ambient 声明（经 form/index.ts 的 /// reference
 *   自动传播，且 ambient 会遮蔽 paths 解析），两者是同一套实体的镜像，
 *   必须同步修改。
 *
 * 类型刻意手写而非再导出 schemastery-vue 源码：该包仅以 TS 源码发布，
 * 其源码无法通过本仓库的超严格编译配置（verbatimModuleSyntax /
 * noUncheckedIndexedAccess 等），不能作为 .ts 依赖进入类型程序。
 *
 * 下游（npm 安装）形态下没有仓库级 tsconfig，本文件经包内随包发布的
 * tsconfig.json 的 paths 提供同一映射——compiler-sfc 解析 import source
 * 时以发起文件为起点向上找 tsconfig.json，会命中包内这份。
 *
 * Schema 类型取自 "@koishi-ce/koishi"（其 lib 声明再导出 schemastery 的
 * Schema，与该包运行时导出的是同一实现）。
 */
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
