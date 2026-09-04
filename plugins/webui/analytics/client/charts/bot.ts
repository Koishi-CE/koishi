// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 各平台消息占比图：两层旭日图（sunburst）。
 *
 * 内层为平台，外层为该平台下的各机器人（以 bot 昵称展示，缺资料时回退 selfId），
 * 数值取 messageByBot 的日均收 / 发消息量（页签切换），全为 0 时不渲染。
 */
import type { Context } from "@koishi-ce/client";
import { createChart, Tooltip } from "./utils";

export default (ctx: Context) => {
	ctx.slot({
		type: "analytic-chart",
		component: createChart({
			title: "各平台消息占比",
			fields: ["analytics"],
			showTab: true,
			options({ analytics }, tab) {
				// render 侧已按 fields 守卫,此处仅为收窄可选的 store 键
				if (!analytics) return;
				// 把 { 平台: { selfId: 统计 } } 转成旭日图的层级 data 结构
				const data = Object.entries(
					analytics.messageByBot,
				).map(([key, value]) => ({
					name: key,
					children: Object.entries(value).map(
						([key, value]) => ({
							name: value.name || key,
							value: value[tab],
						}),
					),
				}));
				const total = data.reduce((sum, { children }) => {
					return (
						sum +
						children.reduce(
							(sum, { value }) => sum + value,
							0,
						)
					);
				}, 0);
				if (!total) return;

				return {
					tooltip: Tooltip.item(({ data }) => {
						return `${data.children ? "平台" : "昵称"}：${data.name}<br>日均消息数量：${+data.value.toFixed(1)}`;
					}),
					series: [
						{
							type: "sunburst",
							data,
							radius: ["0", "65%"],
							nodeClick: false,
							emphasis: {
								focus: "ancestor",
							},
							levels: [
								{},
								{
									label: {
										rotate: "tangential",
									},
								},
								{
									label: {
										position: "outside",
										padding: 3,
										silent: false,
									},
								},
							],
						},
					],
				};
			},
		}),
	});
};
