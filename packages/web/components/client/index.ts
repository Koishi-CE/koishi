/**
 * @koishi-ce/components 共享组件库入口（Vue 插件形态）。
 *
 * 汇总并注册三类客户端组件：表单（k-schema 扩展 + k-filter 条件过滤器）、
 * 虚拟列表（virtual-list）以及通用展示件（k-comment 通知条、
 * k-image-viewer 图片查看器）。宿主控制台与各 webui 插件前端 install
 * 本插件后即可在模板中直接使用这些全局组件。
 */
import type { App } from "vue";
import form from "./form";
import ImageViewer from "./image-viewer.vue";
import Comment from "./k-comment.vue";
import virtual from "./virtual";

// 组件库的全局样式（含 element-plus 覆盖等）
import "./index.scss";

export * from "cosmokit";
export * from "./form";
export * from "./virtual";

/**
 * Vue 插件安装函数：注册表单 / 虚拟列表两个子插件与两个全局组件。
 * @param app 宿主的 Vue 应用实例
 */
export default function (app: App) {
	app.use(form);
	app.use(virtual);
	app.component("k-comment", Comment);
	app.component("k-image-viewer", ImageViewer);
}
