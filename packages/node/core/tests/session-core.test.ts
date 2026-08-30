/**
 * 会话基础层（SessionCore）补充测试。
 *
 * 覆盖 username 的取值优先级（用户库昵称 > 作者名 > userId 兜底）、
 * deprecated 的 parsed 访问器与无元素会话的 stripped 空对象、
 * 昵称剥离的分隔符边界（@ 前缀、中文逗号、无分隔符、无匹配）。
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	App,
	collectFields,
	type Session,
	type SessionCore,
} from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import "./shape.ts";

const app = new App();
app.plugin(mock);
const bot = app.bots[0]!;

beforeAll(() => app.start());
afterAll(() => app.stop());

function createSession(user?: { id: string; name?: string }) {
	return bot.session({
		platform: "mock",
		// exactOptionalPropertyTypes 下可选属性不接受显式 undefined，按存在性条件展开
		...(user !== undefined ? { user } : {}),
	}) as Session;
}

describe("Session Core", () => {
	it("username 优先取用户库昵称", () => {
		const session = createSession({ id: "1", name: "作者名" });
		(session as unknown as { user: object }).user = { name: "库昵称" };
		expect(session.username).toBe("库昵称");
	});

	it("username 回退到作者名", () => {
		const session = createSession({ id: "1", name: "作者名" });
		expect(session.username).toBe("作者名");
	});

	it("username 再回退到 userId", () => {
		const session = createSession({ id: "42" });
		expect(session.username).toBe("42");
	});

	it("无任何信息时 username 为空串", () => {
		const session = createSession();
		expect(session.username).toBe("");
	});

	it("parsed 访问器与无元素会话的 stripped 空对象", () => {
		// 会话服务实例本身不携带元素，stripped 返回空对象；
		// 其声明类型带必填字段，按 object 视图断言空对象形状
		const service = app.koishi.session as SessionCore;
		expect(service.stripped as object).toEqual({});
		expect(service.parsed as object).toEqual({});
	});

	it("昵称剥离的分隔符边界", () => {
		app.koishi.config.nickname = ["kou"];
		// 逗号 / 空白 / 中文逗号均可作为昵称后的分隔符
		//（stripped 有惰性缓存，每个用例用独立会话）
		const s1 = createSession({ id: "1" });
		s1.content = "kou, foo";
		expect(s1.stripped).toHaveShape({ content: "foo", appel: true });
		const s2 = createSession({ id: "1" });
		s2.content = "kou foo";
		expect(s2.stripped.content).toBe("foo");
		const s3 = createSession({ id: "1" });
		s3.content = "@kou，foo";
		expect(s3.stripped.content).toBe("foo");
		// 昵称后无分隔符不视为称呼
		const s4 = createSession({ id: "1" });
		s4.content = "koufoo";
		expect(s4.stripped).toHaveShape({ content: "koufoo", appel: false });
		// 不匹配任何昵称时正文原样保留
		const s5 = createSession({ id: "1" });
		s5.content = "bar";
		expect(s5.stripped.content).toBe("bar");
		// exactOptionalPropertyTypes 下以 delete 复位可选属性（读取结果同为 undefined）
		delete app.koishi.config.nickname;
	});

	it("昵称配置为函数时按会话求值", () => {
		// nickname 运行时是 Computed 配置（亦接受函数），Config 类型只声明了静态形态，
		// 经扩展视图按运行时形态赋值
		const config = app.koishi.config as unknown as {
			nickname?: string | string[] | ((session: Session) => string[]);
		};
		config.nickname = (session) => (session.userId === "1" ? ["kou"] : []);
		const session = createSession({ id: "1" });
		session.content = "kou, foo";
		expect(session.stripped.content).toBe("foo");
		delete config.nickname;
	});

	it("collectFields 同时支持列表与函数收集器", () => {
		// collectFields 的类型锚定在数据表键上，此处以任意字段名验证收集机制本身，
		// 参数按下标提取的目标形状收窄（运行时不校验字段名）
		const argv = {} as Parameters<typeof collectFields>[0];
		const collectors = [
			["alpha", "beta"],
			(_argv: never, set: Set<string>) => {
				set.add("gamma");
			},
		] as unknown as Parameters<typeof collectFields>[1];
		const fields = collectFields(
			argv,
			collectors,
			new Set<string>() as unknown as Parameters<typeof collectFields>[2],
		) as Set<string>;
		expect([...fields].sort()).toEqual(["alpha", "beta", "gamma"]);
	});
});
