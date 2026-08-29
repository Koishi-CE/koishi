/**
 * 内置三表（user / binding / channel）的 minato 模型注册。
 *
 * 把 tables.ts 中的 TS 接口翻译成 minato 的运行时字段描述
 * （字段类型、长度、主键、自增等），在数据库服务初始化时注册。
 */
import type { Context } from "../context/index.ts";

/** 注册内置三表（user / binding / channel）的模型结构 */
export function registerModels(ctx: Context) {
	// user 表：id 自增主键；list 类型字段用于 locales / permissions
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

	// binding 表：(pid, platform) 联合主键，同一平台账号只能绑定一个用户
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

	// channel 表：(id, platform) 联合主键
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
