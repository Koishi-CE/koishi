/// <reference path="../shims.d.ts" />
// 注意:这里刻意从 "schemastery-vue/client" 导入而非包名本身——该包仅以
// TS 源码发布,直接导入会把不满足严格配置的源码拉进类型程序。虚拟子路径
// 的类型由 client/shims.d.ts 提供,运行时由构建器别名映射回真实包
// (见 packages/web/client/src/index.ts 的 resolve.alias)。
import form from "schemastery-vue/client";
import type { App } from "vue";
import Computed from "./computed.vue";
import Filter from "./k-filter.vue";

form.extensions.add({
	type: "union",
	role: "computed",
	component: Computed,
});

export * from "schemastery-vue/client";

export default function (app: App) {
	app.use(form);
	app.component("k-filter", Filter);
}
