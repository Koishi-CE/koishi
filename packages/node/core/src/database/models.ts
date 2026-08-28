import type { Context } from "../context";

/** 注册内置三表（user / binding / channel）的模型结构 */
export function registerModels(ctx: Context) {
	ctx.model.extend(
		"user",
		{
			id: "unsigned(8)",
			name: { type: "string", length: 255 },
			flag: "unsigned(8)",
			authority: "unsigned(4)",
			locales: "list(255)",
			permissions: "list",
			createdAt: "timestamp",
		},
		{
			autoInc: true,
		},
	);

	ctx.model.extend(
		"binding",
		{
			aid: "unsigned(8)",
			bid: "unsigned(8)",
			pid: "string(255)",
			platform: "string(255)",
		},
		{
			primary: ["pid", "platform"],
		},
	);

	ctx.model.extend(
		"channel",
		{
			id: "string(255)",
			platform: "string(255)",
			flag: "unsigned(8)",
			assignee: "string(255)",
			guildId: "string(255)",
			locales: "list(255)",
			permissions: "list",
			createdAt: "timestamp",
		},
		{
			primary: ["id", "platform"],
		},
	);
}
