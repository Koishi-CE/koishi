// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { resolve } from "node:path";
import type { Entry } from "@koishi-ce/console";
import {
	type Argv,
	type Command,
	type Context,
	clone,
	type Dict,
	deepEqual,
	filterKeys,
	mapValues,
	remove,
	Schema,
} from "@koishi-ce/koishi";
import CommandExtension from "./command.ts";

/**
 * @koishi-ce/plugin-commands 的 node 侧入口。
 *
 * 核心是 {@link CommandManager}：以「初始快照 + 用户覆盖」双层结构在运行时改写
 * 指令树（别名 / 选项 / 配置 / 父子归属），并把覆盖部分持久化到插件配置；
 * 插件卸载时按快照恢复指令原状。同时向 console 注册前端入口并监听
 * 管理面板发来的 RPC 事件（增删改 / 移动 / 别名 / 参数解析）。
 */

declare module "@koishi-ce/console" {
	interface Events {
		"command/create"(name: string): void;
		"command/remove"(name: string): void;
		"command/update"(
			name: string,
			config: Pick<CommandState, "config" | "options">,
		): void;
		"command/teleport"(name: string, parent: string): void;
		"command/aliases"(
			name: string,
			aliases: Dict<Command.Alias>,
		): void;
		"command/parse"(name: string, source: string): Argv;
	}
}

interface Override extends Partial<CommandState> {
	name?: string;
	create?: boolean;
}

/**
 * 单条指令的覆盖项 Schema：只保留与初始状态不同的部分（别名 / 选项 / 配置）。
 * `name` 形如 "parent/child"，用于声明指令在指令树中的归属；
 * `aliases` 兼容「字典」与「字符串数组」两种写法（后者等价于值全为空对象的字典）。
 */
const Override: Schema<Override> = Schema.object({
	name: Schema.string(),
	create: Schema.boolean(),
	aliases: Schema.union([
		Schema.dict(
			Schema.union([
				Schema.object({
					// 内层 Schema.from(null) 运行时等价于 Schema.any()，显式写出以获得正确类型；
					// .default(null) 的空值占位超出 schemastery 类型定义，用精确断言放宽
					args: Schema.array(Schema.any()).default(
						null as never,
					),
					options: Schema.dict(Schema.any()).default(
						null as never,
					),
					filter: Schema.any(),
				}),
				Schema.transform(false, () => ({ filter: false })),
			]).default({} as never),
		),
		Schema.transform(Schema.array(String), (aliases) => {
			return Object.fromEntries(
				aliases.map((name) => [name, {}]),
			);
		}),
	]),
	options: Schema.dict(Schema.any()).default(null as never),
	config: Schema.any(),
});

/** 指令的一份完整状态：别名表、配置与选项声明。 */
export interface CommandState {
	aliases: Dict<Command.Alias>;
	config: Command.Config;
	options: Dict<Argv.OptionDeclaration>;
}

/**
 * 指令快照：记录插件加载时的初始状态与用户覆盖状态。
 * `initial` 用于插件卸载时恢复原状；`override` 是当前生效的用户改动；
 * `pending` 在目标父指令尚未注册时暂存其名称，等 command-added 事件再补挂。
 */
export interface Snapshot {
	create?: boolean;
	pending?: string | null;
	command: Command;
	parent: Command | null;
	initial: CommandState;
	override: CommandState;
}

interface Config extends Override {}

/** 插件配置 Schema：值为覆盖字典，也允许直接写字符串简写（仅声明归属）。 */
const Config: Schema<string | Config, Config> =
	Schema.union([
		Override,
		Schema.transform(String, (name) => ({
			name,
			aliases: {},
			config: {},
			options: {},
		})),
	]);

/** 下发给前端的一份指令数据：快照两态 + 树结构（children / paths）。 */
export interface CommandData {
	create: boolean;
	name: string;
	paths: string[];
	children: string[];
	initial: CommandState;
	override: CommandState;
}

/**
 * 指令管理器：本插件的主体服务。
 *
 * 职责：
 * - 启动时读取配置，对每条被覆盖的指令调用 {@link accept} 应用改动；
 * - 监听指令的增删改事件，维护快照与数据缓存；
 * - 暴露 alias / teleport / update 等变更方法（控制台 RPC 与 `command` 指令共用），
 *   并通过 {@link write} 把覆盖写回插件配置持久化；
 * - 卸载时把所有指令恢复到初始快照。
 */
export class CommandManager {
	static filter = false;
	// cordis 运行时等价读取 static Config 与 static schema（Config 优先），
	// 此处对齐 koishi 插件惯例改挂 Config，使 ctx.plugin 的 config 形参获得类型推断
	static Config: Schema<
		Dict<string | Config>,
		Dict<Config>
	> = Schema.dict(Config).hidden();

