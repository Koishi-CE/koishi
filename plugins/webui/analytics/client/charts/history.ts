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

// 星期的中文缩写，供 tooltip 中按 getDay() 取字符拼接"星期几"
const week = "日一二三四五六";

export default (ctx: Context) => {
	ctx.slot({
		type: "analytic-chart",
		component: createChart({
			title: "历史消息数量",
			fields: ["analytics"],
			showTab: true,
			options({ analytics }, tab) {
				// render 侧已按 fields 守卫,此处仅为收窄可选的 store 键
				if (!analytics) return;
				if (!analytics.messageByDate.length) return;
				const data = analytics.messageByDate.slice(1);

				return {
					tooltip: Tooltip.axis(([first]) => {
						if (!first) return "";
						const { name, value } = first;
						const day = new Date(name).getDay();
						return `${name} 星期${week[day]}<br>消息数量：${value}`;
					}),
					xAxis: {
						type: "category",
						data: data
							.map((_, index) =>
								new Date(
									Date.now() - (index + 1) * 86400000,
								).toLocaleDateString("zh-CN"),
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
