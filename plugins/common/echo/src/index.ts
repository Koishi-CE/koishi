/**
 * 消息复述插件（echo）。
 *
 * 提供 `echo <message>` 指令：原样返回输入文本。
 * 权限 3 以上的选项：`-e` / `-E` 转义 / 反转义消息中的 CQ 码；
 * `-u` / `-c`（可配合 `-g` 指定群组）把消息发送到指定用户私聊或指定频道。
 */
import { type Context, h, Schema } from "@koishi-ce/koishi";
import zhCN from "../locales/zh-CN.yml";

/**
 * 解析 `platform:id` 形式的目标标识
 * @param target 形如 `platform:id` 的字符串
 * @returns [平台名, 目标 ID] 二元组
 */
export function parsePlatform(target: string): [platform: string, id: string] {
	const index = target.indexOf(":");
	const platform = target.slice(0, index);
	const id = target.slice(index + 1);
	return [platform, id] as any;
}

/** 配置项（当前无可用配置） */
export type Config = {};

export const name = "echo";
export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context, _config: Config) {
	ctx.i18n.define("zh-CN", zhCN);

	ctx
		.command("echo <message:text>")
		.option("escape", "-e", { authority: 3 })
		.option("unescape", "-E", { authority: 3 })
		.option("user", "-u [user:user]", { authority: 3 })
		.option("channel", "-c [channel:channel]", { authority: 3 })
		.option("guild", "-g [guild:string]", { authority: 3 })
		.action(async ({ options, session }, message) => {
			if (!session || !options) return;
			if (!message) return session.text(".expect-text");

			// 用数组包裹，避免返回内容在发送环节再被反转义
			let content: any = [message];
			if (options.unescape) {
				content = h.parse(message);
			} else if (options.escape) {
				content = [h.escape(message)];
			}

			// 指定了 -u / -c 时改为向目标发送，而不是回复当前会话
			const target = options.user || options.channel;
			if (target) {
				const [platform, id] = parsePlatform(target);
				const bot = ctx.bots.find((bot) => bot.platform === platform);
				if (!bot) {
					return session.text(".platform-not-found");
				} else if (options.user) {
					await bot.sendPrivateMessage(id, content, session.guildId);
				} else {
					await bot.sendMessage(id, content, options.guild);
				}
				return;
			}

			return content;
		});
}