	private _tasks: Dict<() => void> = Object.create(null);
	private _cache: Dict<CommandData> | null = null;
	private entry: Entry<Dict<CommandData>> | undefined;
	private refresh: () => void;

	// erasableSyntaxOnly 禁用参数属性，改为显式字段并在构造器赋值
	private ctx: Context;
	private config: Dict<Config>;

	public snapshots: Dict<Snapshot> = Object.create(null);

	/**
	 * @param ctx 运行上下文
	 * @param config 插件配置：以指令名为键的覆盖字典（字符串简写由插件 Schema 在运行时归一化）
	 */
	constructor(ctx: Context, config: Dict<Config> = {}) {
		this.ctx = ctx;
		this.config = config;
		this.refresh = this.ctx.debounce(() => {
			this._cache = null;
			this.entry?.refresh();
		}, 0);

		for (const key in config) {
			const value = config[key];
			if (!value) continue;
			const command = ctx.$commander.get(key);
			if (command) {
				this.accept(command, value);
			} else if (value.create) {
				const command = ctx.command(key);
				this.accept(command, value);
			}
		}

		// 指令 API 是链式的，此刻指令可能尚未完成初始化，留到下一个事件循环再处理更稳妥
		ctx.on("command-added", async (cmd) => {
			this.init(cmd);
			for (const snapshot of Object.values(
				this.snapshots,
			)) {
				const { command, pending } = snapshot;
				if (!pending) continue;
				const parent = this.ctx.$commander.get(pending);
				if (!parent) continue;
				snapshot.pending = null;
				this._teleport(command, parent);
			}
			this.refresh();
		});

		ctx.on("command-updated", (cmd) => {
			this.init(cmd);
			this.refresh();
		});

		ctx.on("command-removed", (cmd) => {
			delete this._tasks[cmd.name];
			delete this.snapshots[cmd.name];
			for (const command of cmd.children) {
				const parent = this.snapshots[command.name]?.parent;
				if (!parent || parent === cmd) continue;
				this._teleport(command, parent);
			}
			this.refresh();
		});

		ctx.on(
			"dispose",
			() => {
				this._tasks = Object.create(null);
				for (const {
					command,
					parent,
					initial,
				} of Object.values(this.snapshots)) {
					command.config = initial.config;
					// 初始别名不可能包含 false 值（禁用是覆盖层才有的语义）
					command._aliases = initial.aliases;
					Object.assign(command._options, initial.options);
					this._teleport(command, parent);
				}
			},
			true,
		);

		ctx.plugin(CommandExtension, this);

		this.installWebUI();
	}

	/**
	 * 指令被（重新）添加或更新后，延后一个 tick 再应用配置中的覆盖，
	 * 避免与指令自身的链式初始化产生竞争；同一指令的重复触发会被合并。
	 */
	init(command: Command) {
		const config = this.config[command.name];
		if (!config) return;
		this._tasks[command.name] ||= this.ctx.setTimeout(
			() => {
				delete this._tasks[command.name];
				this.accept(command, config, true);
			},
			0,
		);
	}

	/**
	 * 取到指令对应的快照；不存在时以指令当前状态为初始值创建一份。
	 * @param name 指令全名
	 * @param create 标记该指令是否由本插件创建（创建后卸载时要连同指令一起销毁）
	 * @param patch 为 true 时先用指令现状回填快照（供其它插件改动后重新接管）
	 * @returns 该指令的快照
	 */
	ensure(name: string, create?: boolean, patch?: boolean) {
		// 调用方均保证该名称的指令存在（缺失时行为与原先一致，运行时抛错）
		const command = this.ctx.$commander.get(name);
		if (!command)
			throw new Error(`command not found: ${name}`);
		const snapshot = this.snapshots[command.name];
		if (patch && snapshot) {
			// 别名与选项可能已被其它插件修改，先把新出现的部分并入初始状态
			snapshot.initial.options = mapValues(
				command._options,
				(option, key) => {
					return (
						snapshot.initial.options[key] || clone(option)
					);
				},
			);
			for (const key of Object.keys(command._aliases)) {
				const alias = command._aliases[key];
				if (!alias) continue;
				if (snapshot.initial.aliases[key]) continue;
				if (snapshot.override.aliases[key]) continue;
				snapshot.initial.aliases[key] = alias;
			}
			snapshot.override.aliases = command._aliases;
			return snapshot;
		}
		return (this.snapshots[command.name] ||= {
			...(create !== undefined ? { create } : {}),
			command,
			parent: command.parent,
			initial: {
				aliases: { ...command._aliases },
				options: clone(command._options),
				config: clone(command.config),
			},
			override: {
				aliases: command._aliases,
				options: {},
				config: {},
			},
		});
	}

