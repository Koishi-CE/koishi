// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 内置 group 插件：把一组插件配置作为一个可复用的单元挂载。
 * 组内的每个成员仍由 loader 逐个管理，`~` / `$` 前缀的键会被跳过。
 */

import type { Context, Plugin } from "@koishi-ce/core";
import { kRecord, type LoaderScope } from "./types.ts";

export const group: Plugin.Object<Context> = {
	name: "group",
	reusable: true,
	apply(ctx, plugins) {
		(ctx.scope as LoaderScope)[kRecord] ||= Object.create(null);

		for (const name in plugins || {}) {
			if (name.startsWith("~") || name.startsWith("$")) continue;
			ctx.loader.reload(ctx, name, plugins[name]);
		}

		ctx.accept(
			(neo) => {
				// 保留旧配置引用，用于对比键的增删
				const old = ctx.scope.config;

				// 依据新旧配置差异增删改组内插件
				for (const key in { ...old, ...neo }) {
					if (key.startsWith("~") || key.startsWith("$")) continue;
					const fork = (ctx.scope as LoaderScope)[kRecord]?.[key];
					if (!fork) {
						ctx.loader.reload(ctx, key, neo[key]);
					} else if (!(key in neo)) {
						ctx.loader.unload(ctx, key);
					} else {
						ctx.loader.reload(ctx, key, neo[key] || {});
					}
				}
			},
			{ passive: true },
		);
	},
};
