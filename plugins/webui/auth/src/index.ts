// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * auth 插件（服务端）：控制台登录鉴权。
 *
 * 向应用注入 ctx.auth 服务（AuthService）：扩展 user 表的 password 字段
 * 并建立 token 会话表，支持用户密码 / 平台验证码 / 已存令牌三种登录方式，
 * 维护每个 WebSocket 客户端的登录态（client.auth），并按登录用户的权限
 * 拦截 console 事件。浏览器端对应实现在 ../client/（登录页、个人资料页、
 * 配置同步对话框）。
 */

import { resolve } from "node:path";
import type {
	Client,
	DataService,
} from "@koishi-ce/console";
import {
	type Binding,
	type Context,
	Schema,
	Service,
	Time,
	type User,
} from "@koishi-ce/koishi";
import zhCN from "../locales/zh-CN.yml";
import { randomId, toHash } from "./crypto.ts";
import { initLogin } from "./login.ts";
import type {
	Auth,
	AuthData,
	LoginToken,
	LoginType,
	UserLogin,
	UserUpdate,
} from "./types.ts";

declare module "@koishi-ce/koishi" {
	interface Context {
		auth: AuthService;
	}

	interface User {
		password: string;
		/** 客户端控制台配置的 JSON 快照（内容仅由浏览器端解释，服务端透传；建表初始为 null） */
		config: object | null;
	}

	interface Tables {
		token: LoginToken;
	}
}

declare module "@koishi-ce/console" {
	interface Client {
		// setAuth 会以 undefined 清除登录态,exactOptionalPropertyTypes 下
		// 需显式允许 undefined
		auth?: Auth | undefined;
	}

	namespace Console {
		export interface Services {
			user: DataService<AuthData>;
		}
	}

	interface Events {
		"login/platform"(
			this: Client,
			platform: string,
			pid: string,
		): Promise<UserLogin>;
		"login/password"(
			this: Client,
			name: string,
			password: string,
		): void;
		"login/token"(
			this: Client,
			id: number,
			token: string,
		): void;
		"user/delete-token"(this: Client, inc: number): void;
		"user/unbind"(
			this: Client,
			platform: string,
			pid: string,
		): void;
		"user/update"(this: Client, data: UserUpdate): void;
		"user/logout"(this: Client): void;
	}
}

/**
 * 鉴权服务：维护控制台客户端的登录态。
 *
 * 构造时扩展 user 表（password / config 字段）与 token 表，注册浏览器端
 * 的登录与用户管理事件；登录成功后把 Auth 写入 client.auth 并以 user
 * 数据服务全量下发。依赖 console 与 database 服务。
 */
class AuthService extends Service {
	static inject = ["console", "database"];

	// erasableSyntaxOnly 禁止携带运行时值的 namespace:原 `namespace AuthService`
	// 的导出值迁为静态成员(合并到 class 的 namespace 本就编译为静态属性,运行时等价)
	static filter = false;

	static Admin: Schema<AuthService.Admin> =
		Schema.intersect([
			Schema.object({
				enabled: Schema.boolean().default(true),
			}),
			Schema.union([
				Schema.object({
					enabled: Schema.const(true),
					username: Schema.string().default("admin"),
					password: Schema.string()
						.role("secret")
						.required(),
				}),
				Schema.object({}),
			]),
		]);

	static Config: Schema<AuthService.Config> =
		Schema.intersect([
			Schema.object({
				admin: AuthService.Admin,
			}),
			Schema.object({
				authTokenExpire: Schema.natural()
					.role("ms")
					.default(Time.week)
					.min(Time.hour),
				loginTokenExpire: Schema.natural()
					.role("ms")
					.default(Time.minute * 10)
					.min(Time.minute),
			}),
		]).i18n({
			"zh-CN": zhCN,
		});

	// Service 基类已声明 config(T = any),此处覆盖为插件配置类型
	override config: AuthService.Config;

