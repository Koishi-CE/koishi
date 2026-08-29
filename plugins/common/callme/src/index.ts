/**
 * 称呼设置插件（callme）。
 *
 * 提供 `callme [name]` 指令（别名 `nn`，快捷调用“叫我 …”）：
 * 查询或修改当前用户的昵称（写入数据库 user.name）。
 * 其他插件可监听 `common/callme` 事件校验或拒绝昵称修改。
 */
import {
	type Context,
	h,
	RuntimeError,
	Schema,
	type Session,
} from "@koishi-ce/koishi";
import zhCN from "../locales/zh-CN.yml";

// 模块增强：新增 common/callme 事件，监听者返回字符串即可拦截昵称修改
declare module "@koishi-ce/koishi" {
	interface Events {
		"common/callme"(name: string, session: Session): string | undefined;
	}
}

/** 配置项（当前无可用配置） */
export type Config = Record<never, never>;

export const name = "callme";
export const inject = ["database"];
export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context) {
	ctx.i18n.define("zh-CN", zhCN);

	ctx
		.command("callme [name:text]")
		.userFields(["id", "name"])
		.alias("nn")
		.shortcut("叫我", { prefix: true, fuzzy: true })
		.action(async ({ session }, name) => {
			if (!session) return;
			const { user } = session;
			if (!user) return;
			if (!name) {
				if (user.name) {
					return session.text(".current", [session.username]);
				} else {
					return session.text(".unnamed");
				}
			}

			// 剥离消息元素，只保留纯文本内容（其余元素直接丢弃）
			name = h
				.transform(name, {
					text: true,
					default: false,
				})
				.trim();

			if (name === user.name) {
				return session.text(".unchanged");
			} else if (!name) {
				return session.text(".empty");
			}

			// 广播 common/callme 事件：任一监听者返回字符串即视为拦截
			const result = ctx.bail("common/callme", name, session);
			if (result) return result;

			// 昵称重名（duplicate-entry）给出专门提示，其余异常记日志并告知失败
			try {
				user.name = name;
				await user.$update();
				return session.text(".updated", [session.username]);
			} catch (error) {
				if (RuntimeError.check(error, "duplicate-entry")) {
					return session.text(".duplicate");
				} else {
					ctx.logger("common").warn(error);
					return session.text(".failed");
				}
			}
		});
}
