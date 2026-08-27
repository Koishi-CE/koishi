import install from "./components";
import { Context } from "./context";

declare module "@koishi-ce/plugin-console" {
	export interface ClientConfig {
		unsupported?: string[];
	}
}

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

export type ScopeStatus = (typeof ScopeStatus)[keyof typeof ScopeStatus];
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

export default install;

// 各插件通过 `declare module "@koishi-ce/client"` 对该接口做合并增强,
// 因此必须是 interface 而非类型别名(同 context.ts 的 Internal)
// biome-ignore lint/suspicious/noEmptyInterface: 需要保持 interface 以支持声明合并
export interface ActionContext {}

export interface Config {
	locale?: string;
}

export const root = new Context();

root.app.use(install);

root.on("activity", (data) => !data);

/** @deprecated use `useRouter()` */
export const router = root.$router.router;

/** @deprecated use `useRouter()` */
export const activities = root.$router.pages;
