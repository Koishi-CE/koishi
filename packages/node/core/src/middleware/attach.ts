/**
 * 内置首号中间件：消息的"数据装配"（attach）流程。
 *
 * 在业务中间件执行前，为会话补齐频道与用户数据并触发相应事件，
 * 同时执行准入过滤（被忽略的频道/用户、非受理且未 @ 机器人的消息
 * 在此被丢弃）。这是消息进入指令系统的前置关卡。
 */
import type { Context } from "../context";
import { Channel, User } from "../database";
import type { Session } from "../session";
import type { Next } from "./next";

/** 消息attach 流程：装配频道 / 用户数据并触发相应事件 */
export async function attachSession(
	ctx: Context,
	session: Session,
	next: Next,
) {
	ctx.emit(session, "before-attach", session);

	if (ctx.database) {
		if (!session.isDirect) {
			// 装配群聊频道数据（字段集可被 before-attach-channel 监听者扩充）
			const channelFields = new Set<Channel.Field>([
				"flag",
				"assignee",
				"guildId",
				"permissions",
				"locales",
			]);
			ctx.emit("before-attach-channel", session, channelFields);
			const channel = await session.observeChannel(channelFields);
			// 向后兼容：以会话中的 guildId 为准回填频道记录
			channel.guildId = session.guildId ?? channel.guildId;

			// 触发 attach-channel 事件；返回 true 表示已处理完毕，短路流程
			if (await ctx.serial(session, "attach-channel", session)) return;

			// 忽略被标记的频道调用
			if (channel.flag & Channel.Flag.ignore) return;
			// 频道受理人不是本机器人且未 @ 机器人时，忽略该消息
			if (channel.assignee !== session.selfId && !session.stripped.atSelf)
				return;
		}

		// 装配用户数据
		// authority 字段供指令纠错建议（suggest）使用
		const userFields = new Set<User.Field>([
			"id",
			"flag",
			"authority",
			"permissions",
			"locales",
		]);
		ctx.emit("before-attach-user", session, userFields);
		const user = await session.observeUser(userFields);

		// 触发 attach-user 事件；返回 true 短路流程
		if (await ctx.serial(session, "attach-user", session)) return;

		// 忽略被标记的用户调用
		if (user.flag & User.Flag.ignore) return;
	}

	ctx.emit(session, "attach", session);
	// 快捷对话命中后直接以 response 回复，不再进入后续中间件
	if (session.response) return session.response();
	return next();
}
