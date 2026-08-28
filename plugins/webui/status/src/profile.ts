import { DataService } from "@koishi-ce/console";
import {
	type Bot,
	type Context,
	type Dict,
	Schema,
	Time,
	type Universal,
} from "@koishi-ce/koishi";
import { cpus, freemem, totalmem } from "os";
import zhCN from "./locales/zh-CN.yml";

declare module "@koishi-ce/koishi" {
	interface Bot {
		_messageSent: TickCounter;
		_messageReceived: TickCounter;
	}
}

class TickCounter {
	public stop: () => void;

	private data = new Array(60).fill(0);

	private tick = () => {
		this.data.unshift(0);
		this.data.splice(-1, 1);
	};

	constructor(ctx: Context) {
		this.stop = ctx.setInterval(() => this.tick(), Time.second);
	}

	public add(value = 1) {
		this.data[0] += value;
	}

	public get() {
		return this.data.reduce((prev, curr) => prev + curr, 0);
	}

	static initialize(bot: Bot, ctx: Context) {
		bot._messageSent = new TickCounter(ctx);
		bot._messageReceived = new TickCounter(ctx);
	}
}

export type LoadRate = [app: number, total: number];

let usage = getCpuUsage();
let appRate: number;
let usedRate: number;

async function memoryRate(): Promise<LoadRate> {
	const total = totalmem();
	return [process.memoryUsage().rss / total, 1 - freemem() / total];
}

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
		// microsecond values
		app: usage / 1000,
		used: totalTick - totalIdle,
		total: totalTick,
	};
}

function updateCpuUsage() {
	const newUsage = getCpuUsage();
	const totalDifference = newUsage.total - usage.total;
	appRate = (newUsage.app - usage.app) / totalDifference;
	usedRate = (newUsage.used - usage.used) / totalDifference;
	usage = newUsage;
}

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

		ctx.any().before("send", (session) => {
			session.bot._messageSent?.add(1);
		});

		ctx.any().on("message", (session) => {
			session.bot._messageReceived?.add(1);
		});

		ctx.bots.forEach((bot) => {
			TickCounter.initialize(bot, ctx);
		});

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
	// biome-ignore lint/style/useNamingConvention: 插件 Schema 约定为 PascalCase 的 Config 静态属性
	static Config: Schema<ProfileProvider.Config> = Schema.object({
		tickInterval: Schema.natural()
			.role("ms")
			.description("性能数据推送的时间间隔。")
			.default(Time.second * 5),
	});
}

namespace ProfileProvider {
	export interface Config {
		tickInterval?: number;
	}

	export interface BotData extends Universal.Login {
		error?: string;
		paths?: string[];
		messageSent: number;
		messageReceived: number;
	}

	export interface Payload {
		memory: LoadRate;
		cpu: LoadRate;
		bots: Dict<BotData>;
	}
}

export default ProfileProvider;
