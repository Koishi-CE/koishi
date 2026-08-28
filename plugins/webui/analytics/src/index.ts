/**
 * analytics 插件（node 侧）：消息与指令的统计分析服务。
 *
 * 工作方式：
 * 1. 监听消息收发与指令执行事件，在内存中按 (日期, 小时, 维度…) 增量计数；
 * 2. 每隔 statsInternal（或跨小时）把内存缓冲 upsert 到数据库的
 *    analytics.message / analytics.command 两张表（列存计数，主键联合维度）；
 * 3. 前端拉取时（get → download）对近 recentDayCount 天的数据做分组聚合，
 *    产出数值指标与各图表所需的 Payload 推送给控制台。
 */
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

/** 收发消息计数对：send 为发出条数，receive 为收到条数。 */
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

	/** 上次落库时间，用于判断距下次上传是否超过 statsInternal。 */
	lastUpdate = new Date();
	/** 上次落库的小时数，跨小时（整点）时强制上传一次。 */
	updateHour = this.lastUpdate.getHours();
	/** 当前缓存的日期号（yyyymmdd），日期变化时缓存失效需重新聚合。 */
	cachedDate?: number;
	/** 当日的聚合结果缓存（Payload 的 Promise），同一天内复用。 */
	cachedData!: Promise<Analytics.Payload>;

	/** 消息计数内存缓冲（未落库部分）。 */
	private messages: Analytics.Message[] = [];
	/** 指令计数内存缓冲（未落库部分）。 */
	private commands: Analytics.Command[] = [];

	constructor(ctx: Context, config: Analytics.Config = {}) {
		super(ctx, "analytics");

		this.config = {
			statsInternal: config.statsInternal ?? Time.minute * 10,
			recentDayCount: config.recentDayCount ?? 7,
		};

		// 两张统计表：按 (日期, 小时, 业务维度) 联合主键存增量计数 count
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

		// 进程退出 / 插件卸载时强制把内存缓冲落库，避免丢失末段计数
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

	/**
	 * 向内存缓冲追加一次计数：缓冲中已有全部维度字段都相同的记录则 count + 1，
	 * 否则以 count = 1 追加新条目（deepEqual 逐字段比对，保证聚合键唯一）。
	 */
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

	/**
	 * 把内存缓冲整表 upsert 落库：命中联合主键的行在其 count 基础上累加，
	 * 未命中则插入新行；完成后清空缓冲。
	 */
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

	/**
	 * 落库入口（事件回调高频调用）：仅在距上次上传超过 statsInternal、
	 * 跨小时或 forced 时才真正执行上传，其余调用静默跳过。
	 *
	 * @param forced 是否无视时间间隔强制上传（退出 / 卸载时使用）
	 */
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

	/** 最近 N 天（不含今天）的日期号查询区间，供各聚合查询复用。 */
	private queryRecent(): Query.FieldExpr<number> {
		return {
			$gte: Time.getDateNumber() - this.config.recentDayCount,
			$lt: Time.getDateNumber(),
		};
	}

	/**
	 * 指令调用频率：近 N 天各指令的总调用次数 ÷ 天数，得到"日均调用次数"，
	 * 以指令名为键的字典返回（供饼图使用）。
	 *
	 * @param lengthTask 参与平均的天数（见 download 中的计算）
	 */
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

	/**
	 * DAU 历史：按天统计触发过指令的去重用户数（userId > 0 过滤未登录调用）。
	 * 返回数组下标为"距今天数"（0 = 今天），长度 recentDayCount + 1，
	 * 无数据的日期补 0。
	 */
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

	/**
	 * 各机器人消息频率：近 N 天按 (平台, 机器人) 分组求和后除以天数，
	 * 得到每个机器人的日均收发消息数；结构为 { 平台: { selfId: 统计+机器人资料 } }，
	 * 并尽量合并当前运行中的 bot.user 资料（昵称 / 头像等）供旭日图展示。
	 *
	 * @param lengthTask 参与平均的天数（见 download 中的计算）
	 */
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

	/**
	 * 按日历史消息量：不设日期下限地按天汇总全部历史（不含今天），
	 * 返回数组下标为"距今天数"（0 = 今天，恒为 0 值占位），
	 * 无记录的日期补 0。注意 result.length 由最久远记录决定。
	 */
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

	/**
	 * 按小时消息分布：近 N 天按小时汇总后除以天数，得到每个时段的日均消息量。
	 * 返回固定 24 个元素的数组（下标即小时），越界小时数据直接丢弃。
	 *
	 * @param lengthTask 参与平均的天数（见 download 中的计算）
	 */
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

	/**
	 * 执行一次全量聚合，产出推送前端的完整 Payload：
	 * 数值指标（用户 / 群组总数与昨日增量）+ 各图表数据
	 * （指令频率、DAU 历史、机器人 / 按日 / 按小时消息量）。
	 *
	 * 一次 download 会并发发起十余个数据库查询；lengthTask 先行启动，
	 * 其结果（有效天数，介于 1 与 recentDayCount 之间）供各"日均"类指标除算。
	 */
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
			// 用户总数
			this.ctx.database.eval("user", (row) => $.count(row.id)),
			// 昨日新增用户数（createdAt 落在昨天一整天）
			this.ctx.database.eval("user", (row) => $.count(row.id), {
				createdAt: {
					$gte: Time.fromDateNumber(Time.getDateNumber() - 1),
					$lt: Time.fromDateNumber(Time.getDateNumber()),
				},
			}),
			// 群组总数：channel 表中 id === guildId 的行即群本身（而非普通子频道）
			this.ctx.database.eval(
				"channel",
				() => $.sum(1),
				(row) => $.eq(row.id, row.guildId),
			),
			// 昨日新增群组数
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

	/**
	 * DataService 读取入口：按自然日缓存聚合结果——
	 * 当天内的重复拉取复用同一 Promise，跨天后才重新 download
	 * （全部统计都以天为最小粒度，日内无变化）。
	 */
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
	/** 统计记录的公共维度：日期号（yyyymmdd）、小时、机器人 selfId 与平台。 */
	export interface Index {
		id?: number;
		date: number;
		hour: number;
		selfId: string;
		platform: string;
	}

	/** 内存缓冲中的一条计数：公共维度 + 计数值。 */
	export interface Audit extends Index {
		count: number;
	}

	/** analytics.message 表行：公共维度 + 消息方向（send / receive）。 */
	export interface Message extends Index {
		type: string;
		count: number;
	}

	/** analytics.command 表行：公共维度 + 指令名、用户与频道。 */
	export interface Command extends Index {
		name: string;
		userId: number;
		channelId: string;
		count: number;
	}

	/** 推送给前端的聚合结果：数值指标与各图表数据。 */
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
