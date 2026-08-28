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

const VChart = defineAsyncComponent(() => import("./echarts"));

export interface ChartOptions {
	title: string;
	fields?: (keyof Store)[];
	showTab?: boolean;
	options: (
		store: Store,
		tab: "send" | "receive",
	) => echarts.EChartsOption | undefined;
}

const tabValue = ref<"send" | "receive">("send");

export function createChart({
	title,
	fields = [],
	showTab,
	options,
}: ChartOptions) {
	return defineComponent({
		render: () => {
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
													(tabValue.value === "send" ? " active" : ""),
												onClick: () => (tabValue.value = "send"),
											},
											["发送"],
										),
										h(
											"span",
											{
												class:
													"tab-item" +
													(tabValue.value === "receive" ? " active" : ""),
												onClick: () => (tabValue.value = "receive"),
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
	item<T = CommonData>(
		formatter: Tooltip.FormatterCallback<Tooltip.FormatterCallbackParams<T>>,
	) {
		return {
			trigger: "item",
			formatter,
		} as unknown as echarts.TooltipComponentOption;
	},

	axis<T = CommonData>(
		formatter: Tooltip.FormatterCallback<Tooltip.FormatterCallbackParams<T>[]>,
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
