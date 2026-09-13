// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.
// upstream: koishijs/webui plugins/analytics/src/index.ts#L144-L294（v2.0.6 聚合查询与 download 编排段；上游为单文件，本仓拆分时抽离至本文件，同步时以其整体 diff 对照本目录）

/**
 * 聚合查询层：从入口 index.ts 的 Analytics 类抽离的无状态查询函数。
 * 原类私有方法参数化（this.ctx → ctx、this.config.recentDayCount →
 * recentDayCount）为模块级函数，由入口的 download() 薄委托调用；
 * 本文件不回导入口，返回类型靠推断、在入口侧的显式标注处把关。
 */

import {
	$,
	type Context,
	type Dict,
	type Query,
	Time,
	type Universal,
} from "@koishi-ce/koishi";

/**
 * 收发消息计数对：send 为发出条数，receive 为收到条数。
 * 入口 index.ts 导出的 MessageStats 的结构同型本地镜像（本文件不回导
 * 入口，结构类型系统下两边天然兼容）。
 */
interface MessageStats {
	send: number;
	receive: number;
}

/** 最近 N 天（不含今天）的日期号查询区间，供各聚合查询复用。 */
function queryRecent(
	recentDayCount: number,
): Query.FieldExpr<number> {
	return {
		$gte: Time.getDateNumber() - recentDayCount,
		$lt: Time.getDateNumber(),
	};
}

/**
 * 指令调用频率：近 N 天各指令的总调用次数 ÷ 天数，得到"日均调用次数"，
 * 以指令名为键的字典返回（供饼图使用）。
 *
 * @param ctx Koishi 上下文（数据库访问）
 * @param recentDayCount 统计最近几天的数据
 * @param lengthTask 参与平均的天数（见 download 中的计算）
 */
async function getCommandRate(
	ctx: Context,
	recentDayCount: number,
	lengthTask: Promise<number>,
) {
	const data = await ctx.database
		.select("analytics.command", {
			date: queryRecent(recentDayCount),
		})
		.groupBy(["name"], {
			count: (row) => $.sum(row.count),
		})
		.execute();
	const length = await lengthTask;
	const result = {} as Dict<number>;
	data.forEach((stat) => {
		result[stat.name] = stat.count / length;
	});
	return result;
}

/**
 * DAU 历史：按天统计触发过指令的去重用户数（userId > 0 过滤未登录调用）。
 * 返回数组下标为"距今天数"（0 = 今天），长度 recentDayCount + 1，
 * 无数据的日期补 0。
 *
 * @param ctx Koishi 上下文（数据库访问）
 * @param recentDayCount 统计最近几天的数据
 */
async function getDauHistory(
	ctx: Context,
	recentDayCount: number,
) {
	const data = await ctx.database
		.select("analytics.command", {
			date: {
				$gte: Time.getDateNumber() - recentDayCount,
			},
			userId: { $gt: 0 },
		})
		.groupBy(["date"], {
			count: (row) => $.count(row.userId),
		})
		.execute();
	const result: number[] = new Array(
		recentDayCount + 1,
	).fill(0);
	const today = Time.getDateNumber();
	data.forEach((stat) => {
		result[today - stat.date] = stat.count;
	});
	return result;
}

/**
 * 各机器人消息频率：近 N 天按 (平台, 机器人) 分组求和后除以天数，
 * 得到每个机器人的日均收发消息数；结构为 { 平台: { selfId: 统计+机器人资料 } }，
 * 并尽量合并当前运行中的 bot.user 资料（昵称 / 头像等）供旭日图展示。
 *
 * @param ctx Koishi 上下文（数据库访问与运行中机器人列表）
 * @param recentDayCount 统计最近几天的数据
 * @param lengthTask 参与平均的天数（见 download 中的计算）
 */
async function getMessageByBot(
	ctx: Context,
	recentDayCount: number,
	lengthTask: Promise<number>,
) {
	const data = await ctx.database
		.select("analytics.message", {
			date: queryRecent(recentDayCount),
		})
		.groupBy(["type", "platform", "selfId"], {
			count: (row) => $.sum(row.count),
		})
		.execute();
	const length = await lengthTask;
	// 机器人资料(bot.user)运行时可能缺席,按 Partial 记录
	const result = {} as Dict<
		Dict<MessageStats & Partial<Universal.User>>
	>;
	data.forEach((stat) => {
		const bot = ctx.bots[`${stat.platform}:${stat.selfId}`];
		const entry = ((result[stat.platform] ||= {})[
			stat.selfId
		] ||= {
			...(bot?.user ?? {}),
			send: 0,
			receive: 0,
		});
		// type 列的取值集合由写入端约定为 send / receive 两种
		entry[stat.type as "send" | "receive"] =
			stat.count / length;
	});
	return result;
}

