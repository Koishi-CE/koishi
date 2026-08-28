/**
 * @file console 全局动作、右上角菜单与杂项全局 watch 的注册(app 域)。
 *
 * 模块职责:
 * - 注册 ctx.action:ctrl+r 刷新市场/依赖(按当前页面区分)、应用待安装
 *  变更、手动添加依赖、安装历史、环境版本管理;
 * - 注册 market / dependencies 两个页面的右上角菜单项,含彩蛋图标
 *  (愚人节炸弹、Koishi 日 5·14、alt+g b 手动触发);
 * - 两个全局 watch:store.dependencies 变化后清理已完成的 pending
 *  override;市场刷新结束时给出成功/失败 toast。
 *
 * 消费方:入口 index.ts 的 setupActions(ctx)。
 */

import { ref, watch } from "vue";
import { Context, message, router, send, store } from "@koishi-ce/client";
import {
	getPendingOverrides,
	patchMarketNextData,
} from "../shared/plugin-config";
import { translate } from "../shared/i18n";
import {
	showConfirm,
	showEnvironmentVersions,
	showInstallHistory,
	showManual,
} from "../shared/operations";
import {
	REGISTRY_STATUS_SWEEP_INTERVAL,
	sweepRegistryStatus,
	type MarketStore,
} from "./registry-state";

/** alt+g → alt+b 序列输入的时限(毫秒),超时重新计数。 */
const APRIL_FOOLS_SHORTCUT_TIMEOUT = 1_500;

/** 是否愚人节(4 月 1 日)。 */
function isAprilFoolsDay(date = new Date()) {
	return date.getMonth() === 3 && date.getDate() === 1;
}

/** 是否 Koishi 日(5 月 14 日)。 */
function isKoishiDay(date = new Date()) {
	return date.getMonth() === 4 && date.getDate() === 14;
}

