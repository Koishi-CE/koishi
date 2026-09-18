// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * locales 插件（浏览器侧入口）。
 *
 * 注册本地化管理页面（`/locales/:path*`，authority 4），
 * 页面组件为 ./locales.vue；同时注册页面与语言选择器用到的两个图标。
 */
import { type Context, icons } from "@koishi-ce/client";
import type { Dict } from "@koishi-ce/koishi";
import type {} from "@koishi-ce/plugin-locales";
import Activity from "./icons/activity.vue";
import Globe from "./icons/globe.vue";
import Locales from "./locales.vue";

import "virtual:uno.css";

/**
 * 编辑态词典：键为完整点分路径（node 侧推送的 ctx.i18n._data 即此扁平
 * 形态，见 core 的 Dict<Dict<string>> 声明），叶子翻译值允许 null
 * （用户清空翻译时置 null 表示删除该键，node 侧落盘为 YAML null）。
 * 故值域收窄为 string | null——嵌套 I18n.Store 分支在扁平键模型下不存在。
 */
export type EditableStore = {
	[key: string]: string | null;
};

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// Console.Services 来自 packages/web/client/client/shims.d.ts 的手写环境声明;
// 这里按同名环境声明合并为其补充 locales 键,使 ctx.page 的 fields 通过检查
// (DataService 同样解析自该环境声明,与 insight 客户端的做法保持一致)
declare module "@koishi-ce/plugin-console" {
	namespace Console {
		export interface Services {
			locales: DataService<Dict<EditableStore>>;
		}
	}

	// send() 的 l10n 事件镜像声明:node 侧真实声明位于本包 src/index.ts 的
	// declare module "@koishi-ce/console"(浏览器端类型程序不可见,见 commands
	// 插件 client/utils.ts 的同款模式),两处须保持同步;参数按运行时编辑态
	// (值可为 null)声明,是 node 侧 Dict<I18n.Store> 的宽松超类型
	interface Events {
		l10n(data: Dict<EditableStore>): void;
	}
}

icons.register("activity:locales", Activity);
icons.register("globe", Globe);

export default (ctx: Context) => {
	ctx.page({
		path: "/locales/:path*",
		name: "本地化",
		icon: "activity:locales",
		order: 450,
		authority: 4,
		fields: ["locales"],
		component: Locales,
	});
};
