import { DataService } from "@koishi-ce/console";
import {
	$,
	type Context,
	type Dict,
	deepEqual,
	Logger,
	pick,
	type Query,
	Schema,
	type Session,
	Time,
	type Universal,
} from "@koishi-ce/koishi";
import { resolve } from "path";

declare module "@koishi-ce/koishi" {
	interface Tables {
		"analytics.message": Analytics.Message;
		"analytics.command": Analytics.Command;
	}
}

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			analytics: Analytics;
		}
	}
}

export interface MessageStats {
	send: number;
	receive: number;
}

const logger = new Logger("analytics");

class Analytics extends DataService<Analytics.Payload> {
	static override inject = ["database", "console"];

	// 原本位于 namespace Analytics 的 export const Config;erasableSyntaxOnly
	// 禁止携带运行时值的 namespace,迁为类静态成员(loader 从插件类上读取静态 Config)
	static Config: Schema<Analytics.Config> = Schema.object({
		statsInternal: Schema.natural()
			.role("ms")
			.description("统计数据推送的时间间隔。")
			.default(Time.minute * 10),
		recentDayCount: Schema.natural()
			.description("统计最近几天的数据。")
			.default(7),
	});

	// 基类 Service 声明了 config: unknown;此处收敛为必填并在构造时归一化
	// (loader 经 Schema.default 注入,归一化仅兜底,不改变运行时取值)
	override config: Required<Analytics.Config>;

	lastUpdate = new Date();
	updateHour = this.lastUpdate.getHours();
	cachedDate?: number;
	cachedData!: Promise<Analytics.Payload>;

	private messages: Analytics.Message[] = [];
	private commands: Analytics.Command[] = [];

	constructor(ctx: Context, config: Analytics.Config = {}) {
		super(ctx, "analytics");

		this.config = {
			statsInternal: config.statsInternal ?? Time.minute * 10,
			recentDayCount: config.recentDayCount ?? 7,
		};

		ctx.model.extend(
			"analytics.message",
			{
				date: "integer",
				hour: "integer",
				type: "string(63)",
				selfId: "string(63)",
				platform: "string(63)",
				count: "integer",
			},
			{
				primary: ["date", "hour", "type", "selfId", "platform"],
			},
		);

		ctx.model.extend(
			"analytics.command",
			{
				date: "integer",
				hour: "integer",
				name: "string(63)",
				selfId: "string(63)",
				userId: "integer",
				channelId: "string(63)",
				platform: "string(63)",
				count: "integer",
			},
			{
				primary: [
					"date",
					"hour",
					"name",
					"selfId",
					"userId",
					"channelId",
					"platform",
				],
			},
		);

		ctx.on("exit", () => this.upload(true));

		ctx.on("dispose", async () => {
			await this.upload(true);
		});

		ctx.on("message", (session) => {
			this.addAudit(this.messages, {
				...this.createIndex(session),
				type: "receive",
			});
			this.upload();
		});

		ctx.on("send", (session) => {
			this.addAudit(this.messages, {
				...this.createIndex(session),
				type: "send",
			});
			this.upload();
		});

		ctx.any().before("command/execute", ({ command, session }) => {
			if (!command || !session) return;
			// 观察字段在类型上不可索引,按宽泛视图读取(与 createIndex 同理)
			// biome-ignore lint/suspicious/noExplicitAny: Session<never,...> 的 user
			const user = (session as Session<any, any, any>).user;
			this.addAudit(this.commands, {
				...this.createIndex(session),
				name: command.name,
				// 库表列声明为 integer,而 user.id 为字符串,这里按数值归一
				userId: +(user?.["id"] || 0),
				channelId: session.channelId ?? "",
			});
			this.upload();
		});

		ctx.console.addEntry({
			dev: resolve(__dirname, "../client/index.ts"),
			prod: resolve(__dirname, "../dist"),
		});
	}

	// 不协变,各事件回调处的具体泛型互不相同,内部工具方法统一放宽
	// biome-ignore lint/suspicious/noExplicitAny: Session 泛型在 user 观察字段上
	private createIndex(session: Session<any, any, any>): Analytics.Index {
		return {
			selfId: session.selfId,
			platform: session.platform,
			date: Time.getDateNumber(),
			hour: new Date().getHours(),
		};
	}

	private addAudit<T extends Analytics.Audit>(
		buffer: T[],
		index: Omit<T, "count">,
	) {
		const audit = buffer.find((data) =>
			deepEqual(pick(data, Object.keys(index) as (keyof T)[]), index),
		);
		if (audit) {
			audit.count += 1;
		} else {
			buffer.push({ ...index, count: 1 } as T);
		}
	}

	private async uploadAudit(
		table: "analytics.message" | "analytics.command",
		buffer: (Analytics.Message | Analytics.Command)[],
	) {
		if (!buffer.length) return;
		await this.ctx.database.upsert(table, (row) =>
			buffer.map((audit) => ({
				...audit,
				count: $.add($.ifNull(row.count, 0), audit.count),
			})),
		);
		buffer.splice(0);
	}

