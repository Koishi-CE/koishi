// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * CommandCore：命令的身份与别名管理基类。
 *
 * 继承自 parser 的 CommandBase（声明 / 选项注册），在其之上补充：
 * 构造时把自身登记进 ctx.$commander 的命令列表、别名（alias）注册与
 * 全局重名校验、父子命令树（children / parent）与展示名（displayName）。
 * 继承链：CommandBase → CommandCore → CommandDefinition → Command。
 */

import { type Dict, remove } from "cosmokit";
import { Context } from "../../context/index.ts";
import { normalizeCommand } from "../normalize.ts";
import { CommandBase } from "../parser/index.ts";
import type { Command } from "./command.ts";

export class CommandCore extends CommandBase<Command.Config> {
	/** 子命令列表（parent setter 维护双向关系） */
	children: Command[] = [];

	/** 父命令；null 表示顶层命令 */
	_parent: Command | null = null;
	/** 别名表（键为归一化后的名字）；首个键即 displayName */
	_aliases: Dict<Command.Alias> = Object.create(null);

	constructor(
		name: string,
		decl: string,
		ctx: Context,
		config: Command.Config,
	) {
		super(name, decl, ctx, {
			showWarning: true,
			handleError: true,
			slash: true,
			...config,
		});
		// 兼容旧版 authority 写法：换算成 permissions 权限列表
		this.config.permissions ??= [`authority:${config?.authority ?? 1}`];
		this._registerAlias(name);
		// CommandCore 为非泛型基类，this 的多态类型无法直接窄化为 Command，
		// 经基类引用中转（Command → CommandCore 可赋值，故反向窄化合法）
		ctx.$commander._commandList.push(this as CommandCore as Command);
	}

	/** 当前调用方上下文：优先取触发本命令的动态作用域，否则回退注册时上下文 */
	get caller(): Context {
		return this[Context.current] || this.ctx;
	}

	/** 展示名：别名表中的第一个名字（即最先注册的别名） */
	get displayName() {
		return Object.keys(this._aliases)[0] ?? this.name;
	}

	set displayName(name: string) {
		this._registerAlias(name, true);
	}

	get parent() {
		return this._parent;
	}

	/** 设置父命令：自动维护双方的 children / _parent 双向关系 */
	set parent(parent: Command | null) {
		if (this._parent === parent) return;
		if (this._parent) {
			remove(this._parent.children, this as CommandCore as Command);
		}
		this._parent = parent;
		if (parent) {
			parent.children.push(this as CommandCore as Command);
		}
	}

	/**
	 * 注册一个别名。
	 *
	 * @param name 别名（支持 "." 开头的相对名，自动补全父命令前缀）
	 * @param prepend 是否置于别名表首位（影响 displayName）
	 * @param options 别名级配置：预设 args / options 与 filter
	 * @throws 别名已被其它命令占用时抛错
	 */
	_registerAlias(name: string, prepend = false, options: Command.Alias = {}) {
		name = normalizeCommand(name);
		if (name.startsWith(".")) name = (this.parent?.name ?? "") + name;

		// 全局查重：同名命令（含其它命令的别名）不可重复注册
		const previous = this.ctx.$commander.get(name);
		if (previous && previous !== (this as CommandCore)) {
			throw new Error(`duplicate command names: "${name}"`);
		}

		// 登记进自身别名表；prepend 时重建对象以保证键序
		const existing = this._aliases[name];
		if (existing) {
			if (prepend) {
				this._aliases = { [name]: existing, ...this._aliases };
			}
		} else if (prepend) {
			this._aliases = { [name]: options, ...this._aliases };
		} else {
			this._aliases[name] = options;
		}
	}

	/** 自定义 inspect 输出：日志中显示为 "Command <name>" 而非整个对象 */
	[Symbol.for("nodejs.util.inspect.custom")]() {
		return `Command <${this.name}>`;
	}

	/**
	 * 为命令添加一个或多个别名；带第二参数时可为该别名绑定预设参数与 filter。
	 * 注册后广播 command-updated 事件。
	 */
	alias(...names: string[]): this;
	alias(name: string, options: Command.Alias): this;
	alias(...args: string[] | [string, Command.Alias]) {
		if (typeof args[1] === "object") {
			this._registerAlias(args[0], false, args[1]);
		} else {
			// 走到此分支说明第二参不是 Alias 对象，所有实参均为别名
			for (const name of args) {
				if (typeof name === "string") this._registerAlias(name);
			}
		}
		this.caller.emit("command-updated", this as CommandCore as Command);
		return this;
	}

	/** @deprecated 命令不支持插件式复用，直接调用回调本身 */
	use<T extends Command, R extends unknown[]>(
		callback: (command: this, ...args: R) => T,
		...args: R
	): T {
		return callback(this, ...args);
	}
}
