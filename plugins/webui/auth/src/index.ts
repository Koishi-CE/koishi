import type { Client, DataService } from "@koishi-ce/console";
import {
	type Binding,
	type Context,
	omit,
	Schema,
	Service,
	Time,
	type User,
} from "@koishi-ce/koishi";
import { createHash } from "crypto";
import { resolve } from "path";

declare module "@koishi-ce/koishi" {
	interface Context {
		auth: AuthService;
	}

	interface User {
		password: string;
		config: any;
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
		"login/password"(this: Client, name: string, password: string): void;
		"login/token"(this: Client, id: number, token: string): void;
		"user/delete-token"(this: Client, inc: number): void;
		"user/unbind"(this: Client, platform: string, pid: string): void;
		"user/update"(this: Client, data: UserUpdate): void;
		"user/logout"(this: Client): void;
	}
}

export interface LoginToken {
	inc: number;
	id: number;
	type: LoginType;
	token: string;
	expiredAt: number;
	createdAt: Date;
	lastUsedAt: Date;
	userAgent: string;
	address: string;
}

export type Auth = Pick<LoginToken, "token" | "expiredAt"> &
	Pick<User, "id" | "name" | "authority" | "config">;

interface AuthData extends Auth {
	tokens: Omit<LoginToken, "token" | "id">[];
	bindings: Omit<Binding, "aid">[];
}

type LoginType = "platform" | "password" | "token";

const letters =
	"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function randomId(length = 40) {
	return Array(length)
		.fill(0)
		.map(() => letters[Math.floor(Math.random() * letters.length)])
		.join("");
}

export interface UserLogin extends Pick<User, "id" | "name"> {
	token: string;
	expiredAt: number;
}

export type UserUpdate = Partial<Pick<User, "name" | "password" | "config">>;

function toHash(password: string) {
	return createHash("sha256").update(password).digest("hex");
}

class AuthService extends Service {
	static inject = ["console", "database"];

	// erasableSyntaxOnly 禁止携带运行时值的 namespace:原 `namespace AuthService`
	// 的导出值迁为静态成员(合并到 class 的 namespace 本就编译为静态属性,运行时等价)
	static filter = false;

	// biome-ignore lint/style/useNamingConvention: cordis 的 resolveConfig 按 plugin["Config"] 读取静态成员,Koishi 插件生态约定 Schema 静态导出为 PascalCase
	static Admin: Schema<AuthService.Admin> = Schema.intersect([
		Schema.object({
			enabled: Schema.boolean().default(true),
		}),
		Schema.union([
			Schema.object({
				enabled: Schema.const(true),
				username: Schema.string().default("admin"),
				password: Schema.string().role("secret").required(),
			}),
			Schema.object({}),
		]),
	]);

