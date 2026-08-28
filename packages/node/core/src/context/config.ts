/**
 * 应用根配置（Context.Config）各分块 Schema 的定义。
 *
 * 根配置被拆成 Basic / I18n / Delay / Advanced / request 若干分块，
 * 便于控制台分组渲染。本文件只负责把这些 Schema 挂到 Config 静态对象上
 * （实际挂载动作由 context/index.ts 调用 defineContextConfig 完成）。
 */
import { HTTP, Schema } from "@satorijs/core";
import { defineProperty, Time } from "cosmokit";
import { I18n } from "../i18n";
import type { Context } from "./index";

declare module "cordis" {
	namespace Plugin {
		interface Object {
			/** 插件对象可声明 filter: false 以退出 Koishi 的会话过滤体系 */
			filter?: boolean;
		}
	}
}

/**
 * 注册根配置的各 schema 区块。
 * 以函数形式延迟调用：context/index.ts 需先完成 Context 类初始化，
 * 避免模块初始化顺序上的循环依赖。
 */
export function defineContextConfig(Config: typeof Context.Config) {
	defineProperty(
		Config,
		"Basic",
		Schema.object({
			prefix: Schema.array(Schema.string().default(""))
				.default([""])
				.role("table")
				.computed()
				.description("指令前缀字符构成的数组。将被用于指令的匹配。"),
			prefixMode: Schema.union([
				Schema.const("auto").description("默认：当存在称呼时允许无前缀触发。"),
				Schema.const("strict").description(
					"严格：只有在指令前缀匹配时才允许触发。",
				),
			])
				.experimental()
				.role("radio")
				.default("auto")
				.description("指令前缀匹配模式。"),
			nickname: Schema.array(String)
				.role("table")
				.computed()
				.description("机器人昵称构成的数组。将被用于指令的匹配。"),
			autoAssign: Schema.boolean()
				.default(true)
				.computed()
				.description("当获取不到频道数据时，是否使用接受者作为受理人。"),
			autoAuthorize: Schema.natural()
				.default(1)
				.computed()
				.description("当获取不到用户数据时默认使用的权限等级。"),
			minSimilarity: Schema.percent()
				.default(1)
				.description(
					"用于模糊匹配的相似系数，应该是一个 0 到 1 之间的数值。数值越高，模糊匹配越严格。设置为 1 可以完全禁用模糊匹配。",
				),
		}).description("基础设置"),
	);

	defineProperty(Config, "I18n", I18n.Config);

	defineProperty(
		Config,
		"Delay",
		Schema.object({
			character: Schema.natural()
				.role("ms")
				.default(0)
				.description(
					"调用 `session.sendQueued()` 时消息间发送的最小延迟，按前一条消息的字数计算。",
				),
			message: Schema.natural()
				.role("ms")
				.default(0.1 * Time.second)
				.description(
					"调用 `session.sendQueued()` 时消息间发送的最小延迟，按固定值计算。",
				),
			cancel: Schema.natural()
				.role("ms")
				.default(0)
				.description("调用 `session.cancelQueued()` 时默认的延迟。"),
			broadcast: Schema.natural()
				.role("ms")
				.default(0.5 * Time.second)
				.description("调用 `bot.broadcast()` 时默认的延迟。"),
			prompt: Schema.natural()
				.role("ms")
				.default(Time.minute)
				.description("调用 `session.prompt()` 时默认的等待时间。"),
		}),
	);

	defineProperty(
		Config,
		"Advanced",
		Schema.object({
			maxListeners: Schema.natural()
				.default(64)
				.description(
					"每种监听器的最大数量。如果超过这个数量，Koishi 会认定为发生了内存泄漏，将产生一个警告。",
				),
		}).description("高级设置"),
	);

	// Config.list 是控制台渲染根配置时的分块顺序：
	// 基础设置 -> i18n -> 延迟设置 -> 高级设置 -> 网络请求
	Config.list.push(Config.Basic);
	Config.list.push(
		Schema.object({
			i18n: I18n.Config,
		}),
	);
	Config.list.push(
		Schema.object({
			delay: Config.Delay,
		}).description("延迟设置"),
	);
	Config.list.push(Config.Advanced);
	Config.list.push(
		Schema.object({
			request: HTTP.Config,
		}),
	);
}
