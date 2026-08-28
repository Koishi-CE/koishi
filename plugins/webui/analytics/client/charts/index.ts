/**
 * 图表组件聚合注册：把四个统计图表依次挂到 analytic-chart 插槽位
 * （最终展示顺序由各图表的注册顺序与 order 决定）：
 * - history：历史消息数量（按日折线，收 / 发切换）；
 * - hour：每小时消息数量（按时段柱状，收 / 发切换）；
 * - bot：各平台消息占比（平台 → 机器人两层旭日图，收 / 发切换）；
 * - command：指令调用频率（日均调用量饼图）。
 */
import type { Context } from "@koishi-ce/client";
import BotChart from "./bot";
import CommandChart from "./command";
import HistoryChart from "./history";
import HourChart from "./hour";

export default (ctx: Context) => {
	// 用户数量增长 频道数量增长
	// 消息数量 (收/发) 每小时 QPS (收/发)
	// 指令调用频率 机器人消息频率

	ctx.plugin(HistoryChart);
	ctx.plugin(HourChart);
	ctx.plugin(BotChart);
	ctx.plugin(CommandChart);
};
