/**
 * @file console 页面与全局 slot 的注册(app 域,由入口 index.ts 调用)。
 *
 * 模块职责:
 * - 注册市场页(/market)与依赖页(/dependencies,静态站点模式不注册),
 *  两个页面都经 createPageBoundary 包上错误边界;
 * - 注册六个全局对话框 slot(安装/合包安装/确认/进度/安装历史/环境版本)
 *  与右侧状态栏的 Progress 进度条 slot;
 * - 注册欢迎页"进入市场"选择卡片;尝试初始化 console 扩展(失败仅告警)。
 */

import { defineComponent, h } from "vue";
import { Context, global, router } from "@koishi-ce/client";
import { translate } from "../shared/i18n";
import extensions from "../extensions";
import Dependencies from "../pages/dependencies/dependencies.vue";
import Install from "../dialogs/install/index.vue";
import BundleInstall from "../dialogs/bundle-install/index.vue";
import Confirm from "../dialogs/confirm/index.vue";
import InstallProgress from "../dialogs/install-progress/index.vue";
import InstallHistory from "../dialogs/install-history/index.vue";
import EnvironmentVersions from "../dialogs/environment-versions/index.vue";
import Market from "../pages/market/market.vue";
import Progress from "../dialogs/progress/index.vue";
import { createPageBoundary } from "../shared/page-boundary";

// 两个重页面统一套错误边界:渲染异常时显示兜底 UI 而不是整页白屏
const GuardedMarket = createPageBoundary("Market", Market);
const GuardedDependencies = createPageBoundary("Dependencies", Dependencies);

/** 注册欢迎页卡片、全局对话框 slot、市场/依赖两个页面与扩展。 */
export function setupPages(ctx: Context) {
	// 欢迎页"选择要使用的功能"里的市场入口卡片
	ctx.slot({
		type: "welcome-choice",
		component: defineComponent(
			() => () =>
				h(
					"div",
					{
						class: "choice",
						onClick: () => router.push("/market"),
					},
					[
						h("h2", translate("common.welcome.marketTitle")),
						h("p", translate("common.welcome.marketDescription")),
					],
				),
		),
	});

	// ---- 全局对话框:挂到 global slot,常驻 DOM、由各自内部的开关控制显隐 ----
	ctx.slot({
		type: "global",
		component: Install,
	});

	ctx.slot({
		type: "global",
		component: BundleInstall,
	});

	ctx.slot({
		type: "global",
		component: Confirm,
	});

	ctx.slot({
		type: "global",
		component: InstallProgress,
	});

	ctx.slot({
		type: "global",
		component: InstallHistory,
	});

	ctx.slot({
		type: "global",
		component: EnvironmentVersions,
	});

	// 市场页:authority 4,fields 声明需要服务端下发 market 通道数据
	ctx.page({
		id: "market",
		path: "/market",
		name: () => translate("common.pages.market"),
		icon: "activity:market",
		order: 750,
		authority: 4,
		fields: ["market"],
		component: GuardedMarket,
	});

	try {
		extensions(ctx);
	} catch (error) {
		console.warn(
			"[market-next] failed to initialize console extensions",
			error,
		);
	}

	// 静态部署(global.static)下没有依赖管理能力,依赖页与进度条都不注册
	if (!global.static) {
		ctx.slot({
			type: "status-right",
			component: Progress,
			order: 10,
		});

		ctx.page({
			id: "dependencies",
			path: "/dependencies",
			name: () => translate("common.pages.dependencies"),
			icon: "activity:deps",
			order: 700,
			authority: 4,
			fields: ["dependencies", "registry", "registryStatus"],
			component: GuardedDependencies,
		});
	}
}
