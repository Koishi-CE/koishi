/**
 * 表单子模块入口（Vue 插件形态）：在 schemastery-vue 的 k-schema 体系上
 * 注册本仓库扩展——union + computed 角色的「计算属性」编辑器（computed.vue，
 * 用于带 $switch 分支的配置值）与全局组件 k-filter（过滤器编辑器）。
 */
/// <reference path="../shims.d.ts" />
// 注意:这里刻意从 "schemastery-vue/client" 导入而非包名本身——该包仅以
// TS 源码发布,直接导入会把不满足严格配置的源码拉进类型程序。虚拟子路径
// 的类型由上方 reference 引入的 ambient 兜底 + 根 tsconfig.client.json
// 的 paths(compiler-sfc 需要)双轨提供,运行时由构建器别名映射到同目录
// schemastery-vue-runtime.ts(见 packages/web/client/src/index.ts)。
import form from "schemastery-vue/client";
import type { App } from "vue";
import Computed from "./computed.vue";
import Filter from "./k-filter.vue";

// 注册 schema 扩展:类型为 union、角色为 computed 的节点
// (即控制台配置里的「计算属性」)由 Computed 组件渲染
form.extensions.add({
	type: "union",
	role: "computed",
	component: Computed,
});

export * from "schemastery-vue/client";

/**
 * Vue 插件安装函数：启用 schemastery-vue 表单并注册 k-filter 全局组件。
 * @param app 宿主的 Vue 应用实例
 */
export default function (app: App) {
	app.use(form);
	app.component("k-filter", Filter);
}
