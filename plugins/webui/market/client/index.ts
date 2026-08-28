/**
 * @file market-next console 前端的入口装配模块。
 *
 * 模块职责:
 * - 作为 Koishi console 插件的默认导出,在注册时完成 i18n 注册、页面注册
 *   (setupPages)与全局动作/菜单注册(setupActions);
 * - 挂载三组全局 watch:防止 store.market.data 被 Vue 深代理(性能保护)、
 *   修复服务端推送冲掉的快照数据(restoreMarketSnapshot)、快照换版后
 *   重放按需 lookup(refreshMarketLookups)。
 *
 * 消费方:由 Koishi console 按客户端入口约定加载(whole/共享 bundle 均指向此处)。
 */

import { type Context, global, store } from "@koishi-ce/client";
import { isReactive, markRaw, toRaw, watch } from "vue";
import { setupActions } from "./app/actions";
import { setupPages } from "./app/pages";
import { refreshMarketLookups, restoreMarketSnapshot } from "./market/state";
import { registerMarketNextI18n } from "./shared/i18n";
import "./shared/icons";
import "./shared/styles/scrollbars.scss";
import "./shared/styles/version-select.scss";

import "virtual:uno.css";

/** console 插件注册入口:注册 i18n → 挂全局 watch → 装配页面与动作。 */
export default (ctx: Context) => {
	registerMarketNextI18n(ctx);

	// 开发模式下打印入口注册/卸载耗时,便于排查热重载问题
	if (global.devMode) {
		const registeredAt = performance.now();
		console.info("[market-next] console entry registered");
		ctx.effect(() => () => {
			console.info(
				`[market-next] console entry disposed after ${Math.round(performance.now() - registeredAt)}ms`,
			);
		});
	}

	// Market indexes contain thousands of nested objects. Keep the index raw so
	// opening market-next does not turn the entire Console store into deep Vue proxies.
	ctx.effect(() =>
		watch(
			() => store.market?.data,
			(data) => {
				if (!data || !isReactive(data)) return;
				const raw = markRaw(toRaw(data));
				if (store.market) store.market.data = raw;
			},
			{ immediate: true, flush: "sync" },
		),
	);

	// 服务端全量推送 store.market 时可能把 data 换成新的可代理对象:
	// 此处兜底恢复 shallowRef 里的完整快照(见 market/state.ts 的 restoreMarketSnapshot)
	ctx.effect(() =>
		watch(
			() => store.market,
			() => {
				restoreMarketSnapshot();
			},
			{ immediate: true, flush: "sync" },
		),
	);

	// 快照 dataVersion 变化(服务端刷新了市场索引)后,把历史 lookup 请求全部重放
	ctx.effect(() =>
		watch(
			() => store.market?.dataVersion,
			(version, previous) => {
				if (version == null || previous == null || version === previous) return;
				void refreshMarketLookups().catch((error) => {
					console.error(
						"[market-next] failed to refresh market lookups",
						error,
					);
				});
			},
		),
	);

	// 装配市场/依赖两个页面与全部全局对话框 slot
	setupPages(ctx);
	// 注册全局动作(ctrl+r 刷新等)与页面右上角菜单、pending override 清理 watch
	setupActions(ctx);
};
