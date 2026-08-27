// "@koishi-ce/components" 的 exports 仅有 "source" 条件,浏览器侧 tsconfig
// 无法解析(无 paths),故直接相对导入工作区内该包的浏览器端入口,
// 与构建器 collectWorkspaceAliases 的映射目标一致

import Element, { ElLoading, ElMessage, ElMessageBox } from "element-plus";
import Markdown from "marked-vue";
import type { App } from "vue";
import components, { SchemaBase } from "../../../components/client/index.ts";

import { store } from "../data";
import ChatImage from "./chat/image.vue";
import common from "./common";
import Dynamic from "./dynamic.vue";
import * as icons from "./icons";
import layout from "./layout";
import link from "./link";
import Perms from "./perms.vue";
import slot from "./slot";

import "element-plus/dist/index.css";

export const loading = ElLoading.service;
export const message = ElMessage;
export const messageBox = ElMessageBox;

export * from "vue-i18n";
export * from "../../../components/client/index.ts";
export * from "./common";
export * from "./layout";
export * from "./link";
export * from "./slot";

export { ChatImage, icons };

SchemaBase.extensions.add({
	type: "any",
	role: "dynamic",
	component: Dynamic,
});

SchemaBase.extensions.add({
	type: "array",
	role: "perms",
	component: Perms,
	validate: () => !!store.permissions,
});

export default function (app: App) {
	app.use(Element);
	app.component("k-markdown", Markdown);

	app.use(common);
	app.use(components);
	app.use(icons);
	app.use(layout);
	app.use(link);
	app.use(slot);
}