	async upload(forced = false) {
		const date = new Date();
		const dateHour = date.getHours();
		if (
			forced ||
			+date - +this.lastUpdate > this.config.statsInternal ||
			dateHour !== this.updateHour
		) {
			this.lastUpdate = date;
			this.updateHour = dateHour;
			await Promise.all([
				this.uploadAudit("analytics.message", this.messages),
				this.uploadAudit("analytics.command", this.commands),
			]);
			logger.debug("analytics updated");
		}
	}

	private queryRecent(): Query.FieldExpr<number> {
		return {
			$gte: Time.getDateNumber() - this.config.recentDayCount,
			$lt: Time.getDateNumber(),
		};
	}

	private async getCommandRate(lengthTask: Promise<number>) {
		const data = await this.ctx.database
			.select("analytics.command", {
				date: this.queryRecent(),
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

	private async getDauHistory() {
		const data = await this.ctx.database
			.select("analytics.command", {
				date: { $gte: Time.getDateNumber() - this.config.recentDayCount },
				userId: { $gt: 0 },
			})
			.groupBy(["date"], {
				count: (row) => $.count(row.userId),
			})
			.execute();
		const result: number[] = new Array(this.config.recentDayCount + 1).fill(0);
		const today = Time.getDateNumber();
		data.forEach((stat) => {
			result[today - stat.date] = stat.count;
		});
		return result;
	}

	private async getMessageByBot(lengthTask: Promise<number>) {
		const data = await this.ctx.database
			.select("analytics.message", {
				date: this.queryRecent(),
			})
			.groupBy(["type", "platform", "selfId"], {
				count: (row) => $.sum(row.count),
			})
			.execute();
		const length = await lengthTask;
		// 机器人资料(bot.user)运行时可能缺席,按 Partial 记录
		const result = {} as Dict<Dict<MessageStats & Partial<Universal.User>>>;
		data.forEach((stat) => {
			const bot = this.ctx.bots[`${stat.platform}:${stat.selfId}`];
			const entry = ((result[stat.platform] ||= {})[stat.selfId] ||= {
				...(bot?.user ?? {}),
				send: 0,
				receive: 0,
			});
			// type 列的取值集合由写入端约定为 send / receive 两种
			entry[stat.type as "send" | "receive"] = stat.count / length;
		});
		return result;
	}

	private async getMessageByDate() {
		const data = await this.ctx.database
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
			const entry = (result[today - stat.date] ||= { send: 0, receive: 0 });
			entry[stat.type as "send" | "receive"] = stat.count;
		});
		for (let i = 0; i < result.length; i++) {
			result[i] ||= { send: 0, receive: 0 };
		}
		return result;
	}

	private async getMessageByHour(lengthTask: Promise<number>) {
		const data = await this.ctx.database
			.select("analytics.message", {
				date: this.queryRecent(),
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
			entry[stat.type as "send" | "receive"] = stat.count / length;
		});
		return result;
	}

	async download(): Promise<Analytics.Payload> {
		const messageByDateTask = this.getMessageByDate();
		const lengthTask = messageByDateTask.then((data) => {
			return Math.min(Math.max(data.length - 1, 1), this.config.recentDayCount);
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
			this.ctx.database.eval("user", (row) => $.count(row.id)),
			this.ctx.database.eval("user", (row) => $.count(row.id), {
				createdAt: {
					$gte: Time.fromDateNumber(Time.getDateNumber() - 1),
					$lt: Time.fromDateNumber(Time.getDateNumber()),
				},
			}),
			this.ctx.database.eval(
				"channel",
				() => $.sum(1),
				(row) => $.eq(row.id, row.guildId),
			),
			this.ctx.database.eval(
				"channel",
				() => $.sum(1),
				(row) =>
					$.and(
						$.eq(row.id, row.guildId),
						$.gte(row.createdAt, Time.fromDateNumber(Time.getDateNumber() - 1)),
						$.lt(row.createdAt, Time.fromDateNumber(Time.getDateNumber())),
					),
			),
			this.getCommandRate(lengthTask),
			this.getDauHistory(),
			this.getMessageByBot(lengthTask),
			messageByDateTask,
			this.getMessageByHour(lengthTask),
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

	override async get() {
		const date = new Date();
		const dateNumber = Time.getDateNumber(date, date.getTimezoneOffset());
		if (dateNumber !== this.cachedDate) {
			this.cachedData = this.download();
			this.cachedDate = dateNumber;
		}
		return this.cachedData;
	}
}

namespace Analytics {
	export interface Index {
		id?: number;
		date: number;
		hour: number;
		selfId: string;
		platform: string;
	}

	export interface Audit extends Index {
		count: number;
	}

	export interface Message extends Index {
		type: string;
		count: number;
	}

	export interface Command extends Index {
		name: string;
		userId: number;
		channelId: string;
		count: number;
	}

	export interface Payload {
		userCount: number;
		userIncrement: number;
		guildCount: number;
		guildIncrement: number;
		dauHistory: number[];
		commandRate: Dict<number>;
		messageByBot: Dict<Dict<MessageStats & Partial<Universal.User>>>;
		messageByDate: MessageStats[];
		messageByHour: MessageStats[];
	}

	export interface Config {
		statsInternal?: number;
		recentDayCount?: number;
	}
}

export default Analytics;
