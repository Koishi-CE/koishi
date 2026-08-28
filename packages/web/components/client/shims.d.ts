/**
 * 类型垫片:schemastery-vue 仅以 TS 源码发布(main 直接指向 src),其源码
 * 无法通过本仓库的超严格编译配置(verbatimModuleSyntax / noUncheckedIndexedAccess
 * 等)进入类型程序。浏览器端代码统一从 "schemastery-vue/client" 导入:
 * 该子路径在包内并不存在,类型由本 ambient 声明提供;运行时由构建器别名
 * 映射到同目录 schemastery-vue-runtime.ts(补齐真实包缺失的 SchemaBase
 * 具名导出,见 packages/web/client/src/index.ts 的 resolve.alias)。
 *
 * 双轨说明:vue 的 compiler-sfc 解析 .vue 内 defineProps 等类型时走
 * TypeScript 模块解析,只认 tsconfig paths 指向的真实文件,既不认 vite
 * 别名也不认本 ambient 声明——故同一套实体在 schemastery-vue-client.ts
 * (真实模块,供 compiler-sfc 经根 tsconfig.client.json 的 paths 解析)
 * 有一份镜像,两处必须同步修改。注意 declare module 内的相对导出不可
 * 解析,只能内联声明;部分插件 client tsconfig 自带 paths 会整体覆盖
 * 继承的 paths,故 tsc 侧也不能只靠 paths 一套机制。
 *
 * 本文件经 form/index.ts 的 /// reference 引入,凡类型程序包含
 * form/index.ts 即自动生效。packages/web/client 的 client / app 项目
 * 通过 client/client/shims.d.ts 引用本文件。
 *
 * Schema 类型取自 "@koishi-ce/koishi"(其 lib 声明再导出 schemastery 的
 * Schema,与该包运行时导出的是同一实现)。
 */
declare module "schemastery-vue/client" {
	import type { Schema } from "@koishi-ce/koishi";
	import type { App, Component } from "vue";

	export { Schema } from "@koishi-ce/koishi";

	export namespace SchemaBase {
		export interface Extension {
			type?: string;
			role?: string;
			validate?: (value: any, schema: Schema) => boolean;
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
