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

import {
	createHash,
	pbkdf2Sync,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { resolve } from "node:path";
import type {
	Client,
	DataService,
} from "@koishi-ce/console";
import {
	type Binding,
	type Context,
	omit,
	Schema,
	Service,
	Time,
	type User,
} from "@koishi-ce/koishi";
import zhCN from "../locales/zh-CN.yml";

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
interface AuthData extends Auth {
	tokens: Omit<LoginToken, "token" | "id">[];
	bindings: Omit<Binding, "aid">[];
}

/** 登录方式：平台验证码 / 用户密码 / 已存令牌续期。 */
type LoginType = "platform" | "password" | "token";

// 随机令牌的字符表（数字 + 大小写字母）
const letters =
	"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * 生成指定长度的随机令牌字符串。
 * @param length 令牌长度，默认 40
 * @returns 从字符表随机取字符拼接成的字符串
 */
export function randomId(length = 40) {
	return Array(length)
		.fill(0)
		.map(
			() =>
				letters[Math.floor(Math.random() * letters.length)],
		)
		.join("");
}

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

/** PBKDF2-HMAC-SHA256 迭代次数（OWASP 2023 建议 600k；登录低频，开销可接受） */
const PBKDF2_ROUNDS = 600_000;

/** 新格式密码哈希：`pbkdf2$<rounds>$<salt-hex>$<dk-hex>`（加盐 + 慢哈希）。 */
function toHash(password: string) {
	const salt = randomBytes(16);
	const dk = pbkdf2Sync(
		password,
		salt,
		PBKDF2_ROUNDS,
		32,
		"sha256",
	);
	return `pbkdf2$${PBKDF2_ROUNDS}$${salt.toString("hex")}$${dk.toString("hex")}`;
}

/**
 * 校验明文密码与库中存储是否匹配。
 *
 * 兼容两种存储格式：
 * - `pbkdf2$...` 新格式：按存储的盐与迭代次数重派生，恒定时间比较；
 * - 64 位十六进制旧格式：历史上无盐 SHA-256，仅用于校验（命中后由调用方
 *   透明升级为 PBKDF2），同样以恒定时间比较。
 */
function verifyPassword(
	password: string,
	stored: string,
): boolean {
	if (stored.startsWith("pbkdf2$")) {
		const [, rounds, saltHex, dkHex] = stored.split("$");
		if (!rounds || !saltHex || !dkHex) return false;
		const expected = Buffer.from(dkHex, "hex");
		const actual = pbkdf2Sync(
			password,
			Buffer.from(saltHex, "hex"),
			Number(rounds),
			expected.length,
			"sha256",
		);
		// 长度已按 expected.length 派生，恒定时间比较不会抛错
		return timingSafeEqual(actual, expected);
	}
	// 旧格式：裸 SHA-256 十六进制。
	// 无盐 SHA-256 只用于存量密码的**校验**（不可删，删了旧用户无法登录），
	// 命中后由调用方透明升级为 PBKDF2；新建密码一律走 toHash（pbkdf2$ 格式），
	// 故此处非弱哈希存储，属误报（Default setup 不支持注释抑制，须在平台 dismiss）。
	if (!/^[0-9a-f]{64}$/i.test(stored)) return false;
	const actual = createHash("sha256")
		.update(password)
		.digest();
	return timingSafeEqual(
		actual,
		Buffer.from(stored, "hex"),
	);
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
			dev: resolve(__dirname, "../client/index.ts"),
			prod: resolve(__dirname, "../dist"),
		});

		this.initLogin();
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

	/** 注册全部登录 / 用户管理事件与权限拦截逻辑（构造时调用）。 */
	initLogin() {
		const self = this;
		const { ctx, config } = this;
		// 平台验证码登录的进行中状态：键为 `${platform}:${userId}`，
		// 值为 [验证码, 过期时间, 发起登录的客户端]
		const states: Record<string, [string, number, Client]> =
			{};

		// 用户密码登录：校验通过后签发新令牌；
		// 命中旧的无盐 SHA-256 存储时透明升级为 PBKDF2
		ctx.console.addListener(
			"login/password",
			async function (name, password) {
				const [user] = await ctx.database.get(
					"user",
					{ name },
					["password", "name", "id", "authority", "config"],
				);
				if (
					!user?.password ||
					!verifyPassword(password, user.password)
				)
					throw new Error("用户名或密码错误。");
				if (!user.password.startsWith("pbkdf2$")) {
					await ctx.database.set("user", user.id, {
						password: toHash(password),
					});
				}
				await self.createToken(
					this,
					"password",
					omit(user, ["password"]),
				);
			},
		);

		// 已存令牌续期登录：本地记录的令牌未过期即恢复登录态，
		// 同时刷新该令牌的最后访问时间
		ctx.console.addListener(
			"login/token",
			async function (aid, token) {
				const [data] = await ctx.database.get(
					"token",
					{ id: aid, token },
					["expiredAt"],
				);
				if (!data || data.expiredAt <= Date.now())
					throw new Error("令牌已失效。");
				const [user] = await ctx.database.get(
					"user",
					{ id: aid },
					["id", "name", "authority", "config"],
				);
				if (!user) throw new Error("用户不存在。");
				await ctx.database.set(
					"token",
					{ token },
					{ lastUsedAt: new Date() },
				);
				await self.setAuth(this, {
					...user,
					...data,
					token,
				});
			},
		);

		// 平台账户登录（第一步）：校验平台账号存在后生成一次性验证码，
		// 用户把验证码发给任意机器人即可完成登录/绑定（见下方中间件）。
		// 状态在验证码过期或客户端断开时清理
		ctx.console.addListener(
			"login/platform",
			async function (platform, userId) {
				const user = await ctx.database.getUser(
					platform,
					userId,
					["id", "name"],
				);
				if (!user) throw new Error("找不到此账户。");
				if (this.auth?.id === user.id)
					throw new Error("你已经绑定了此账户。");

				const key = `${platform}:${userId}`;
				const token = Math.random().toString().slice(2, 8);
				const expiredAt =
					Date.now() + config.loginTokenExpire;
				states[key] = [token, expiredAt, this];

				// 客户端断开或验证码超时即作废本次登录状态
				const listener = () => {
					delete states[key];
					dispose();
					this.socket.removeEventListener("close", dispose);
				};
				const dispose = ctx.setTimeout(() => {
					const state = states[key];
					if (state && state[1] >= Date.now()) listener();
				}, config.loginTokenExpire);
				this.socket.addEventListener("close", listener);

				return {
					id: user.id,
					name: user.name,
					token,
					expiredAt,
				};
			},
		);

		// 平台账户登录（第二步）：前置中间件捕获用户发给机器人的验证码——
		// 客户端已登录则把该平台账号绑定到当前用户，否则为平台对应用户签发令牌
		ctx.middleware(async (session, next) => {
			const state = states[session.uid];
			if (!state || state[0] !== session.stripped.content) {
				return next();
			}

			const { platform, userId: pid } = session;
			// states 的键由 `${platform}:${userId}` 构成,能命中即说明 userId 存在
			if (!pid) return next();
			if (state[2].auth) {
				await ctx.database.set(
					"binding",
					{ platform, pid },
					{ aid: state[2].auth.id },
				);
				return self.setAuth(state[2], state[2].auth);
			} else {
				const user = await session.observeUser([
					"id",
					"name",
					"authority",
					"config",
				]);
				return self.createToken(state[2], "platform", user);
			}
		}, true);

		// 拦截带 authority 要求的 console 事件：未登录、令牌过期或
		// 权限不足时拒绝（返回 true 表示拦截）
		ctx.on(
			"console/intercept",
			async (client, listener) => {
				if (!listener.authority) return false;
				if (!client.auth) return true;
				if (client.auth.expiredAt <= Date.now())
					return true;
				if (client.auth.authority < listener.authority)
					return true;
				return false;
			},
		);

		// 删除指定登录会话（登出其它设备）
		ctx.console.addListener(
			"user/delete-token",
			async function (inc) {
				if (!this.auth) throw new Error("请先登录。");
				const [data] = await ctx.database.get("token", {
					id: this.auth.id,
					inc,
				});
				if (!data) throw new Error("令牌不存在。");
				await ctx.database.remove("token", { inc });
				await self.setAuth(this);
			},
		);

		// 退出登录：删除当前令牌并清除登录态
		ctx.console.addListener(
			"user/logout",
			async function () {
				if (this.auth) {
					await ctx.database.remove("token", {
						token: this.auth.token,
					});
				}
				await self.setAuth(this, undefined);
			},
		);

		// 修改用户资料（用户名 / 密码 / 配置），密码先哈希再落库
		ctx.console.addListener(
			"user/update",
			async function (data) {
				if (!this.auth) throw new Error("请先登录。");
				if (data.password)
					data.password = toHash(data.password);
				await ctx.database.set(
					"user",
					{ id: this.auth.id },
					data,
				);
				Object.assign(this.auth, data);
				await self.setAuth(this, undefined, true);
			},
		);

		// 解绑平台账号：绑到别的用户时改指回其主账号；是自身主账号且
		// 仅剩一个自绑定时拒绝解绑（避免用户失去登录途径），否则删除记录
		ctx.console.addListener(
			"user/unbind",
			async function (platform, pid) {
				if (!this.auth) throw new Error("请先登录。");
				const bindings = await ctx.database.get("binding", {
					aid: this.auth.id,
				});
				// 客户端仅对已列出的绑定发起解绑,查找必命中,未命中视为异常状态
				const binding = bindings.find(
					(item) =>
						item.platform === platform && item.pid === pid,
				);
				if (!binding) throw new Error("绑定不存在。");
				if (binding.aid !== binding.bid) {
					await ctx.database.set(
						"binding",
						{ platform, pid },
						{ aid: binding.bid },
					);
				} else if (
					bindings.filter((item) => item.aid === item.bid)
						.length === 1
				) {
					throw new Error("无法解除绑定。");
				} else {
					await ctx.database.remove("binding", {
						platform,
						pid,
					});
				}
				await self.setAuth(this);
			},
		);
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

export default AuthService;
