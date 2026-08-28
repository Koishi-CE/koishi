/**
 * CommanderRegister：ctx.command() 的实现——命令注册与父子树构建。
 *
 * 解析定义串中的路径部分（支持 "." 与 "/" 分隔，"." 开头为相对父名），
 * 逐段创建或复用命令并维护父子关系；只有最后一段携带声明与配置。
 * 注册完成后统一广播 command-added，并把新建命令绑定到当前作用域
 * （作用域销毁时命令随之销毁）。
 */

import { Context } from "../../context";
import { Command } from "../command/command";
import { normalizeCommand } from "../normalize";
import { CommanderResolve } from "./resolve";

export class CommanderRegister extends CommanderResolve {
	/**
	 * 注册（或更新）一个命令。
	 *
	 * @param def 命令定义：路径 + 参数声明，如 "a.b/c <foo> [bar:text]"
	 * @param args 可选的 [desc, config]：描述与配置
	 * 路径中不存在的中间命令会被隐式创建（无声明无描述）；
	 * 已存在的命令则更新其配置。返回路径最后一段对应的命令。
	 */
	command(def: string, ...args: [Command.Config?] | [string, Command.Config?]) {
		const desc = typeof args[0] === "string" ? (args.shift() as string) : "";
		const config = args[0] as Command.Config;
		// def.split(" ", 1)[0] 提取首个空白前的路径部分；decl 为其后的声明串
		const path = normalizeCommand(def.split(" ", 1)[0] ?? def);
		const decl = def.slice(path.length);
		// 按 "." 与 "/" 的出现位置切分（保留分隔符，便于区分段类型）
		const segments = path.split(/(?=[./])/g);

		/** 链上当前游标（父命令），随遍历推进 */
		let parent: Command | undefined;
		/** 本次调用新建的第一个命令（用作作用域绑定的锚点） */
		let root: Command | undefined;
		const created: Command[] = [];
		segments.forEach((segment, index) => {
			const code = segment.charCodeAt(0);
			const name =
				code === 46
					? (parent?.name ?? "") + segment
					: code === 47
						? segment.slice(1)
						: segment;
			let command = this.get(name);
			if (command) {
				// 已存在：校验父子关系（禁止自引用 / 跨树重复挂载）后作为下一段的父级
				if (parent) {
					if (command === parent) {
						throw new Error(
							`cannot set a command (${command.name}) as its own subcommand`,
						);
					}
					if (command.parent) {
						if (command.parent !== parent) {
							throw new Error(
								`cannot create subcommand ${path}: ${command.parent.name}/${command.name} already exists`,
							);
						}
					} else {
						command.parent = parent;
					}
				}
				parent = command;
				return;
			}
			const isLast = index === segments.length - 1;
			// 只有最后一段携带声明与配置，中间隐式命令均为空定义
			command = new Command(
				name,
				isLast ? decl : "",
				this.ctx,
				isLast ? config : {},
			);
			command._disposables.push(
				this.ctx.i18n.define("", {
					[`commands.${command.name}.$`]: "",
					[`commands.${command.name}.description`]: isLast ? desc : "",
				}),
			);
			created.push(command);
			root ||= command;
			if (parent) {
				command.parent = parent;
			}
			parent = command;
		});

		if (!parent) throw new Error(`invalid command definition: ${def}`);
		Object.assign(parent.config, config);
		// 确保 config 就位后再广播 command-added，监听方读到的是最终配置
		created.forEach((command) => this.ctx.emit("command-added", command));
		parent[Context.current] = this.ctx;
		if (root) {
			const created = root;
			this.ctx.collect(`command <${created.name}>`, () => created.dispose());
		}
		return parent;
	}
}
