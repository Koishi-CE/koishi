/**
 * 虚拟列表子模块入口（Vue 插件形态）：注册全局组件 virtual-list。
 * 实现拆为三部分：list.vue（组件外壳，滚动与渲染）、item.ts（条目
 * 尺寸测量包装）、virtual.ts（范围与占位的核心计算模型）。
 */
import type { App } from "vue";
import VirtualList from "./list.vue";

export { VirtualList };

/**
 * Vue 插件安装函数：把 VirtualList 注册为 global-list 全局组件。
 * @param app 宿主的 Vue 应用实例
 */
export default function (app: App) {
	app.component("virtual-list", VirtualList);
}
