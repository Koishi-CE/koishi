// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

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

// cosmokit 的名字刻意不在本入口直接 re-export：./form 透传的 schemastery-vue
// 源码自身就有 `export * from 'cosmokit'`，dev transform 管线（非打包、
// 逐文件服务）下两条 star 链会以不同的模块 URL 各自透出同名，被 Vite 判为
// conflicting star exports，浏览器端控制台整体加载失败（上游有这行是因为
// 其组件库以打包产物发布，dev 下不经过浏览器原生解析 star 导出）。省略后
// cosmokit 的导出面仍经 form 链完整透出，包的公共 API 不变。
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
