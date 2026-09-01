// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 命令校验插件：权限定义 + 执行前的两类校验。
 *
 * 注册两套权限定义（命令级 command:(name)、选项级 command:(name):option:(name2)，
 * 声明其依赖与继承关系供权限系统判定；再挂两条 before("command/execute") 钩子：
 * 1. 用户权限校验：命令本体与本次传入的选项逐一测试；
 * 2. argv 校验：参数数量（可交互式追问补全）与未知选项检查。
 * 校验返回的字符串会作为回复直接输出（showWarning 可关闭提示）。
 */

import { isNullable } from "cosmokit";
import type { Context } from "../context/index.ts";
import type { Argv } from "./parser/index.ts";

export default function validate(ctx: Context) {
	// 命令级权限：依赖 = 显式 dependencies + 父命令权限；继承 = config.permissions
	ctx.permissions.define("command:(name)", {
		depends: ({ name }) => {
			const command = ctx.$commander.get(name);
			if (!command) return;
			const depends = [...(command.config.dependencies ?? [])];
			if (command.parent) depends.push(`command:${command.parent.name}`);
			return depends;
		},
		inherits: ({ name }) => {
			return ctx.$commander.get(name)?.config.permissions;
		},
		list: () => {
			return ctx.$commander._commandList.map(
				(command) => `command:${command.name}`,
			);
		},
	});

	// 选项级权限：依赖与继承取自选项自身的注册配置
	ctx.permissions.define("command:(name):option:(name2)", {
		depends: ({ name, name2 }) => {
			return ctx.$commander.get(name)?._options[name2]?.dependencies;
		},
		inherits: ({ name, name2 }) => {
			return ctx.$commander.get(name)?._options[name2]?.permissions;
		},
		list: () => {
			return ctx.$commander._commandList.flatMap((command) => {
				return Object.keys(command._options).map(
					(name) => `command:${command.name}:option:${name}`,
				);
			});
		},
	});

	// 用户权限校验：命令本体 + 用户实际传入的每个选项都要通过测试
	ctx.before(
		"command/execute",
		async (argv: Argv<"authority">): Promise<string | undefined> => {
			const { session, options, command } = argv;
			if (!session?.user || !command) return undefined;

			const sendHint = (message: string, ...param: unknown[]) =>
				command.config.showWarning ? session.text(message, param) : "";

			// 权限测试：命令本体与传入选项的权限一并校验
			const permissions = [`command:${command.name}`];
			for (const option of Object.values(command._options)) {
				const { name } = option;
				if (name !== undefined && name in (options ?? {})) {
					permissions.push(`command:${command.name}:option:${name}`);
				}
			}
			if (!(await ctx.permissions.test(permissions, session))) {
				return sendHint("internal.low-authority");
			}
			return undefined;
		},
		true,
	);

	// argv 校验：参数数量与未知选项
	ctx.before(
		"command/execute",
		async (argv: Argv): Promise<string | undefined> => {
			const { args = [], options = {}, command, session } = argv;
			if (!command || !session) return undefined;
			const sendHint = (message: string, ...param: unknown[]) =>
				command.config.showWarning ? session.text(message, param) : "";

			// 参数数量校验：必填参数缺失时逐个交互式追问补全；
			// 参数超出声明数（且末位不是变长参数）时报错
			if (command.config.checkArgCount) {
				let index = args.length;
				while (command._arguments[index]?.required) {
					const decl = command._arguments[index];
					if (!decl) break;
					await session.send(
						session.text("internal.prompt-argument", [
							session.text(`commands.${command.name}.arguments.${decl.name}`),
						]),
					);
					const source = await session.prompt();
					if (isNullable(source)) {
						return sendHint("internal.insufficient-arguments", decl.name);
					}
					args.push(ctx.$commander.parseValue(source, "argument", argv, decl));
					index++;
				}
				const finalArg =
					command._arguments[command._arguments.length - 1] || {};
				if (args.length > command._arguments.length && !finalArg.variadic) {
					return sendHint("internal.redunant-arguments");
				}
			}

			// 未知选项校验：传入了命令未注册的选项时报错
			if (command.config.checkUnknown) {
				const unknown = Object.keys(options).filter(
					(key) => !command._options[key],
				);
				if (unknown.length) {
					return sendHint("internal.unknown-option", unknown.join(", "));
				}
			}
			return undefined;
		},
		true,
	);
}
