// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 内置消息组件（模板标签）注册。
 *
 * 消息文案支持 `<execute/>`、`<prompt/>` 等自定义元素，渲染时由
 * 对应组件函数展开。这里注册框架自带的六个组件，全部随
 * Processor 初始化（见 index.ts）。`{ session: true }` 标记的组件
 * 依赖会话上下文，只能在会话消息中使用。
 */
import { Random } from "@koishi-ce/utils";
import { Time } from "cosmokit";
import type { Context } from "../context/index.ts";

/** 注册内置消息组件（execute / prompt / i18n / random / plural / i18n:time）。 */
export function registerComponents(ctx: Context) {
	// 在当前位置内联执行一条指令，返回其输出（不发送）
	ctx.component(
		"execute",
		async (_attrs, children, session) => {
			return session.execute(children.join(""), true);
		},
		{ session: true },
	);

	// 先发出子内容，再等待用户的下一条回复作为返回值（交互式模板）
	ctx.component(
		"prompt",
		async (_attrs, children, session) => {
			await session.send(children);
			return (await session.prompt()) ?? "";
		},
		{ session: true },
	);

	// 渲染指定 i18n 路径的文案，子元素作为插值参数
	ctx.component(
		"i18n",
		async (attrs, children, session) => {
			return session.i18n(attrs["path"], children);
		},
		{ session: true },
	);

	// 随机选取一个子元素
	ctx.component("random", async (_attrs, children) => {
		return Random.pick(children);
	});

	// 复数形式：按 count（或默认取最后一个子元素索引）选取对应变体
	ctx.component("plural", async (attrs, children) => {
		const path =
			attrs["count"] in children ? attrs["count"] : children.length - 1;
		return children[path] ?? "";
	});

	const units = ["day", "hour", "minute", "second"] as const;

	// 把毫秒时长人性化：如 "2 天 3 小时"、"5 分钟"，不足一分钟按秒取整。
	// ms += minor / 2 是四舍五入技巧：让低级单位过半时向高级单位进位
	ctx.component(
		"i18n:time",
		(attrs, _children, session) => {
			let ms = +attrs["value"];
			for (let index = 0; index < 3; index++) {
				const majorUnit = units[index];
				const minorUnit = units[index + 1];
				if (!majorUnit || !minorUnit) continue;
				const major = Time[majorUnit];
				const minor = Time[minorUnit];
				if (ms >= major - minor / 2) {
					ms += minor / 2;
					let result = `${Math.floor(ms / major)} ${session.text(`general.${majorUnit}`)}`;
					if (ms % major > minor) {
						result +=
							` ${Math.floor((ms % major) / minor)} ` +
							session.text(`general.${minorUnit}`);
					}
					return result;
				}
			}
			return `${Math.round(ms / Time.second)} ${session.text("general.second")}`;
		},
		{ session: true },
	);
}
