/**
 * @file client 侧跨组件共享的轻量状态(shared/operations 域)。
 *
 * 集中存放:全局对话框开关、合包弹层与卸载队列、手动添加的 registry 元数据
 * 缓存,以及 configWriter 服务的最小接口声明。这些状态被多个页面/对话框消费,
 * 独立成文件避免状态定义与安装编排逻辑互相耦合。
 */

import type { Context } from "@koishi-ce/client";
import { send } from "@koishi-ce/client";
import type { Registry, SearchObject } from "@koishi-ce/registry";
import type { Dict } from "cosmokit";
import { compare } from "semver";
import { reactive, ref } from "vue";

/**
 * configWriter 服务的最小接口声明(@koishi-ce/plugin-config 暴露的客户端配置读写器)。
 * 这里只依赖用到的三个方法,避免对插件内部类型的硬依赖。
 */
export interface ClientConfigWriter {
	get(name: string): any[] | undefined;
	ensure(name: string, silent?: boolean): void;
	remove(name: string): void;
}

/** 取当前上下文的 configWriter 服务;未安装 config 插件时为 undefined。 */
export function getConfigWriter(ctx: Context) {
	return ctx.get("configWriter") as ClientConfigWriter | undefined;
}

/** 本插件自身的包名:override 里出现它即视为"自更新"场景。 */
export const MARKET_NEXT_PACKAGE = "@koishi-ce/plugin-marketn";

/** 手动添加(搜索未收录包)后缓存在前端的 registry 元数据,key 为包名。仅供本域子模块共享。 */
export const manualDeps = reactive<Dict<Registry>>({});

/**
 * 手动添加一个包:拉取 registry 元数据,按版本号降序排序后缓存进 manualDeps。
 * 排序保证依赖卡片默认展示最新版本在前的选择列表。
 */
export async function addManual(name: string) {
	const data = (await send("market/package", name)) as Registry;
	if (!data?.versions)
		throw new Error(`failed to fetch package metadata: ${name}`);
	data.versions = Object.fromEntries(
		Object.entries(data.versions).sort((a, b) => compare(b[0], a[0])),
	);
	return (manualDeps[name] = data);
}

// ---- 全局对话框开关与跨组件共享的轻量状态 ----

/** "手动添加依赖"对话框开关。 */
export const showManual = ref(false);
/** 通用确认对话框开关(删除依赖等危险操作)。 */
export const showConfirm = ref(false);
/** 安装历史对话框开关。 */
export const showInstallHistory = ref(false);
/** 环境版本快照对话框开关。 */
export const showEnvironmentVersions = ref(false);
/** 依赖列表当前展开的条目包名(展开才显示 peer 明细)。 */
export const expandedDependency = ref("");
/** 市场条目弹层当前展示的合包对象。 */
export const activeBundle = ref<SearchObject>();

/** 合包成员卸载清理的目标标识(包名 + 插件键二选一即可定位)。 */
export type BundleMemberCleanupTarget = {
	package: string;
	plugin: string;
};

/**
 * 待处理的合包成员卸载队列:key 为合包包名,value 为该合包下待卸载的成员
 * plugin 键列表与"是否顺带清理配置"标记。卸载流程先收集到这里,等用户在
 * 确认对话框里拍板后再统一执行。
 */
export const pendingBundleUninstalls = ref<
	Record<
		string,
		{
			members: string[];
			cleanup: boolean;
			configs?: BundleMemberCleanupTarget[];
		}
	>
>({});
