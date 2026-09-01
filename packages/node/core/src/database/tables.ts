// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Koishi 核心数据表的结构定义（类型层）。
 *
 * 定义三张内置表的 TS 接口与字段类型：
 * - `user`：内部用户主表（自增 id，跨平台共享）；
 * - `binding`：平台账号绑定表（pid + platform 唯一定位一个平台账号）；
 * - `channel`：频道表（id + platform 联合主键）。
 *
 * Types / Tables 两个接口用于向 minato 注册运行时表结构（见 models.ts），
 * 各表的 Observed 类型供 session 的可观察数据使用（见 session.ts）。
 */
import type * as utils from "@koishi-ce/utils";
import type * as minato from "minato";

/** minato 运行时类型映射（Koishi 未额外扩展，透传）。 */
export interface Types extends minato.Types {}

/** Koishi 向 minato 注册的表结构映射。 */
export interface Tables extends minato.Tables {
	user: User;
	binding: Binding;
	channel: Channel;
}

/** 用户表：机器人视角的统一用户数据（跨平台共享）。 */
export interface User {
	/** 内部用户 id（自增主键，与平台无关） */
	id: number;
	/** 用户昵称 */
	name: string;
	/** @deprecated 已废弃：历史遗留的标志位，请改用 permissions 列表。 */
	flag: number;
	/** 权限等级（配合 authority:N 权限使用，见 permission.ts） */
	authority: number;
	/** 用户语言偏好（可多个，i18n 渲染按序回退） */
	locales: string[];
	/** 显式授予的权限名列表 */
	permissions: string[];
	/** 创建时间 */
	createdAt: Date;
}

export namespace User {
	/** flag 标志位的位掩码取值 */
	export type Flag = 1;

	/** 用户表字段名 */
	export type Field = keyof User;
	/** 被观察的用户数据：只含预取字段 K，diff 写回为异步 Promise */
	export type Observed<K extends Field = Field> = utils.Observed<
		Pick<User, K>,
		Promise<void>
	>;
}

// erasableSyntaxOnly 禁止 enum;与同名 namespace 合并声明,保持 User.Flag API
export const User = {
	Flag: {
		ignore: 1,
	},
};

/** 绑定表：平台账号 (pid, platform) 与内部用户 aid 的多对一映射。 */
export interface Binding {
	/** 关联的内部用户 id */
	aid: number;
	/** 创建绑定的原始用户 id（aid 与 bid 首次绑定时相同） */
	bid: number;
	/** 平台内账号 id */
	pid: string;
	/** 平台标识 */
	platform: string;
}

/** 频道表：群聊 / 频道维度的设置数据。 */
export interface Channel {
	/** 频道 id（平台内唯一，与 platform 联合主键） */
	id: string;
	/** 平台标识 */
	platform: string;
	/** @deprecated 已废弃：历史遗留的标志位，请改用 permissions 列表。 */
	flag: number;
	/** 受理人（指派的机器人 selfId，空表示无人接管） */
	assignee: string;
	/** 所属群 id（与频道 id 可能相同） */
	guildId: string;
	/** 频道语言偏好 */
	locales: string[];
	/** 频道级授权的权限名列表 */
	permissions: string[];
	/** 创建时间 */
	createdAt: Date;
}

export namespace Channel {
	/** flag 标志位的位掩码取值（可按位组合） */
	export type Flag = 1 | 4;

	/** 频道表字段名 */
	export type Field = keyof Channel;
	/** 被观察的频道数据：只含预取字段 K，diff 写回为异步 Promise */
	export type Observed<K extends Field = Field> = utils.Observed<
		Pick<Channel, K>,
		Promise<void>
	>;
}

// erasableSyntaxOnly 禁止 enum;与同名 namespace 合并声明,保持 Channel.Flag API
export const Channel = {
	Flag: {
		ignore: 1,
		silent: 4,
	},
};
