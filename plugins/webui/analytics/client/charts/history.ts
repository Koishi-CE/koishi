// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 历史消息数量图：按日汇总的平滑折线图（收 / 发页签切换）。
 *
 * messageByDate 的下标 0 是恒为 0 的"今天"占位，故 slice(1) 丢弃；
 * x 轴从今天往前逐日生成日期标签后与数据一起反转，形成从早到晚的时间轴。
 */
import type { Context } from "@koishi-ce/client";
import { createChart, Tooltip } from "./utils";

export default (ctx: Context) => {
	ctx.slot({
		type: "analytic-chart",
		component: createChart({
			title: () => ctx.$i18n.t("analytics.history.title"),
			fields: ["analytics"],
			showTab: true,
			options({ analytics }, tab) {
				// render 侧已按 fields 守卫,此处仅为收窄可选的 store 键
				if (!analytics) return;
				if (!analytics.messageByDate.length) return;
				const data = analytics.messageByDate.slice(1);
				// 当前界面语言（x 轴日期格式与星期缩写均随之切换）
				const locale = ctx.$i18n.i18n.global.locale.value;

				return {
					tooltip: Tooltip.axis(([first]) => {
						if (!first) return "";
						const { name, value } = first;
						const day = new Date(name).getDay();
						// weekdays 为空格分隔的星期缩写表（词典提供）
						const weekday = ctx.$i18n
							.t("analytics.history.weekdays")
							.split(" ")[day];
						return ctx.$i18n.t("analytics.history.tip", [
							name,
							weekday,
							value,
						]);
					}),
					xAxis: {
						type: "category",
						data: data
							.map((_, index) =>
								new Date(
									Date.now() - (index + 1) * 86400000,
								).toLocaleDateString(locale),
							)
							.reverse(),
					},
					yAxis: {
						type: "value",
					},
					series: {
						type: "line",
						smooth: true,
						data: data.map((stats) => stats[tab]).reverse(),
					},
				};
			},
		}),
	});
};