	/** 内部挂载实现：把指令从当前父节点摘下，挂到指定父节点（null 表示成为顶层指令）。 */
	_teleport(
		command: Command,
		parent: Command | null = null,
	) {
		if (command.parent === parent) return;
		if (command.parent) {
			remove(command.parent.children, command);
		}
		command.parent = parent;
	}

	/**
	 * 移动指令在指令树中的位置。
	 * 目标父指令尚未注册时记入 `pending`，待其注册后再补挂。
	 * @param command 待移动的指令
	 * @param name 目标父指令名（空串表示移到顶层）
	 * @param write 是否把归属变化写入插件配置
	 */
	teleport(command: Command, name: string, write = false) {
		// 调用前均已通过 ensure 建立快照
		const snapshot = this.snapshots[command.name];
		if (!snapshot)
			throw new Error(
				`snapshot not found: ${command.name}`,
			);
		snapshot.pending = null;
		const parent = this.ctx.$commander.get(name);
		if (name && !parent) {
			snapshot.pending = name;
		} else {
			this._teleport(command, parent);
		}

		if (write) {
			const config = (this.config[command.name] ||= {});
			config.name = `${name || ""}/${command.displayName}`;
			this.write(command);
		}
	}

	/**
	 * 整体替换指令的别名表。
	 * 与初始状态相同的别名不写入配置（保证配置里只留差异）。
	 * @param command 目标指令
	 * @param aliases 完整的新别名表（值或引用同一指令的显示名）
	 * @param write 是否写入插件配置
	 */
	alias(
		command: Command,
		aliases: Dict<Command.Alias>,
		write = false,
	) {
		// 调用前均已通过 ensure 建立快照
		const snapshot = this.snapshots[command.name];
		if (!snapshot)
			throw new Error(
				`snapshot not found: ${command.name}`,
			);
		const { initial, override } = snapshot;
		command._aliases = override.aliases = aliases;

		if (write) {
			const config = (this.config[command.name] ||= {});
			config.name = `${command.parent?.name || ""}/${command.displayName}`;
			config.aliases = filterKeys(aliases, (key, value) => {
				return !deepEqual(
					initial.aliases[key],
					value,
					true,
				);
			});
			this.write(command);
		}
	}

	/**
	 * 更新指令的配置与选项覆盖：先合并到运行中的指令上，再按需写回配置。
	 * @param command 目标指令
	 * @param data 新的覆盖（config / options 均为完整覆盖体）
	 * @param write 是否写入插件配置
	 */
	update(
		command: Command,
		data: Pick<CommandState, "config" | "options">,
		write = false,
	) {
		// 调用前均已通过 ensure 建立快照
		const snapshot = this.snapshots[command.name];
		if (!snapshot)
			throw new Error(
				`snapshot not found: ${command.name}`,
			);
		const { initial, override } = snapshot;
		override.config = data.config || {};
		override.options = data.options || {};
		command.config = Object.assign(
			{ ...initial.config },
			override.config,
		);
		for (const key in override.options) {
			const option = initial.options[key];
			if (!option) continue;
			command._options[key] = Object.assign(
				{ ...option },
				override.options[key],
			);
		}

		if (write) {
			const config = (this.config[command.name] ||= {});
			config.config = override.config;
			config.options = override.options;
			this.write(command);
		}
	}

	/** 注册一条新指令并标记为「本插件创建」，同时写入配置。 */
	create(name: string) {
		this.ctx.command(name);
		this.ensure(name, true);
		this.config[name] = { create: true };
		this.write();
	}

	/**
	 * 删除一条由本插件创建的指令：先清快照与配置，
	 * 把子指令交还给它们原本的父指令，最后销毁指令本体。
	 */
	remove(name: string) {
		const snapshot = this.snapshots[name];
		if (!snapshot) return;
		const commands = snapshot.command.children.slice();
		delete this.snapshots[name];
		delete this.config[name];
		for (const child of commands) {
			const parent =
				this.snapshots[child.name]?.parent ?? null;
			this._teleport(child, parent);
			const config = (this.config[child.name] ??= {});
			config.name = `${parent?.name || ""}/${child.displayName}`;
		}
		snapshot.command.dispose();
		this.write(...commands);
	}

