// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi_ce/client 包的主入口（Koishi 控制台前端组件库）。
 *
 * 职责：
 * - 创建根 Context（`root`），安装内置组件库并启动六个核心服务
 *   （action / i18n / loader / router / setting / theme）；
 * - 通过 `export *` 汇总对外暴露组件、数据层与各服务插件的公共 API，
 *   供宿主 app 与各控制台插件统一从 `@koishi-ce/client` 导入；
 * - 声明可被其它插件以 `declare module` 合并增强的 `ActionContext`、
 *   `Config` 接口。
 */
import install from "./components";
import { Context } from "./context";

declare module "@koishi-ce/plugin-console" {
	export interface ClientConfig {
		/** 服务端声明不支持的功能列表（版本不兼容时用于前端降级提示） */
		unsupported?: string[];
	}
}

// Satori 协议类型的两个命名空间别名：旧代码多用 Universal，新代码建议用 Satori
export * as Satori from "@satorijs/protocol";
export * as Universal from "@satorijs/protocol";
// cordis 以 ambient const enum 声明 ScopeStatus,verbatimModuleSyntax 下
// 禁止对其实施运行时访问/再导出(TS2748);这里按等价值展开为 const 对象,
// 与 cordis(@cordisjs/core)运行时导出的枚举数值保持一致
export const ScopeStatus = {
	PENDING: 0,
	LOADING: 1,
	ACTIVE: 2,
	FAILED: 3,
	DISPOSED: 4,
} as const;

export type ScopeStatus =
	(typeof ScopeStatus)[keyof typeof ScopeStatus];
export * from "./components";
export * from "./context";
export * from "./data";
export * from "./plugins/action";
export * from "./plugins/i18n";
export * from "./plugins/loader";
export * from "./plugins/router";
export * from "./plugins/setting";
export * from "./plugins/theme";
export { Service } from "./utils";

/** 组件库安装函数（在 Vue app 上注册全部内置组件） */
export default install;

// 各插件通过 `declare module "@koishi-ce/client"` 对该接口做合并增强,
// 因此必须是 interface 而非类型别名(同 context.ts 的 Internal)
// biome-ignore lint/suspicious/noEmptyInterface: 需要保持 interface 以支持声明合并
export interface ActionContext {}

/** 客户端本地配置（持久化于 localStorage，读写见 plugins/setting.ts） */
export interface Config {
	/** 界面语言，如 "zh-CN" / "en-US" */
	locale?: string;
}

/** 根 Context：整个控制台前端共享的唯一上下文实例 */
export const root = new Context();

// 在根 Vue 应用上安装内置组件库（组件注册 + schema 扩展注册）
root.app.use(install);

// activity 事件的兜底监听：正常传入的 activity 实例恒为真值，
// 故默认不禁用任何页面；插件可另行监听 "activity" 事件按需隐藏页面
root.on("activity", (data) => !data);

/** @deprecated 已废弃，请改用 `useRouter()` */
export const router = root.$router.router;

/** @deprecated 已废弃，请改用 `useRouter()` */
export const activities = root.$router.pages;
