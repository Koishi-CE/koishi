// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// upstream: koishijs/webui plugins/auth/src/index.ts L43-L64, L72-L77（类型段；上游为单文件 plugin-auth 4.1.7，本仓拆分时抽离至本文件，同步时以其整体 diff 对照本目录）

import type { Binding, User } from "@koishi-ce/koishi";

/** token 表记录：一次登录会话的令牌及其来源信息。 */
export interface LoginToken {
	/** 自增主键（删除指定会话用） */
	inc: number;
	/** 所属用户 id */
	id: number;
	/** 登录方式 */
	type: LoginType;
	/** 随机令牌（唯一索引） */
	token: string;
	/** 过期时间戳（毫秒） */
	expiredAt: number;
	createdAt: Date;
	lastUsedAt: Date;
	/** 登录时的 User-Agent */
	userAgent: string;
	/** 登录时的来源 IP */
	address: string;
}

/** 下发到客户端的登录态（user 数据服务的单条形态，不含 tokens/bindings 明细）。 */
export type Auth = Pick<LoginToken, "token" | "expiredAt"> &
	Pick<User, "id" | "name" | "authority" | "config">;

/** user 数据服务下发给客户端的完整鉴权数据：登录态 + 会话列表 + 绑定列表。 */
export interface AuthData extends Auth {
	tokens: Omit<LoginToken, "token" | "id">[];
	bindings: Omit<Binding, "aid">[];
}

/** 登录方式：平台验证码 / 用户密码 / 已存令牌续期。 */
export type LoginType = "platform" | "password" | "token";

/** login/platform 事件的返回值：待登录用户信息 + 一次性验证码及其过期时间。 */
export interface UserLogin
	extends Pick<User, "id" | "name"> {
	token: string;
	expiredAt: number;
}

/** user/update 事件允许修改的用户字段。 */
export type UserUpdate = Partial<
	Pick<User, "name" | "password" | "config">
>;
