// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/components 共享组件库入口（Vue 插件形态）——全仓唯一的
 * UI 组件库。源码按域分层组织：
 *
 * - `core/`：纯逻辑与基础设施（injection 注入、slot 插槽合并、markdown
 *   消毒管线），无视图；
 * - `common/`：基础原子件（k-button / k-hint / k-tab / k-activity-link）；
 * - `layout/`：容器与排版（k-card / k-content / k-empty / k-tab-group /
 *   k-tab-item）；
 * - `form/`：表单域——schemastery-vue 双轨载体（schemastery-client /
 *   schemastery-runtime）、schema 控件扩展（any+dynamic 动态表单、
 *   array+perms 权限选择器、union+computed 计算属性）与 k-filter 过滤器；
 * - `display/`：展示与视听——k-comment 通知条、k-markdown 渲染
 *   （消费 core/markdown 消毒管线）、image-viewer 域（容器内查看器
 *   k-image-viewer 与全屏查看器 overlay 共用 use-transform 变换状态与
 *   toolbar 工具条）；
 * - `chat/`：聊天图片（chat-image，点击经 image-viewer 的共享状态打开
 *   全屏查看器）；
 * - `virtual/`：虚拟列表（模型 / 测量 / 滚动壳）；
 * - `icons/`：图标中心（k-icon 与全部内置图标，svg 资产在包根
 *   `assets/icons/`）。
 *
 * 宿主 `@koishi-ce/client` 以 `export *` 二次转出本包全部公共 API
 * （历史兼容面：控制台插件统一从 client 导入）。
 */
import Element, {
	ElLoading,
	ElMessage,
	ElMessageBox,
} from "element-plus";
import type { App } from "vue";
import ChatImage from "./chat/image.vue";
import common from "./common";
import link from "./common/link";
import { useStore } from "./core/injection";
import slot from "./core/slot";
import Comment from "./display/comment.vue";
import ImageViewer from "./display/image-viewer/viewer.vue";
import Markdown from "./display/markdown.ts";
import form, { SchemaBase } from "./form";
import Dynamic from "./form/dynamic.vue";
import Perms from "./form/perms.vue";
import * as icons from "./icons";
import layout from "./layout";
import virtual from "./virtual";

// 组件库的全局样式（含 element-plus 覆盖等）
import "./index.scss";
// element-plus 全量样式：组件库装配 EP 的归口，须与下方 install 的
// app.use(Element) 同住一处
import "element-plus/dist/index.css";

/** 全局 loading 遮罩服务（ElLoading.service） */
export const loading = ElLoading.service;
/** 全局消息提示（ElMessage） */
export const message = ElMessage;
/** 全局对话框（ElMessageBox） */
export const messageBox = ElMessageBox;

export * from "./common";
export * from "./common/link";
export * from "./core/injection";
export * from "./core/slot";
export { default as Overlay } from "./display/image-viewer/overlay.vue";
export * from "./form";
export * as icons from "./icons";
export * from "./layout";
export * from "./virtual";
export { ChatImage, Markdown };

// cosmokit 的名字刻意不在本入口直接 re-export：./form 透传的 schemastery-vue
// 源码自身就有 `export * from 'cosmokit'`，dev transform 管线（非打包、
// 逐文件服务）下两条 star 链会以不同的模块 URL 各自透出同名，被 Vite 判为
// conflicting star exports，浏览器端控制台整体加载失败（上游有这行是因为
// 其组件库以打包产物发布，dev 下不经过浏览器原生解析 star 导出）。省略后
// cosmokit 的导出面仍经 form 链完整透出，包的公共 API 不变。

// schema 控件扩展：dynamic 角色——实际 schema 由服务端按 meta.extra.name 下发，
// 组件内再经 useStore() 读取 store.schema "水合"（见 form/dynamic.vue）
SchemaBase.extensions.add({
	type: "any",
	role: "dynamic",
	component: Dynamic,
});

// schema 控件扩展：perms 角色——权限路径多级选择器（见 form/perms.vue），
// 权限数据（store.permissions）未就绪时校验不过
SchemaBase.extensions.add({
	type: "array",
	role: "perms",
	component: Perms,
	validate: () => !!useStore().permissions,
});

/**
 * Vue 插件安装函数：装配 element-plus 并注册全部全局组件。
 * @param app 宿主的 Vue 应用实例
 */
export default function (app: App) {
	app.use(Element);
	app.use(form);
	app.use(virtual);
	app.use(common);
	app.use(icons);
	app.use(layout);
	app.use(link);
	app.use(slot);
	app.component("k-comment", Comment);
	app.component("k-image-viewer", ImageViewer);
	app.component("k-markdown", Markdown);
}
