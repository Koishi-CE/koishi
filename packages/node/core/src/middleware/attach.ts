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
			// attach group data
			const channelFields = new Set<Channel.Field>([
				"flag",
				"assignee",
				"guildId",
				"permissions",
				"locales",
			]);
			ctx.emit("before-attach-channel", session, channelFields);
			const channel = await session.observeChannel(channelFields);
			// for backwards compatibility
			channel.guildId = session.guildId ?? channel.guildId;

			// emit attach event
			if (await ctx.serial(session, "attach-channel", session)) return;

			// ignore some group calls
			if (channel.flag & Channel.Flag.ignore) return;
			if (channel.assignee !== session.selfId && !session.stripped.atSelf)
				return;
		}

		// attach user data
		// authority is for suggestion
		const userFields = new Set<User.Field>([
			"id",
			"flag",
			"authority",
			"permissions",
			"locales",
		]);
		ctx.emit("before-attach-user", session, userFields);
		const user = await session.observeUser(userFields);

		// emit attach event
		if (await ctx.serial(session, "attach-user", session)) return;

		// ignore some user calls
		if (user.flag & User.Flag.ignore) return;
	}

	ctx.emit(session, "attach", session);
	if (session.response) return session.response();
	return next();
}
