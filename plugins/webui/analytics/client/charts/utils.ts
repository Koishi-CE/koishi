// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 图表组件工厂：为各统计图表提供统一的卡片外壳与公共装配逻辑。
 *
 * createChart() 生成的组件以 k-card 为容器，标题栏可选挂"发送 / 接收"切换页签
 * （tabValue 为全组件共享的模块级状态，所有图表同步切换）；
 * 图表本体是异步加载的 vue-echarts，options() 回调按当前 store 数据与页签
 * 产出 echarts 配置，返回 undefined 时整个卡片不渲染（数据未就绪 / 为空）。
 */
import { type Store, store } from "@koishi-ce/client";
import type * as echarts from "echarts";
import {
	defineAsyncComponent,
	defineComponent,
	h,
	ref,
	resolveComponent,
} from "vue";
import "./index.scss";

// 异步加载按需装配的 echarts，避免首屏即拉入图表代码
const VChart = defineAsyncComponent(
	() => import("./echarts"),
);

/** createChart 的入参描述。 */
export interface ChartOptions {
	/** 卡片标题。 */
	title: string;
	/** 依赖的 store 键；任一未就绪则整个卡片不渲染。 */
	fields?: (keyof Store)[];
	/** 是否显示"发送 / 接收"切换页签。 */
	showTab?: boolean;
	/**
	 * 依据 store 与当前页签产出 echarts option；
	 * 返回 undefined 表示暂不渲染（由调用方自行判断数据可用性）。
	 */
	options: (
		store: Store,
		tab: "send" | "receive",
	) => echarts.EChartsOption | undefined;
}

// 所有图表共享的收 / 发页签状态（模块级单例）
const tabValue = ref<"send" | "receive">("send");

/**
 * 图表组件工厂：返回包装好的 Vue 组件，供 ctx.slot() 挂到 analytic-chart 插槽。
 *
 * @param options 图表配置（标题 / 依赖字段 / 页签 / option 生成回调）
 */
export function createChart({
	title,
	fields = [],
	showTab,
	options,
}: ChartOptions) {
	return defineComponent({
		render: () => {
			// 依赖的 store 键任一缺失（对应服务未启动）则不渲染
			if (!fields.every((key) => store[key])) return null;
			const option = options(store, tabValue.value);
			if (!option) return;
			return h(
				resolveComponent("k-card"),
				{ class: "frameless analytic-chart" },
				{
					header: () => [
						h("span", { class: "left" }, [title]),
						...(showTab
							? [
									h("span", { class: "right" }, [
										h(
											"span",
											{
												class:
													"tab-item" +
													(tabValue.value === "send"
														? " active"
														: ""),
												onClick: () =>
													(tabValue.value = "send"),
											},
											["发送"],
										),
										h(
											"span",
											{
												class:
													"tab-item" +
													(tabValue.value === "receive"
														? " active"
														: ""),
												onClick: () =>
													(tabValue.value = "receive"),
											},
											["接收"],
										),
									]),
								]
							: []),
					],
					default: () => {
						return h(VChart, { option, autoresize: true });
					},
				},
			);
		},
	});
}

/** 图表数据点的通用形状（饼图 / 旭日图的 name-value 结构）。 */
interface CommonData {
	name: string;
	value: number;
	children?: CommonData;
}

export namespace Tooltip {
	export type FormatterCallback<T> = (params: T) => string;
	export type FormatterCallbackParams<T> = Omit<
		echarts.DefaultLabelFormatterCallbackParams,
		"data"
	> & { data: T };
}

// 与上方纯类型 namespace 合并的同名值对象:erasableSyntaxOnly 禁止携带
// 运行时值的 namespace,Tooltip.item / Tooltip.axis 迁移至此
export const Tooltip = {
	// echarts 顶层 tooltip.formatter 的参数以 TopLevelFormatterParams 表达,
	// 无法参数化到各图表自定义的 data 类型;运行时由 series data 实际类型决定
	/**
	 * item 触发模式的 tooltip 配置（悬停单个数据项时触发）。
	 *
	 * @param formatter 格式化回调，T 为该图表 series data 的元素类型
	 */
	item<T = CommonData>(
		formatter: Tooltip.FormatterCallback<
			Tooltip.FormatterCallbackParams<T>
		>,
	) {
		return {
			trigger: "item",
			formatter,
		} as unknown as echarts.TooltipComponentOption;
	},

	/**
	 * axis 触发模式的 tooltip 配置（悬停坐标轴时触发，配十字准线 axisPointer）。
	 *
	 * @param formatter 格式化回调，T 为该图表 series data 的元素类型
	 */
	axis<T = CommonData>(
		formatter: Tooltip.FormatterCallback<
			Tooltip.FormatterCallbackParams<T>[]
		>,
	) {
		return {
			trigger: "axis",
			axisPointer: {
				type: "cross",
			},
			formatter,
		} as unknown as echarts.TooltipComponentOption;
	},
};
