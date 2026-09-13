// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// upstream: koishijs/webui plugins/commands/src/index.ts L6-L70（声明层段；上游为单文件 plugin-commands 3.5.5，本仓拆分时抽离至本文件，同步时以其整体 diff 对照本目录）

import {
	type Argv,
	type Command,
	type Dict,
	Schema,
} from "@koishi-ce/koishi";

/**
 * 插件配置与指令状态的声明层：覆盖项、快照与前端数据接口及其 Schema，
 * 供 index.ts 的 CommandManager 与 webui.ts 的入口注册消费。
 */

export interface Override extends Partial<CommandState> {
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

export interface Config extends Override {}

/** 插件配置 Schema：值为覆盖字典，也允许直接写字符串简写（仅声明归属）。 */
export const Config: Schema<string | Config, Config> =
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
