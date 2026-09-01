// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 性能数据采集服务（服务名 "status"）。
 *
 * 周期性采集三类指标并推送给控制台前端：
 * - CPU：进程占用率与整机占用率（基于两次采样差值计算）；
 * - 内存：进程 RSS 占比与整机已用占比；
 * - 机器人：每个 bot 最近一分钟的消息收发量（TickCounter 滑动窗口）。
 *
 * 另提供 `status` 指令，在聊天环境内以文本形式输出各机器人状态摘要。
 */

import { cpus, freemem, totalmem } from "node:os";
import { DataService } from "@koishi-ce/console";
import {
	type Bot,
	type Context,
	type Dict,
	Schema,
	Time,
	type Universal,
} from "@koishi-ce/koishi";
import zhCN from "../locales/zh-CN.yml";

declare module "@koishi-ce/koishi" {
	interface Bot {
		_messageSent: TickCounter;
		_messageReceived: TickCounter;
	}
}

/**
 * 滑动窗口计数器：以 60 个槽位统计最近一分钟内的事件次数。
 *
 * 每秒执行一次 tick，队头插入 0 并丢弃队尾，窗口随时间向前滑动；
 * add() 累加到当前秒所在的队头槽位，get() 求整个窗口的和。
 * 每个 bot 挂载两个实例（_messageSent / _messageReceived）分别统计收发消息。
 */
class TickCounter {
	/** 停止内部定时器（随上下文销毁由调用方触发）。 */
	public stop: () => void;

	/** 60 个槽位的环形数据，data[0] 恒为当前秒的计数。 */
	private data = new Array(60).fill(0);

	private tick = () => {
		this.data.unshift(0);
		this.data.splice(-1, 1);
	};

	constructor(ctx: Context) {
		this.stop = ctx.setInterval(() => this.tick(), Time.second);
	}

	/** 在当前秒的槽位上累加计数。 */
	public add(value = 1) {
		this.data[0] += value;
	}

	/** 返回最近一分钟内的总计数。 */
	public get() {
		return this.data.reduce((prev, curr) => prev + curr, 0);
	}

	/** 为指定 bot 初始化收/发两个计数器。 */
	static initialize(bot: Bot, ctx: Context) {
		bot._messageSent = new TickCounter(ctx);
		bot._messageReceived = new TickCounter(ctx);
	}
}

/** 负载率二元组：[app, total]，app 为本进程占比，total 为整机占比，取值 0~1。 */
export type LoadRate = [app: number, total: number];

// 模块级 CPU 采样状态：usage 保存上一次采样值，appRate / usedRate 为最近一次差值计算结果
let usage = getCpuUsage();
let appRate: number;
let usedRate: number;

/** 采集内存负载率：[进程 RSS / 总内存, 1 - 空闲内存 / 总内存]。 */
async function memoryRate(): Promise<LoadRate> {
	const total = totalmem();
	return [process.memoryUsage().rss / total, 1 - freemem() / total];
}

/**
 * 读取一次 CPU 累计时间快照。
 *
 * - app：进程用户态 CPU 时间（cpuUsage().user，毫秒）；
 * - used：所有核心的 累计时间 - 空闲时间（毫秒）；
 * - total：所有核心的累计时间总和（毫秒）。
 * 单次快照只是累计值，需经 updateCpuUsage() 做差才能得到占用率。
 */
function getCpuUsage() {
	let totalIdle = 0,
		totalTick = 0;
	const cpuInfo = cpus();
	const usage = process.cpuUsage().user;

	for (const cpu of cpuInfo) {
		for (const time of Object.values(cpu.times)) {
			totalTick += time;
		}
		totalIdle += cpu.times.idle;
	}

	return {
		// process.cpuUsage() 返回微秒，除以 1000 归一到毫秒
		app: usage / 1000,
		used: totalTick - totalIdle,
		total: totalTick,
	};
}

/**
 * 用新快照与上次快照的差值计算 CPU 占用率并缓存到模块级变量：
 * appRate = 本进程增量时间 / 全机总增量时间，usedRate 同理（整机口径）。
 */
function updateCpuUsage() {
	const newUsage = getCpuUsage();
	const totalDifference = newUsage.total - usage.total;
	appRate = (newUsage.app - usage.app) / totalDifference;
	usedRate = (newUsage.used - usage.used) / totalDifference;
	usage = newUsage;
}

