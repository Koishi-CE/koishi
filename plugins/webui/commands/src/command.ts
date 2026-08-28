import type { Context } from "@koishi-ce/koishi";
import zhCN from "../locales/zh-CN.yml";
import type CommandManager from ".";

/**
 * 从对象中摘除一个键，返回被摘除的值（无则返回 undefined）。
 * @param object 目标对象
 * @param key 要摘除的键
 */
export function remove<O, K extends keyof O>(object: O, key: K) {
	const value = object[key];
	delete object[key];
	return value;
}

/**
 * 注册 `command` 聊天指令：在会话中直接管理指令的别名、父级与创建，
 * 等价于控制台面板的对应操作（均写回插件配置）。
 * @param ctx 运行上下文
 * @param manager 所属的指令管理器实例
 */
export default function (ctx: Context, manager: CommandManager) {
	ctx.i18n.define("zh-CN", zhCN);

	ctx
		.command("command <name>", { authority: 4, checkArgCount: true })
		// .option('option', '-o [key]')
		.option("create", "-c")
		.option("alias", "-a [name]")
		.option("unalias", "-A [name]")
		.option("rename", "-n [name]")
		.option("parent", "-p [name]")
		.option("parent", "-P, --no-parent", { value: "" })
		.action(async ({ options, session }, name) => {
			if (!options || !session) return;
			if (options.create) manager.create(name);
			if (!ctx.$commander.resolve(name)) {
				return session.text(".not-found");
			}

			const snapshot = manager.ensure(name);
			const command = snapshot.command;
			if (typeof options.alias === "string") {
				const item = command._aliases[String(options.rename ?? "")] || {};
				const aliases = { ...command._aliases, [options.alias]: item };
				manager.alias(command, aliases, true);
				delete options.alias;
			}
			if (typeof options.unalias === "string") {
				const aliases = { ...command._aliases };
				delete aliases[options.unalias];
				manager.alias(command, aliases, true);
				delete options.unalias;
			}
			if (typeof options.rename === "string") {
				const item = command._aliases[options.rename] || {};
				const aliases = { [options.rename]: item, ...command._aliases };
				manager.alias(command, aliases, true);
				delete options.rename;
			}
			if (typeof options.parent === "string") {
				manager.teleport(command, options.parent, true);
				delete options.parent;
			}
			return options.create
				? session.text(".created")
				: session.text(".updated");
		});
}
