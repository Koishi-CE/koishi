// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 每小时消息数量图：按时段汇总的柱状图（收 / 发页签切换），展示一天 24 小时
 * 的日均消息分布。x 轴是数值轴：第 i 小时的柱子画在 i + 0.5 处，
 * 使整点刻度落在柱子边界上（0:00 与 24:00 各占一端）。
 */
import type { Context } from "@koishi-ce/client";
import { createChart, Tooltip } from "./utils";

// 把小时中点值格式化为时段区间文案，如 9.5 → "9:00-10:00"
const formatHour = (value: number) =>
	`${(value - 0.5).toFixed()}:00-${(value + 0.5).toFixed()}:00`;

export default (ctx: Context) => {
	ctx.slot({
		type: "analytic-chart",
		component: createChart({
			title: "每小时消息数量",
			fields: ["analytics"],
			showTab: true,
			options({ analytics }, tab) {
				// render 侧已按 fields 守卫,此处仅为收窄可选的 store 键
				if (!analytics) return;
				// 当前页签下全天均为 0（对应方向无数据）则不渲染
				if (analytics.messageByHour.every((val) => !val[tab])) return;
				return {
					tooltip: Tooltip.axis<number[]>(([first]) => {
						if (!first) return "";
						const [x = 0] = first.data;
						const { dataIndex } = first;
						const source = analytics.messageByHour[dataIndex];
						const output = [
							`${formatHour(x)}`,
							`日均消息数量：${+(source?.[tab] || 0).toFixed(1)}`,
						];
						return output.join("<br>");
					}),
					xAxis: {
						type: "value",
						min: 0,
						max: 24,
						minInterval: 1,
						maxInterval: 4,
						axisLabel: {
							formatter: (value) => `${value}:00`,
						},
						axisPointer: {
							label: {
								formatter: ({ value }) => formatHour(value as number),
							},
						},
					},
					yAxis: {
						type: "value",
					},
					series: [
						{
							data: analytics.messageByHour.map((val, index) => [
								index + 0.5,
								val[tab] || 0,
							]),
							type: "bar",
							stack: "1",
						},
					],
				};
			},
		}),
	});
};