/** 注册全部全局动作、菜单与 watch。 */
export function setupActions(ctx: Context) {
	/** 是否处于愚人节(定时刷新,菜单图标切炸弹)。 */
	const aprilFoolsIcon = ref(isAprilFoolsDay());
	/** 是否处于 Koishi 日(菜单图标切 koishi)。 */
	const koishiDayIcon = ref(isKoishiDay());
	/** 用户用 alt+g b 手动触发的愚人节图标(不受日期限制)。 */
	const forcedAprilFoolsIcon = ref(false);
	/** 上一次按下 alt+g 的时间戳,0 表示序列未开始。 */
	let aprilFoolsShortcutAt = 0;

	ctx.effect(() => {
		const updateSeasonalIcon = () => {
			aprilFoolsIcon.value = isAprilFoolsDay();
			koishiDayIcon.value = isKoishiDay();
		};
		// 彩蛋快捷键:依赖页按 alt+g 后 1.5 秒内按 alt+b,强制打开愚人节图标
		// 低频彩蛋逻辑:alt+g→alt+b 按键序列检测,守卫链即按键状态机,拆分无收益
		// fallow-ignore-next-line complexity
		const onAprilFoolsShortcut = (event: KeyboardEvent) => {
			if (router.currentRoute.value?.path !== "/dependencies") return;
			if (event.repeat || event.isComposing) return;
			const key = event.key.toLowerCase();
			if (!event.altKey || event.ctrlKey || event.metaKey) {
				if (key !== "alt") aprilFoolsShortcutAt = 0;
				return;
			}
			if (key === "g") {
				aprilFoolsShortcutAt = Date.now();
				event.preventDefault();
				return;
			}
			if (
				key === "b" &&
				aprilFoolsShortcutAt &&
				Date.now() - aprilFoolsShortcutAt <= APRIL_FOOLS_SHORTCUT_TIMEOUT
			) {
				forcedAprilFoolsIcon.value = true;
				aprilFoolsShortcutAt = 0;
				event.preventDefault();
				return;
			}
			aprilFoolsShortcutAt = 0;
		};
		const timer = window.setInterval(updateSeasonalIcon, 60_000);
		window.addEventListener("keydown", onAprilFoolsShortcut);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("keydown", onAprilFoolsShortcut);
		};
	});

	// 定时清扫卡死超时的 registry 拉取状态(见 registry-state.ts)
	ctx.effect(() => {
		const timer = window.setInterval(
			() => sweepRegistryStatus(),
			REGISTRY_STATUS_SWEEP_INTERVAL,
		);
		return () => window.clearInterval(timer);
	});

	/** 市场刷新进行中(防止重复提交)。 */
	const refreshingMarket = ref(false);
	/** 依赖刷新进行中。 */
	const refreshingDependencies = ref(false);
	/** 市场刷新结果尚未反馈(等待 refreshing 从 true 回落或 300ms 后兜底判定)。 */
	const pendingMarketRefreshFeedback = ref(false);

	/** 收敛市场刷新反馈:按 store 最终状态弹成功/失败 toast。 */
	function finishMarketRefreshFeedback() {
		if (!pendingMarketRefreshFeedback.value) return;
		pendingMarketRefreshFeedback.value = false;
		if (store.market?.stale || store.market?.error) {
			message.error(translate("common.messages.refreshMarketFailed"));
		} else {
			message.success(translate("common.messages.refreshMarketSuccess"));
		}
	}

	// ctrl+r:按当前页面刷新市场索引或依赖列表(后台刷新,提交即提示)
	ctx.action("market.refresh", {
		shortcut: "ctrl+r",
		disabled: () =>
			!["market", "dependencies"].includes(
				router.currentRoute.value?.meta?.activity.id,
			),
		async action() {
			const activity = router.currentRoute.value?.meta?.activity.id;
			const dependencies = activity === "dependencies";
			const refreshing = dependencies
				? refreshingDependencies
				: refreshingMarket;
			if (refreshing.value) return;
			refreshing.value = true;
			if (!dependencies) pendingMarketRefreshFeedback.value = true;
			try {
				await send(
					dependencies ? "market/refresh-dependencies" : "market/refresh",
				);
				if (dependencies) {
					message.success(
						translate("common.messages.refreshDependenciesStarted"),
					);
				} else {
					message.success(translate("common.messages.refreshMarketSubmitted"));
					setTimeout(() => {
						if (!store.market?.refreshing) finishMarketRefreshFeedback();
					}, 300);
				}
			} catch (error) {
				if (!dependencies) pendingMarketRefreshFeedback.value = false;
				console.error(error);
				message.error(translate("common.messages.refreshFailed"));
			} finally {
				refreshing.value = false;
			}
		},
	});

	// 应用待安装变更:只有存在 pending override 时可用,打开确认对话框
	ctx.action("market.install", {
		disabled: () => !Object.keys(getPendingOverrides()).length,
		action() {
			showConfirm.value = true;
		},
	});

	// 手动添加依赖(搜索未收录的包名)
	ctx.action("dependencies.manual", {
		action() {
			showManual.value = true;
		},
	});

	// 安装历史
	ctx.action("dependencies.history", {
		action() {
			showInstallHistory.value = true;
		},
	});

	// 环境版本管理(快照列表)
	ctx.action("dependencies.versions", {
		action() {
			showEnvironmentVersions.value = true;
		},
	});

	// 市场页右上角菜单:应用变更 / 刷新(刷新中图标转圈并禁用)
	ctx.menu("market", [
		{
			id: ".install",
			icon: "check",
			label: () => translate("common.actions.apply"),
		},
		{
			id: ".refresh",
			icon: "refresh",
			label: () => translate("common.actions.refresh"),
			type: () =>
				refreshingMarket.value ||
				!store.market ||
				store.market.refreshing ||
				store.market.progress < store.market.total
					? "spin disabled"
					: "",
		},
	]);

	/** 是否有任意包的 registry 元数据仍在拉取(菜单刷新按钮据此禁用)。 */
	const registryRefreshing = () => {
		const target = store as MarketStore;
		return Object.values(target.registryStatus ?? {}).some(
			(status) => status.loading,
		);
	};

	// 依赖页右上角菜单:一键升级(图标有节日彩蛋)/应用变更/手动添加/
	// 历史/版本管理/刷新(依赖刷新或元数据拉取中则转圈禁用)
	ctx.menu("dependencies", [
		{
			id: ".upgrade",
			icon: () => {
				if (aprilFoolsIcon.value || forcedAprilFoolsIcon.value) return "bomb";
				if (koishiDayIcon.value) return "koishi";
				return "rocket";
			},
			label: () => translate("common.actions.upgradeAll"),
		},
		{
			id: "market.install",
			icon: "check",
			label: () => translate("common.actions.apply"),
		},
		{
			id: ".manual",
			icon: "add",
			label: () => translate("common.actions.manual"),
		},
		{
			id: ".history",
			icon: "info-full",
			label: () => translate("common.actions.history"),
		},
		{
			id: ".versions",
			icon: "file-archive",
			label: () => translate("common.actions.versionManagement"),
		},
		{
			id: "market.refresh",
			icon: "refresh",
			label: () => translate("common.actions.refresh"),
			type: () =>
				refreshingDependencies.value || registryRefreshing()
					? "spin disabled"
					: "",
		},
	]);

	// 依赖表变化后清理已完成的 pending override:
	// 待卸载的包真被卸载、或待升级的包已装到目标版本,就把该项从 override 移除
	ctx.effect(() => {
		return watch(
			() => store.dependencies,
			(value) => {
				if (!value) return;
				const overrides = getPendingOverrides();
				for (const key in overrides) {
					if (!overrides[key] && !value[key]) {
						// package to be removed has been removed
						delete overrides[key];
					} else if (value[key]?.request === overrides[key]) {
						// package has been installed to the right version
						delete overrides[key];
					}
				}
				void patchMarketNextData({ override: { ...overrides } });
			},
			{ immediate: true },
		);
	});

	// 市场后台刷新结束(refreshing 从 true 回落)时收敛刷新结果 toast
	ctx.effect(() => {
		return watch(
			() => store.market?.refreshing,
			(refreshing, previous) => {
				if (
					!pendingMarketRefreshFeedback.value ||
					refreshing ||
					previous !== true
				)
					return;
				finishMarketRefreshFeedback();
			},
		);
	});
}
