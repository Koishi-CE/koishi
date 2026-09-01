// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * echarts 按需装配模块（默认导出 vue-echarts 的 VChart 组件）。
 *
 * 只注册本插件四个图表用到的部分：柱状 / 折线 / 饼 / 旭日四种图型，
 * 直角坐标系与 tooltip 组件，以及 Canvas 渲染器，
 * 避免把整个 echarts 打进前端产物。
 * 经 utils.ts 的 defineAsyncComponent 异步引入，图表不渲染时不加载。
 */
import { BarChart, LineChart, PieChart, SunburstChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import VChart from "vue-echarts";

use([
	BarChart,
	CanvasRenderer,
	GridComponent,
	LineChart,
	TooltipComponent,
	PieChart,
	SunburstChart,
]);

export default VChart;
