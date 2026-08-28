/**
 * 全体广播插件（broadcast）。
 *
 * 提供 `broadcast <message>` 指令（权限 4）：向全部频道推送消息，
 * 默认跳过标记为静默（silent）的频道。
 * 选项：`-f` 强制发送到静默频道；`-o` 仅发送到当前 bot 被指派的频道。
 * 依赖数据库（channel 表的 assignee / flag 字段）。
 */
import { Channel, type Context, Schema } from "@koishi-ce/koishi";
import zhCN from "../locales/zh-CN.yml";

/** 配置项（当前无可用配置） */
export type Config = {};

export const name = "broadcast";
export const inject = ["database"];
export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context) {
	ctx.i18n.define("zh-CN", zhCN);

	ctx
		.command("broadcast <message:text>", { authority: 4 })
		.option("forced", "-f")
		.option("only", "-o")
		.action(async ({ options, session }, message) => {
			if (!session || !options) return;
			if (!message) return session.text(".expect-text");
			if (!options.only) {
				// 非仅本 bot 模式：交给全局广播（覆盖所有 bot 的指派频道）
				await ctx.broadcast(message, Boolean(options.forced));
				return;
			}

			// -o 模式：只取当前平台、当前 bot 被指派的频道；非强制时需 flag 字段用于过滤静默频道
			const fields: ("id" | "flag")[] = ["id"];
			if (!options.forced) fields.push("flag");
			let channels = await ctx.database.getAssignedChannels(fields, {
				[session.platform]: [session.selfId],
			});
			if (!options.forced) {
				channels = channels.filter((g) => !(g.flag & Channel.Flag.silent));
			}
			await session.bot.broadcast(
				channels.map((channel) => channel.id),
				message,
			);
			return undefined;
		});
}