	constructor(ctx: Context, config: AuthService.Config) {
		super(ctx, "auth");
		this.config = config;

		ctx.model.extend("user", {
			password: "string(255)",
			config: {
				type: "json",
				length: 65535,
				initial: null,
			},
		});

		ctx.model.extend(
			"token",
			{
				inc: "unsigned",
				id: "unsigned",
				type: "string(255)",
				token: "string(255)",
				expiredAt: "unsigned(8)",
				createdAt: "timestamp",
				lastUsedAt: "timestamp",
				userAgent: "string(255)",
				address: "string(255)",
			},
			{
				primary: "inc",
				autoInc: true,
				unique: ["token"],
			},
		);

		ctx.console.addEntry({
			dev: resolve(import.meta.dir, "../client/index.ts"),
			prod: resolve(import.meta.dir, "../dist"),
		});

		initLogin(this);
	}

	/** 启动时按配置确保管理员账户（id = 0）存在。 */
	override async start() {
		const { enabled, username, password } =
			this.config.admin;
		if (!enabled) return;
		this.ctx.logger.info("creating admin account");
		// enabled 分支的 Schema 已保证 username/password 存在(默认 admin / required),
		// 此处守卫仅用于类型收窄
		if (!username || !password) return;
		await this.ctx.database.upsert("user", [
			{
				id: 0,
				name: username,
				authority: 5,
				password: toHash(password),
				createdAt: new Date(),
			},
		]);
	}

	/**
	 * 设置客户端登录态并全量下发 user 数据。
	 * @param client 目标 WebSocket 客户端
	 * @param auth 新登录态；缺省沿用 client.auth，传 undefined 表示登出
	 * @param passive 为 true 时只写 client.auth，不推送数据也不刷新
	 *   （已登录状态下修改资料后仅同步本地时使用）
	 */
	async setAuth(
		client: Client,
		auth = client.auth,
		passive = false,
	) {
		client.auth = auth;
		if (passive) return;
		if (auth) {
			const bindings = await this.ctx.database.get(
				"binding",
				{ aid: auth.id },
			);
			// 下发前剥离服务端字段;minato 模型字段必填,需按可删除的形状断言
			bindings.forEach(
				(binding) =>
					delete (binding as Partial<Binding>).aid,
			);
			const tokens = await this.ctx.database.get("token", {
				id: auth.id,
			});
			tokens.reverse().forEach((login) => {
				delete (login as Partial<LoginToken>).id;
				delete (login as Partial<LoginToken>).token;
			});
			client.send({
				type: "data",
				body: {
					key: "user",
					value: { ...auth, bindings, tokens },
				},
			});
		} else {
			client.send({
				type: "data",
				body: { key: "user", value: null },
			});
		}
		client.ctx.emit("console/connection", client);
		client.refresh();
	}

	/**
	 * 为用户签发新令牌并立即让客户端登录。
	 * 从 WebSocket 升级请求中提取 User-Agent 与来源 IP 一并落库，
	 * 过期时长由 authTokenExpire 配置决定。
	 */
	async createToken(
		client: Client,
		type: LoginType,
		user: Pick<
			User,
			"id" | "name" | "authority" | "config"
		>,
	) {
		// WebSocket 升级连接必带 HTTP 请求对象(见 console 服务端构造 Client 处)
		const { headers, socket } = client.request;
		const createdAt = new Date();
		const lastUsedAt = new Date();
		const userAgent = headers["user-agent"]?.toString();
		const address =
			headers["x-forwarded-for"]?.toString() ||
			socket.remoteAddress;
		const expiredAt =
			Date.now() + this.config.authTokenExpire;
		const token = randomId();
		// 请求头字段可能缺失,undefined 由 minato 归一化为 NULL 落库,不做默认值替换
		await this.ctx.database.create("token", {
			id: user.id,
			type,
			expiredAt,
			token,
			createdAt,
			lastUsedAt,
			userAgent: userAgent as string,
			address: address as string,
		});
		await this.setAuth(client, {
			...user,
			expiredAt,
			token,
		});
	}
}

// 纯类型 namespace(仅含接口,erasableSyntaxOnly 允许),与上面的 class 合并声明
namespace AuthService {
	export interface Admin {
		enabled?: boolean;
		username?: string;
		password?: string;
	}

	// Schema 默认值保证三个字段在运行时始终存在,故声明为必填
	export interface Config {
		admin: Admin;
		authTokenExpire: number;
		loginTokenExpire: number;
	}
}

export { randomId } from "./crypto.ts";
export type {
	Auth,
	LoginToken,
	UserLogin,
	UserUpdate,
} from "./types.ts";

export default AuthService;
