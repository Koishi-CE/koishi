/**
 * Command API 集成测试：命令注册、子命令树、销毁与执行链（洋葱模型）。
 * 覆盖 Command 的公开行为与 Commander 的注册表管理，
 * 通过 mock 插件构造会话验证执行结果。
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	it,
} from "bun:test";
import { mock as jest } from "node:test";
import { App, type Command, Logger, Next } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import { expect, use } from "chai";
import promise from "chai-as-promised";
import { inspect } from "util";
import { shape } from "../../../../../scripts/testing/chai-shape";

use(shape);
use(promise);

// 捕获 logger 输出，用于断言错误日志是否被打印
const print = jest.fn();

beforeAll(() => {
	Logger.levels.base = 1;
	Logger.targets.push({
		levels: { base: 0, command: 2 },
		print,
	});
});

afterAll(() => {
	Logger.levels.base = 2;
	Logger.targets.pop();
});

describe("Command API", () => {
	// 基础注册：不同作用域（user / guild filter）下创建命令、
	// 同名命令的更新与别名冲突检测
	describe("Register Commands", () => {
		const app = new App();
		const ctx1 = app.user("10000");
		const ctx2 = app.guild("10000");
		app.command("a");
		ctx1.command("b");
		ctx2.command("c");

		// 空命令名应在构造时抛错
		it("constructor checks", () => {
			expect(() => app.command("")).to.throw();
		});

		// 自定义 inspect 输出应为 "Command <name>" 而非整个对象
		it("custom inspect", () => {
			expect(app.$commander._commandList).to.have.length(3);
			expect(inspect(app.command("a"))).to.equal("Command <a>");
		});

		// 同名重复注册应更新既有命令而非新建，config 以最后一次为准
		it("modify commands", () => {
			const d1 = app.command("d", "foo", { authority: 1 });
			expect(app.$commander.get("d").config.authority).to.equal(1);

			const d2 = app.command("d", "bar", { authority: 2 });
			expect(app.$commander.get("d").config.authority).to.equal(2);

			expect(d1).to.equal(d2);
		});

		// 别名冲突规则：不同 filter 作用域可同名；全局别名撞名抛错；
		// 同一命令重复注册同一别名不抛错
		it("name conflicts", () => {
			expect(() => {
				app.command("e");
				app.user("10000").command("e");
			}).not.to.throw();

			expect(() => {
				const x1 = app.command("e").alias("x");
				const x2 = app.user("10000").command("x");
				expect(x1).to.equal(x2);
			}).not.to.throw();

			expect(() => {
				app.command("g").alias("y");
				app.command("h").alias("y");
			}).to.throw();

			expect(() => {
				app.command("i").alias("z");
				app.command("i").alias("z");
			}).not.to.throw();
		});
	});

	// 子命令树：显式 subcommand() 与路径式（"a.b" / "b/c" / ".c"）隐式注册，
	// 以及非法父子关系（自引用、跨树挂载）的检测
	describe("Register Subcommands", () => {
		let app: App;
		beforeEach(() => (app = new App()));

		// subcommand() 与 ".xxx" 相对名写法的父子关系
		it("command.prototype.subcommand", () => {
			const a = app.command("a");
			const b = a.subcommand("b");
			const c = b.subcommand(".c");
			expect(a.children).to.have.shape([b]);
			expect(b.name).to.equal("b");
			expect(b.parent).to.equal(a);
			expect(b.children).to.have.shape([c]);
			expect(c.name).to.equal("b.c");
			expect(c.parent).to.equal(b);
		});

		// 点分 / 斜杠路径会自动创建中间父命令，已存在的同名命令被挂为父节点
		it("implicit subcommands", () => {
			const a = app.command("a");
			const d = app.command("a.d");
			expect(d.name).to.equal("a.d");
			expect(d.parent).to.equal(a);

			const b = app.command("b");
			const e = app.command("b/e");
			expect(e.name).to.equal("e");
			expect(e.parent).to.equal(b);

			const f = a.subcommand(".b/f");
			expect(f.name).to.equal("f");
			expect(f.parent.name).to.equal("a.b");
			expect(f.parent.parent).to.equal(a);

			const g = b.subcommand("c.g");
			expect(g.name).to.equal("c.g");
			expect(g.parent.name).to.equal("c");
			expect(g.parent.parent).to.equal(b);

			const h = app.command("h");
			b.subcommand("h");
			expect(h.name).to.equal("h");
			expect(h.parent).to.equal(b);
		});

		// 环与跨树限制：不能把命令挂为自己的子命令，
		// 已有父节点的命令不能再挂到其它命令下
		it("check subcommand", () => {
			const a = app.command("a");
			const b = a.subcommand("b");
			const c = b.subcommand("c");
			const d = app.command("d");

			// 显式注册子命令
			expect(() => a.subcommand("a")).to.throw();
			expect(() => a.subcommand("b")).not.to.throw();
			expect(() => a.subcommand("c")).to.throw();
			expect(() => a.subcommand("d")).not.to.throw();

			// 隐式路径注册子命令
			expect(() => app.command("b/c")).not.to.throw();
			expect(() => app.command("a/c")).to.throw();
			expect(() => app.command("c/b")).to.throw();
			expect(() => app.command("a/d")).not.to.throw();
		});
	});

	// 销毁命令：应级联销毁子命令、注销 matcher，并从命令列表移除
	describe("Dispose Commands", () => {
		const app = new App();
		const foo = app.command("foo");
		const bar = foo.subcommand("bar");
		const test = bar.subcommand("test");
		bar.alias("baz").shortcut("1");
		test.alias("it").shortcut("2");

		it("basic support", () => {
			expect(app.$commander._commandList).to.have.length(3);
			expect(app.$processor._matchers).to.have.length(2);
			expect(foo.children).to.have.length(1);
			bar.dispose();
			expect(app.$commander._commandList).to.have.length(1);
			expect(app.$processor._matchers).to.have.length(0);
			expect(foo.children).to.have.length(0);
		});
	});

	// 执行链：action 队列与 next 函数的洋葱模型组合，
	// 以及各类错误（action 抛错 / next 回调抛错 / fallback 抛错）的传播路径
	describe("Execute Commands", () => {
		const app = new App();
		app.plugin(mock);
		const session = app.mock.session({});
		const next = jest.fn(Next.compose);

		let command: Command;
		beforeEach(() => {
			command = app.command("test");
			print.mock.resetCalls();
			next.mock.resetCalls();
		});
		afterEach(() => command?.dispose());

		// action 返回 undefined 时命令输出空串，且不调用 fallback
		it("basic 1 (return undefined)", async () => {
			command.action(() => {});

			await expect(command.execute({ session }, next)).eventually.to.equal("");
			expect(next.mock.calls).to.have.length(0);
		});

		// action 返回字符串时作为回复输出
		it("basic 2 (return string)", async () => {
			command.action(() => "result");

			await expect(command.execute({ session }, next)).eventually.to.equal(
				"result",
			);
			expect(next.mock.calls).to.have.length(0);
		});

		// action 调 next() 空参透传时，由外部 fallback 提供返回值
		it("compose 1 (return in next function)", async () => {
			next.mock.mockImplementationOnce(() => Promise.resolve("result"));
			command.action(({ next }) => next());

			await expect(command.execute({ session }, next)).eventually.to.equal(
				"result",
			);
			expect(next.mock.calls).to.have.length(1);
		});

		// prepend 的 action 优先执行：命中条件时短路返回，否则继续透传
		it("compose 2 (return in action)", async () => {
			command.action(() => "result");
			command.action(({ next }, arg) => {
				return arg === "ping" ? "pong" : next();
			}, true);

			await expect(command.execute({ session }, next)).eventually.to.equal(
				"result",
			);
			await expect(
				command.execute({ session, args: ["ping"] }, next),
			).eventually.to.equal("pong");
			expect(next.mock.calls).to.have.length(0);
		});

		// next(callback) 注入的回调可在后续执行，结果回到最外层调用方
		it("compose 3 (return in next callback)", async () => {
			command.action(({ next }) => next("result"));

			await expect(
				command.execute({ session }, async () => {}),
			).eventually.to.equal("");
			await expect(command.execute({ session }, next)).eventually.to.equal(
				"result",
			);
			expect(next.mock.calls).to.have.length(1);
		});

		// 多层嵌套的 next 回调应逐层展开而不爆栈
		it("compose 4 (nested next callbacks)", async () => {
			command.action(({ next }) => {
				return next((next) => {
					return next((next) => {
						return next("result");
					});
				});
			});

			await expect(
				command.execute({ session }, async () => {}),
			).eventually.to.equal("");
			await expect(command.execute({ session }, next)).eventually.to.equal(
				"result",
			);
			expect(next.mock.calls).to.have.length(1);
		});

		// action 抛错：由 handleError 配置接管，日志打印且 fallback 不被调用
		it("throw 1 (error in action)", async () => {
			command.config.handleError = () => "乌拉！";
			command.action(() => {
				throw new Error("message 1");
			});

			await expect(command.execute({ session }, next)).eventually.to.equal(
				"乌拉！",
			);
			expect(print.mock.calls).to.have.length(1);
			expect(print.mock.calls[0].arguments[0]).to.match(/Error: message 1/);
			expect(next.mock.calls).to.have.length(0);
		});

		// next 回调抛错：默认 handleError 返回内置错误文案
		it("throw 2 (error in next callback)", async () => {
			command.action(({ next }) => {
				return next(() => {
					throw new Error("message 2");
				});
			});

			await expect(command.execute({ session }, next)).eventually.to.equal(
				"发生未知错误。",
			);
			expect(print.mock.calls).to.have.length(1);
			expect(print.mock.calls[0].arguments[0]).to.match(/Error: message 2/);
			expect(next.mock.calls).to.have.length(1);
		});

		// 外部 fallback 本身抛错时不再被命令捕获，向上原样传播
		it("throw 3 (error in next function)", async () => {
			next.mock.mockImplementationOnce(() =>
				Promise.reject(new Error("message 3")),
			);
			command.action(({ next }) => next());

			await expect(command.execute({ session }, next)).to.be.rejected;
			expect(print.mock.calls).to.have.length(0);
			expect(next.mock.calls).to.have.length(1);
		});

		// action 内自行 catch next() 的错误：不触发全局日志
		it("throw 4 (error handling)", async () => {
			command.action(async ({ next }) => {
				return next().catch(() => "catched");
			});
			command.action(() => {
				throw new Error("message 4");
			});

			await expect(command.execute({ session }, next)).eventually.to.equal(
				"catched",
			);
			expect(print.mock.calls).to.have.length(0);
			expect(next.mock.calls).to.have.length(0);
		});
	});

	// 中间件旁路：action 返回 next(...) 时把控制权交还中间件链，
	// 由其它中间件决定是否继续处理
	describe("Bypass Middleware", async () => {
		const app = new App();
		app.plugin(mock);
		const client = app.mock.client("123");

		// 一个抢占式中间件：内容含 "escape" 时直接回复 "early"
		app.middleware((session, next) => {
			if (session.content.includes("escape")) return "early";
			return next();
		});

		// action 透传的 next 值可被外部中间件接管
		it("basic support", async () => {
			app.command("test1").action(({ next }) => next("final"));

			await app.start();
			await client.shouldReply("test1 foo", "final");
			await client.shouldReply("test1 escape", "early");
		});

		// action 无限透传 next(Next.compose) 不应造成死循环或报错
		it("infinite loop", async () => {
			app.command("test2").action(({ next }) => next(Next.compose));

			await app.start();
			await client.shouldNotReply("test2");
		});
	});
});