/**
 * 按日历史消息量：不设日期下限地按天汇总全部历史（不含今天），
 * 返回数组下标为"距今天数"（0 = 今天，恒为 0 值占位），
 * 无记录的日期补 0。注意 result.length 由最久远记录决定。
 *
 * @param ctx Koishi 上下文（数据库访问）
 */
async function getMessageByDate(ctx: Context) {
	const data = await ctx.database
		.select("analytics.message", {
			date: { $lt: Time.getDateNumber() },
		})
		.groupBy(["type", "date"], {
			count: (row) => $.sum(row.count),
		})
		.orderBy("date", "desc")
		.execute();
	const today = Time.getDateNumber();
	const result: MessageStats[] = [];
	data.forEach((stat) => {
		const entry = (result[today - stat.date] ||= {
			send: 0,
			receive: 0,
		});
		entry[stat.type as "send" | "receive"] = stat.count;
	});
	for (let i = 0; i < result.length; i++) {
		result[i] ||= { send: 0, receive: 0 };
	}
	return result;
}

/**
 * 按小时消息分布：近 N 天按小时汇总后除以天数，得到每个时段的日均消息量。
 * 返回固定 24 个元素的数组（下标即小时），越界小时数据直接丢弃。
 *
 * @param ctx Koishi 上下文（数据库访问）
 * @param recentDayCount 统计最近几天的数据
 * @param lengthTask 参与平均的天数（见 download 中的计算）
 */
async function getMessageByHour(
	ctx: Context,
	recentDayCount: number,
	lengthTask: Promise<number>,
) {
	const data = await ctx.database
		.select("analytics.message", {
			date: queryRecent(recentDayCount),
		})
		.groupBy(["type", "hour"], {
			count: (row) => $.sum(row.count),
		})
		.execute();
	const length = await lengthTask;
	const result = new Array(24)
		.fill(null)
		.map(() => ({ send: 0, receive: 0 }));
	data.forEach((stat) => {
		const entry = result[stat.hour];
		if (!entry) return;
		entry[stat.type as "send" | "receive"] =
			stat.count / length;
	});
	return result;
}

/**
 * 执行一次全量聚合，产出推送前端的完整 Payload：
 * 数值指标（用户 / 群组总数与昨日增量）+ 各图表数据
 * （指令频率、DAU 历史、机器人 / 按日 / 按小时消息量）。
 *
 * 一次 download 会并发发起十余个数据库查询；lengthTask 先行启动，
 * 其结果（有效天数，介于 1 与 recentDayCount 之间）供各"日均"类指标除算。
 *
 * @param ctx Koishi 上下文（数据库访问）
 * @param recentDayCount 统计最近几天的数据
 */
export async function downloadAnalytics(
	ctx: Context,
	recentDayCount: number,
) {
	const messageByDateTask = getMessageByDate(ctx);
	const lengthTask = messageByDateTask.then((data) => {
		return Math.min(
			Math.max(data.length - 1, 1),
			recentDayCount,
		);
	});
	const [
		userCount,
		userIncrement,
		guildCount,
		guildIncrement,
		commandRate,
		dauHistory,
		messageByBot,
		messageByDate,
		messageByHour,
	] = await Promise.all([
		// 用户总数
		ctx.database.eval("user", (row) => $.count(row.id)),
		// 昨日新增用户数（createdAt 落在昨天一整天）
		ctx.database.eval("user", (row) => $.count(row.id), {
			createdAt: {
				$gte: Time.fromDateNumber(Time.getDateNumber() - 1),
				$lt: Time.fromDateNumber(Time.getDateNumber()),
			},
		}),
		// 群组总数：channel 表中 id === guildId 的行即群本身（而非普通子频道）
		ctx.database.eval(
			"channel",
			() => $.sum(1),
			(row) => $.eq(row.id, row.guildId),
		),
		// 昨日新增群组数
		ctx.database.eval(
			"channel",
			() => $.sum(1),
			(row) =>
				$.and(
					$.eq(row.id, row.guildId),
					$.gte(
						row.createdAt,
						Time.fromDateNumber(Time.getDateNumber() - 1),
					),
					$.lt(
						row.createdAt,
						Time.fromDateNumber(Time.getDateNumber()),
					),
				),
		),
		getCommandRate(ctx, recentDayCount, lengthTask),
		getDauHistory(ctx, recentDayCount),
		getMessageByBot(ctx, recentDayCount, lengthTask),
		messageByDateTask,
		getMessageByHour(ctx, recentDayCount, lengthTask),
	]);
	return {
		userCount,
		userIncrement,
		guildCount,
		guildIncrement,
		commandRate,
		dauHistory,
		messageByBot,
		messageByDate,
		messageByHour,
	};
}
