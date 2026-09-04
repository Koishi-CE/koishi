// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 指令调用频率图：环形饼图，按日均调用次数降序排列各指令的占比
 * （数值来自 commandRate，无数据时不渲染）。
 */
import type { Context } from "@koishi-ce/client";
import { createChart, Tooltip } from "./utils";

export default (ctx: Context) => {
	ctx.slot({
		type: "analytic-chart",
		component: createChart({
			title: () => ctx.$i18n.t("analytics.command.title"),
			fields: ["analytics"],
			options({ analytics }) {
				// render 侧已按 fields 守卫,此处仅为收窄可选的 store 键
				if (!analytics) return;
				// 指令按日均调用量降序，饼图扇区自大到小排布
				const data = Object.entries(analytics.commandRate)
					.sort((a, b) => b[1] - a[1])
					.map(([name, value]) => ({ name, value }));
				if (!data.length) return;

				return {
					tooltip: Tooltip.item(({ data }) => {
						const output = [data.name];
						output.push(
							ctx.$i18n.t("analytics.command.tip", [
								+data.value.toFixed(1),
							]),
						);
						return output.join("<br>");
					}),
					series: [
						{
							type: "pie",
							data,
							radius: ["35%", "65%"],
							minShowLabelAngle: 3,
						},
					],
				};
			},
		}),
	});
};
