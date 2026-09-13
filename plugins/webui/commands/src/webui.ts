// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// upstream: koishijs/webui plugins/commands/src/index.ts L332-L390（installWebUI 段；上游为单文件 plugin-commands 3.5.5，本仓拆分时抽离至本文件，同步时以其整体 diff 对照本目录）

import { clientEntry } from "@koishi-ce/console";
import type CommandManager from "./index.ts";
import type { CommandData } from "./schema.ts";

/**
 * 注册 console 前端入口并监听管理面板的 RPC 事件。
 * 数据侧按需生成全量指令快照（带缓存，失效由 refresh 驱动）；
 * 事件侧均要求 authority 4（管理员）。
 */
export function installWebUI(manager: CommandManager) {
	manager.ctx.inject(["console"], (ctx) => {
		ctx.on("dispose", () => (manager.entry = undefined));

		manager.entry = ctx.console.addEntry(
			clientEntry(import.meta.url),
			() => {
				return (manager._cache ||= Object.fromEntries(
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
								manager.snapshots[command.name]?.create ??
								false,
							initial: manager.snapshots[command.name]
								?.initial || {
								aliases: command._aliases,
								config: command.config,
								options: command._options,
							},
							override: manager.snapshots[command.name]
								?.override || {
								aliases: command._aliases,
								// 无覆盖配置时以 null 占位（客户端按可空读取）
								config: null as never,
								options: {},
							},
							paths:
								manager.ctx
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
				const { command } = manager.ensure(name);
				manager.update(command, config, true);
				manager.refresh();
			},
			{ authority: 4 },
		);

		ctx.console.addListener(
			"command/teleport",
			(name, parent) => {
				const { command } = manager.ensure(name);
				manager.teleport(command, parent, true);
				manager.refresh();
			},
			{ authority: 4 },
		);

		ctx.console.addListener(
			"command/aliases",
			(name, aliases) => {
				const { command } = manager.ensure(name);
				manager.alias(command, aliases, true);
				manager.refresh();
			},
			{ authority: 4 },
		);

		ctx.console.addListener(
			"command/create",
			(name) => {
				manager.create(name);
				manager.refresh();
			},
			{ authority: 4 },
		);

		ctx.console.addListener(
			"command/remove",
			(name) => {
				manager.remove(name);
				manager.refresh();
			},
			{ authority: 4 },
		);

		ctx.console.addListener(
			"command/parse",
			(name, source) => {
				// 客户端仅对已存在的指令发起解析请求
				const command = manager.ctx.$commander.get(name);
				if (!command)
					throw new Error(`command not found: ${name}`);
				return command.parse(source);
			},
		);
	});
}