/**
 * 性能数据服务：以 DataService 形式向前端广播 Payload，
 * 前端经 store.status 读取（键名即服务名 "status"）。
 */
class ProfileProvider extends DataService<ProfileProvider.Payload> {
	// 仅在 get() 内作读取判断，本类从不写入（恒为 undefined），
	// 用 declare + 显式 undefined 如实反映运行时形状，不产生字段初始化
	declare cached: ProfileProvider.Payload | undefined;

	// 基类链（cordis Service）上已有 config 成员，故需 override
	override config: ProfileProvider.Config;

	constructor(ctx: Context, config: ProfileProvider.Config) {
		super(ctx, "status");

		this.config = config;

		ctx.i18n.define("zh-CN", zhCN);

		// 就绪后按配置间隔刷新 CPU 占用率并推送性能数据
		const { tickInterval } = config;
		ctx.on("ready", () => {
			ctx.setInterval(
				() => {
					updateCpuUsage();
					this.refresh();
				},
				tickInterval ?? Time.second * 5,
			);
		});

		// 消息收发事件分别计入对应 bot 的滑动窗口计数器
		ctx.any().before("send", (session) => {
			session.bot._messageSent?.add(1);
		});

		ctx.any().on("message", (session) => {
			session.bot._messageReceived?.add(1);
		});

		ctx.bots.forEach((bot) => {
			TickCounter.initialize(bot, ctx);
		});

		// bot 列表变化时防抖刷新（同帧内多次事件只触发一次推送）
		const update = ctx.debounce(() => this.refresh(), 0);

		ctx.on("login-added", ({ bot }) => {
			TickCounter.initialize(bot, ctx);
			update();
		});

		ctx.on("login-removed", ({ bot }) => {
			bot._messageSent.stop();
			bot._messageReceived.stop();
			update();
		});

		ctx.on("login-updated", () => {
			update();
		});

		// 聊天侧指令：逐个输出机器人状态，末尾附加整体性能摘要
		ctx.command("status").action(async ({ session }) => {
			if (!session) return;
			const data = await this.get();
			const output = Object.values(data.bots).map((bot) => {
				return session.text(".bot", bot);
			});
			output.push(session.text(".epilog", data));
			return output.join("\n");
		});
	}

	/**
	 * 采集一帧性能数据：CPU 占用率、内存占用率与各机器人收发速率。
	 *
	 * @param forced 为 true 时跳过缓存强制重算（refresh 链路会传入）
	 */
	override async get(forced = false) {
		if (this.cached && !forced) return this.cached;
		const memory = await memoryRate();
		const cpu: LoadRate = [appRate, usedRate];
		const bots: Dict<ProfileProvider.BotData> = {};
		for (const bot of this.ctx.bots) {
			if (bot.hidden) continue;
			const paths = this.ctx.get("loader")?.paths(bot.ctx.scope);
			bots[bot.sid] = {
				...bot.toJSON(),
				error: bot.error?.message,
				messageSent: bot._messageSent.get(),
				messageReceived: bot._messageReceived.get(),
				// exactOptionalPropertyTypes：paths 可选属性不在 undefined 时展开
				...(paths ? { paths } : {}),
			};
		}
		return { memory, cpu, bots };
	}

	// erasableSyntaxOnly 禁止含运行时值的 namespace，
	// 原 namespace 内的 Config 常量移到此处的静态字段，对外形状不变
	static Config: Schema<ProfileProvider.Config> = Schema.object({
		tickInterval: Schema.natural()
			.role("ms")
			.description("性能数据推送的时间间隔。")
			.default(Time.second * 5),
	});
}

namespace ProfileProvider {
	export interface Config {
		/** 采集与推送性能数据的时间间隔（毫秒），默认 5 秒。 */
		tickInterval?: number;
	}

	/** 推送给前端的单个机器人数据：登录信息 + 错误消息 + 配置路径 + 收发速率。 */
	export interface BotData extends Universal.Login {
		error?: string;
		paths?: string[];
		messageSent: number;
		messageReceived: number;
	}

	/** 每次采集推送给前端的完整负载：内存 / CPU 负载率与机器人数据字典。 */
	export interface Payload {
		memory: LoadRate;
		cpu: LoadRate;
		bots: Dict<BotData>;
	}
}

export default ProfileProvider;