	// biome-ignore lint/style/useNamingConvention: 同上,cordis 按 plugin["Config"] 读取
	static Config: Schema<AuthService.Config> = Schema.intersect([
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
		"zh-CN": require("./locales/zh-CN"),
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

	override async start() {
		const { enabled, username, password } = this.config.admin;
		if (!enabled) return;
		this.ctx.logger.info("creating admin account");
		// enabled 分支的 Schema 已保证 username/password 存在(默认 admin / required)
		await this.ctx.database.upsert("user", [
			{
				id: 0,
				name: username!,
				authority: 5,
				password: toHash(password!),
				createdAt: new Date(),
			},
		]);
	}

	async setAuth(client: Client, auth = client.auth, passive = false) {
		client.auth = auth;
		if (passive) return;
		if (auth) {
			const bindings = await this.ctx.database.get("binding", { aid: auth.id });
			// 下发前剥离服务端字段;minato 模型字段必填,需按可删除的形状断言
			bindings.forEach((binding) => delete (binding as Partial<Binding>).aid);
			const tokens = await this.ctx.database.get("token", { id: auth.id });
			tokens.reverse().forEach((login) => {
				delete (login as Partial<LoginToken>).id;
				delete (login as Partial<LoginToken>).token;
			});
			client.send({
				type: "data",
				body: { key: "user", value: { ...auth, bindings, tokens } },
			});
		} else {
			client.send({ type: "data", body: { key: "user", value: null } });
		}
		client.ctx.emit("console/connection", client);
		client.refresh();
	}

	async createToken(
		client: Client,
		type: LoginType,
		user: Pick<User, "id" | "name" | "authority" | "config">,
	) {
		// WebSocket 升级连接必带 HTTP 请求对象(见 console 服务端构造 Client 处)
		const { headers, socket } = client.request!;
		const createdAt = new Date();
		const lastUsedAt = new Date();
		const userAgent = headers["user-agent"]?.toString();
		const address =
			headers["x-forwarded-for"]?.toString() || socket.remoteAddress;
		const expiredAt = Date.now() + this.config.authTokenExpire;
		const token = randomId();
		// 请求头字段可能缺失,undefined 由 minato 归一化为 NULL 落库,不做默认值替换
		await this.ctx.database.create("token", {
			id: user.id,
			type,
			expiredAt,
			token,
			createdAt,
			lastUsedAt,
			userAgent: userAgent!,
			address: address!,
		});
		await this.setAuth(client, { ...user, expiredAt, token });
	}

	initLogin() {
		const self = this;
		const { ctx, config } = this;
		const states: Record<string, [string, number, Client]> = {};

		ctx.console.addListener("login/password", async function (name, password) {
			password = toHash(password);
			const [user] = await ctx.database.get("user", { name }, [
				"password",
				"name",
				"id",
				"authority",
				"config",
			]);
			if (!user || user.password !== password)
				throw new Error("用户名或密码错误。");
			await self.createToken(this, "password", omit(user, ["password"]));
		});

		ctx.console.addListener("login/token", async function (aid, token) {
			const [data] = await ctx.database.get("token", { id: aid, token }, [
				"expiredAt",
			]);
			if (!data || data.expiredAt <= Date.now())
				throw new Error("令牌已失效。");
			const [user] = await ctx.database.get("user", { id: aid }, [
				"id",
				"name",
				"authority",
				"config",
			]);
			if (!user) throw new Error("用户不存在。");
			await ctx.database.set("token", { token }, { lastUsedAt: new Date() });
			await self.setAuth(this, { ...user, ...data, token });
		});

		ctx.console.addListener(
			"login/platform",
			async function (platform, userId) {
				const user = await ctx.database.getUser(platform, userId, [
					"id",
					"name",
				]);
				if (!user) throw new Error("找不到此账户。");
				if (this.auth?.id === user.id) throw new Error("你已经绑定了此账户。");

				const key = `${platform}:${userId}`;
				const token = Math.random().toString().slice(2, 8);
				const expiredAt = Date.now() + config.loginTokenExpire;
				states[key] = [token, expiredAt, this];

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

				return { id: user.id, name: user.name, token, expiredAt };
			},
		);

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

		ctx.on("console/intercept", async (client, listener) => {
			if (!listener.authority) return false;
			if (!client.auth) return true;
			if (client.auth.expiredAt <= Date.now()) return true;
			if (client.auth.authority < listener.authority) return true;
			return false;
		});

		ctx.console.addListener("user/delete-token", async function (inc) {
			if (!this.auth) throw new Error("请先登录。");
			const [data] = await ctx.database.get("token", { id: this.auth.id, inc });
			if (!data) throw new Error("令牌不存在。");
			await ctx.database.remove("token", { inc });
			await self.setAuth(this);
		});

		ctx.console.addListener("user/logout", async function () {
			if (this.auth) {
				await ctx.database.remove("token", { token: this.auth.token });
			}
			await self.setAuth(this, undefined);
		});

		ctx.console.addListener("user/update", async function (data) {
			if (!this.auth) throw new Error("请先登录。");
			if (data.password) data.password = toHash(data.password);
			await ctx.database.set("user", { id: this.auth.id }, data);
			Object.assign(this.auth, data);
			await self.setAuth(this, undefined, true);
		});

		ctx.console.addListener("user/unbind", async function (platform, pid) {
			if (!this.auth) throw new Error("请先登录。");
			const bindings = await ctx.database.get("binding", { aid: this.auth.id });
			// 客户端仅对已列出的绑定发起解绑,查找必命中
			const binding = bindings.find(
				(item) => item.platform === platform && item.pid === pid,
			)!;
			if (binding.aid !== binding.bid) {
				await ctx.database.set(
					"binding",
					{ platform, pid },
					{ aid: binding.bid },
				);
			} else if (
				bindings.filter((item) => item.aid === item.bid).length === 1
			) {
				throw new Error("无法解除绑定。");
			} else {
				await ctx.database.remove("binding", { platform, pid });
			}
			await self.setAuth(this);
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

export default AuthService;