	/**
	 * 把一份覆盖完整应用到指令上：建快照 → 覆盖配置与选项 → 移动归属 → 合并别名。
	 * @param target 目标指令
	 * @param override 覆盖项（可含 name / aliases / options / config / create）
	 * @param patch 是否以指令现状回填快照（见 {@link ensure} 的 patch 参数）
	 */
	accept(
		target: Command,
		override: Override,
		patch?: boolean,
	) {
		const { create, options = {}, config = {} } = override;

		// 建立快照，便于插件卸载时恢复
		this.ensure(target.name, create, patch);

		// 覆盖配置与选项
		this.update(target, { options, config });

		// 移动到新的父指令
		let name = override.name;
		if (name?.includes("/")) {
			const [parent = "", child] = name.split("/");
			name = child;
			this.teleport(target, parent);
		}

		// 合并别名与显示名
		this.alias(target, {
			...(name ? { [name]: {} } : {}),
			...target._aliases,
			...override.aliases,
		});

		this.refresh();
	}

	/**
	 * 把指定指令的覆盖状态写回插件配置（清掉空对象，避免配置膨胀），
	 * 随后触发 command-updated 事件并整体更新插件配置。
	 * 不传参数时仅刷新全部已建快照的指令。
	 */
	write(...commands: Command[]) {
		for (const command of commands) {
			const snapshot = this.ensure(command.name);
			// 正常调用路径均已先写入配置项；缺失时（原先会抛错）补空对象以继续流程
			const override = (this.config[command.name] ??= {});

			// config：空覆盖不落盘
			if (
				override.config &&
				!Object.keys(override.config).length
			) {
				delete override.config;
			}

			// options：空条目、空字典均不落盘
			for (const key in override.options) {
				if (
					override.options[key] &&
					!Object.keys(override.options[key]).length
				) {
					delete override.options[key];
				}
			}
			if (
				override.options &&
				!Object.keys(override.options).length
			) {
				delete override.options;
			}

			// aliases：空字典不落盘
			if (
				override.aliases &&
				!Object.keys(override.aliases).length
			) {
				delete override.aliases;
			}
			// name：与实际归属一致时不再保留（未改动父级的证据）
			if (override.name) {
				const initial = `${snapshot.parent?.name || ""}/${command.name}`;
				if (
					override.name === initial ||
					override.name === command.name
				) {
					delete override.name;
				}
			}

			if (!Object.keys(override).length) {
				delete this.config[command.name];
			}

			this.ctx.emit("command-updated", command);
		}
		this.ctx.scope.update(this.config, false);
	}

	/**
	 * 注册 console 前端入口并监听管理面板的 RPC 事件。
	 * 数据侧按需生成全量指令快照（带缓存，失效由 refresh 驱动）；
	 * 事件侧均要求 authority 4（管理员）。
	 */
	installWebUI() {
		this.ctx.inject(["console"], (ctx) => {
			ctx.on("dispose", () => (this.entry = undefined));

			this.entry = ctx.console.addEntry(
				process.env["KOISHI_BASE"]
					? [
							`${process.env["KOISHI_BASE"]}/dist/index.js`,
							`${process.env["KOISHI_BASE"]}/dist/style.css`,
						]
					: process.env["KOISHI_ENV"] === "browser"
						? [
								import.meta.url.replace(
									/\/src\/[^/]+$/,
									"/client/index.ts",
								),
							]
						: {
								dev: resolve(
									__dirname,
									"../client/index.ts",
								),
								prod: resolve(__dirname, "../dist"),
							},
				() => {
					return (this._cache ||= Object.fromEntries(
						ctx.$commander._commandList.map<
							[string, CommandData]
						>((command) => [
							command.name,
							{
								name: command.name,
								children: command.children.map(
									(child) => child.name,
								),
								create:
									this.snapshots[command.name]?.create ??
									false,
								initial: this.snapshots[command.name]
									?.initial || {
									aliases: command._aliases,
									config: command.config,
									options: command._options,
								},
								override: this.snapshots[command.name]
									?.override || {
									aliases: command._aliases,
									// 无覆盖配置时以 null 占位（客户端按可空读取）
									config: null as never,
									options: {},
								},
								paths:
									this.ctx
										.get("loader")
										?.paths(command.ctx.scope) || [],
							},
						]),
					));
				},
			);

			ctx.console.addListener(
				"command/update",
				(name, config) => {
					const { command } = this.ensure(name);
					this.update(command, config, true);
					this.refresh();
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"command/teleport",
				(name, parent) => {
					const { command } = this.ensure(name);
					this.teleport(command, parent, true);
					this.refresh();
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"command/aliases",
				(name, aliases) => {
					const { command } = this.ensure(name);
					this.alias(command, aliases, true);
					this.refresh();
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"command/create",
				(name) => {
					this.create(name);
					this.refresh();
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"command/remove",
				(name) => {
					this.remove(name);
					this.refresh();
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"command/parse",
				(name, source) => {
					// 客户端仅对已存在的指令发起解析请求
					const command = this.ctx.$commander.get(name);
					if (!command)
						throw new Error(`command not found: ${name}`);
					return command.parse(source);
				},
			);
		});
	}
}

export default CommandManager;
