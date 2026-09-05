// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 消息运行时（指令触发全链路）测试。
 *
 * 覆盖消息进入指令系统的各类前置匹配与校验：
 * 指令前缀（单个/多个/可选/无）、昵称与 @ 前缀、快捷对话（shortcut）、
 * 中间件准入（用户/频道 ignore、受理人检查），
 * 以及指令校验（权限等级、参数数量、未知选项、选项类型、before 钩子）。
 */
import {
	afterAll,
	beforeAll,
	describe,
	it,
	jest,
} from "bun:test";
import {
	App,
	Channel,
	Logger,
	sleep,
	User,
} from "@koishi-ce/koishi";
import memory from "@koishi-ce/plugin-database-memory";
import mock, {
	DEFAULT_SELF_ID,
} from "@koishi-ce/plugin-mock";

const app = new App();

app.plugin(memory);
app.plugin(mock);

// client1-3 为同频道不同用户；client4/5 在别的频道（用于频道维度断言）
const client1 = app.mock.client("123");
const client2 = app.mock.client("456");
const client3 = app.mock.client("789");
const client4 = app.mock.client("123", "321");
const client5 = app.mock.client("123", "654");

const cmd1 = app
	.command("cmd1 <arg1>", { authority: 2 })
	.channelFields(["id"])
	.shortcut("foo1", { args: ["bar"] })
	.shortcut("foo4", { fuzzy: true })
	.option("bar", "", { authority: 3 })
	.option("baz", "")
	.action((_: unknown, arg: string) => `cmd1:${arg}`);

const cmd2 = app
	.command("cmd2")
	.userFields(["id"])
	.shortcut("foo2", { options: { text: "bar" } })
	.shortcut("foo3", { prefix: true, fuzzy: true })
	.option("bar", "", { authority: 3 })
	.option("baz", "")
	.action(({ session }) => `cmd2:${session?.userId}`);

// 抢先短路用的中间件：消息含 "escape" 时直接回复，不进入指令
app.middleware((session, next) => {
	if (session.content?.includes("escape")) return "early";
	return next();
});

beforeAll(async () => {
	await app.start();
	// 预置用户等级：123 为 2 级（可用 cmd1），456/789 为 1 级
	await app.mock.initUser("123", 2);
	await app.mock.initUser("456", 1);
	await app.mock.initUser("789", 1);
	// 789 被标记为 ignore（用户级准入测试用）
	await app.database.setUser("mock", "789", {
		flag: User.Flag.ignore,
	});
	// 预置两个频道：321 受理人为默认 bot，654 受理人为 999（非本 bot）
	await app.mock.initChannel("321");
	await app.mock.initChannel("654", "999");
});

afterAll(() => app.stop());

describe("Runtime", () => {
	describe("Command Prefix", () => {
		it("single prefix", async () => {
			// prefix 也支持函数形态（按会话计算）
			app.koishi.config.prefix = () => ">";

			await client1.shouldReply("cmd2", "cmd2:123");
			await client4.shouldNotReply("cmd2");
			await client1.shouldReply("&gt;cmd2", "cmd2:123");
			await client4.shouldReply("&gt;cmd2", "cmd2:123");
			await client1.shouldNotReply(".cmd2");
			await client4.shouldNotReply(".cmd2");
		});

		it("multiple prefixes", async () => {
			// 多个前缀任一匹配即可触发
			app.koishi.config.prefix = ["!", "."];

			await client1.shouldReply("cmd2", "cmd2:123");
			await client4.shouldNotReply("cmd2");
			await client1.shouldReply("!cmd2", "cmd2:123");
			await client4.shouldReply("!cmd2", "cmd2:123");
			await client1.shouldReply(".cmd2", "cmd2:123");
			await client4.shouldReply(".cmd2", "cmd2:123");
		});

		it("optional prefix", async () => {
			// 空字符串前缀 = 允许无前缀触发，其余前缀仍然有效
			app.koishi.config.prefix = ["", "."];

			await client1.shouldReply("cmd2", "cmd2:123");
			await client4.shouldReply("cmd2", "cmd2:123");
			await client1.shouldNotReply("!cmd2");
			await client4.shouldNotReply("!cmd2");
			await client1.shouldReply(".cmd2", "cmd2:123");
			await client4.shouldReply(".cmd2", "cmd2:123");
		});

		it("no prefix", async () => {
			// 无前缀配置：带任何前缀都不触发。
			// prefix 类型不含 null（运行时以 falsy 分支处理"无前缀"），故此处断言式关闭
			app.koishi.config.prefix = null as never;

			await client1.shouldReply("cmd2", "cmd2:123");
			await client4.shouldReply("cmd2", "cmd2:123");
			await client1.shouldNotReply("!cmd2");
			await client4.shouldNotReply("!cmd2");
			await client1.shouldNotReply(".cmd2");
			await client4.shouldNotReply(".cmd2");
		});
	});

	describe("Nickname Prefix", () => {
		beforeAll(() => {
			app.koishi.config.prefix = ["-"];
		});

		afterAll(() => {
			app.koishi.config.prefix = null as never;
		});

		it("no nickname", async () => {
			// 无昵称配置时，@机器人 相当于称呼（可免前缀）；
			// @ 他人 / 引用消息中的 @ 不算
			await client1.shouldReply("cmd2", "cmd2:123");
			await client4.shouldNotReply("cmd2");
			await client1.shouldReply("-cmd2", "cmd2:123");
			await client4.shouldReply("-cmd2", "cmd2:123");
			await client4.shouldReply(
				'<at id="514"/> <at id="999"/> cmd2',
				"cmd2:123",
			);
			await client4.shouldReply(
				'<at id="999"/> <at id="514"/> cmd2',
				"cmd2:123",
			);
			await client4.shouldNotReply('<at id="999"/> cmd2');
			await client4.shouldNotReply(
				`<quote id="123"/> cmd2`,
			);
			await client4.shouldNotReply(
				`<quote id="123"/> <at id="999"/> cmd2`,
			);
			await client4.shouldReply(
				'<quote id="123"/> <at id="514"/> cmd2',
				"cmd2:123",
			);
		});

		it("single nickname", async () => {
			// 昵称后需跟逗号或空白；@昵称 与文字昵称等价
			app.koishi.config.nickname = ["koishi"];

			await client1.shouldReply("koishi, cmd2", "cmd2:123");
			await client4.shouldReply("koishi, cmd2", "cmd2:123");
			await client1.shouldReply(
				"koishi\n cmd2",
				"cmd2:123",
			);
			await client4.shouldReply(
				"koishi\n cmd2",
				"cmd2:123",
			);
			await client1.shouldReply("@koishi cmd2", "cmd2:123");
			await client4.shouldReply("@koishi cmd2", "cmd2:123");
			// 同前缀的其它昵称不应误匹配
			await client1.shouldNotReply("komeiji, cmd2");
			await client4.shouldNotReply("komeiji, cmd2");
		});

		it("multiple nicknames", async () => {
			// 多个昵称各自独立生效，前缀 "-" 与昵称二选一
			app.koishi.config.nickname = ["komeiji", "koishi"];

			await client1.shouldReply("cmd2", "cmd2:123");
			await client4.shouldNotReply("cmd2");
			await client1.shouldReply("-cmd2", "cmd2:123");
			await client4.shouldReply("-cmd2", "cmd2:123");
			await client1.shouldReply("koishi, cmd2", "cmd2:123");
			await client4.shouldReply("koishi, cmd2", "cmd2:123");
			await client1.shouldReply("komeiji cmd2", "cmd2:123");
			await client4.shouldReply("komeiji cmd2", "cmd2:123");
		});
	});

	describe("Shortcuts", () => {
		beforeAll(() => {
			app.koishi.config.prefix = ["#"];
		});

		afterAll(() => {
			app.koishi.config.prefix = null as never;
		});

		it("single shortcut", async () => {
			// 快捷对话要求整条消息等于触发词（首尾空白会被剥离）
			await client4.shouldReply(" foo1 ", "cmd1:bar");
			await client4.shouldReply(" foo2 ", "cmd2:123");
			await client4.shouldNotReply("foo1 bar");
			await client4.shouldNotReply("foo2 -t bar");
		});

		it("no command prefix", async () => {
			// 快捷对话不受指令前缀影响（带前缀反而不触发）
			await client4.shouldNotReply("#foo1");
			await client4.shouldNotReply("#foo2");
		});

		it("nickname prefix & fuzzy", async () => {
			// prefix: true 的快捷对话要求称呼；fuzzy 允许后跟参数
			await client4.shouldNotReply("foo3 -t baz");
			await client4.shouldReply(
				`<at id="${DEFAULT_SELF_ID}"/> foo3 -t baz`,
				"cmd2:123",
			);
		});

		it("one argument & fuzzy", async () => {
			// fuzzy 快捷对话：触发词后必须接空白；带称呼时可紧贴
			await client4.shouldReply("foo4 bar baz", "cmd1:bar");
			await client4.shouldNotReply("foo4bar baz");
			await client4.shouldReply(
				`<at id="${DEFAULT_SELF_ID}"/> foo4bar baz`,
				"cmd1:bar",
			);
		});
	});

	describe("Middleware Validation", () => {
		it("user.flag.ignore", async () => {
			// 被 ignore 标记的用户（789）的消息在 attach 阶段被丢弃
			await client1.shouldReply("cmd2", "cmd2:123");
			await client3.shouldNotReply("cmd2");
		});

		it("channel.assignee", async () => {
			// 非受理频道（654 的受理人是 999）的消息被忽略，
			// 除非显式 @ 机器人
			await client4.shouldReply(
				"cmd1 test --baz",
				"cmd1:test",
			);
			await client4.shouldReply("escape", "early");
			await client5.shouldNotReply("cmd1 test --baz");
			await client5.shouldReply(
				`<at id="${DEFAULT_SELF_ID}"/> cmd1 test --baz`,
				"cmd1:test",
			);
		});

		it("channel.flag.ignore", async () => {
			// 被 ignore 标记的频道：连中间件都不执行（escape 也不回复）
			await app.database.setChannel("mock", "321", {
				flag: Channel.Flag.ignore,
			});
			await sleep(0);
			await client4.shouldNotReply("escape");
			await client4.shouldNotReply("cmd1 --baz");
			await client4.shouldNotReply(
				`<at id="${DEFAULT_SELF_ID}"/> cmd1 --baz`,
			);
			await app.database.setChannel("mock", "321", {
				flag: 0,
			});
		});
	});

	describe("Command Validation", () => {
		it("check authority", async () => {
			// 指令与选项各有独立权限等级；showWarning 关闭时静默忽略
			app.command("cmd1", { showWarning: true });
			await client2.shouldReply("cmd1 test", "权限不足。");
			await client1.shouldReply("cmd1 test", "cmd1:test");
			await client1.shouldReply("cmd1 --bar", "权限不足。");
			app.command("cmd1", { showWarning: false });
			await client1.shouldNotReply("cmd1 --bar");
			// 子指令继承父指令的权限要求
			const cmd3 = app
				.command("cmd1/cmd3")
				.action(() => "after cmd3");
			await client2.shouldReply("cmd3", "权限不足。");
			await client1.shouldReply("cmd3", "after cmd3");
			cmd3.dispose();
		});

		it("check arg count", async () => {
			// 缺参时进入"下次发送补参"流程；多参时提示（showWarning 开）
			cmd1.config.checkArgCount = true;
			cmd1.config.showWarning = true;
			await client4.shouldReply("cmd1 foo", "cmd1:foo");
			await client4.shouldReply("cmd1", "请发送arg1。");
			await client4.shouldReply("bar baz", "cmd1:bar baz");
			await client4.shouldReply(
				"cmd1 foo bar",
				"存在多余参数，输入帮助以查看用法。",
			);
			cmd1.config.showWarning = false;
			cmd1.config.checkArgCount = false;
		});

		it("check arg count: timeout", async () => {
			// 补参等待超时后提示缺少参数
			// bun:test 的 mock timers 默认不冻结微任务,mock 客户端回复投递不受影响
			jest.useFakeTimers();
			cmd1.config.checkArgCount = true;
			cmd1.config.showWarning = true;
			await client4.shouldReply("cmd1", "请发送arg1。");
			await jest.runAllTimers();
			await client4.shouldReply(
				"",
				"缺少参数，输入帮助以查看用法。",
			);
			cmd1.config.showWarning = false;
			cmd1.config.checkArgCount = false;
			jest.useRealTimers();
		});

		it("check unknown option", async () => {
			// 未知选项：showWarning 开时提示，关时静默忽略
			cmd2.config.checkUnknown = true;
			cmd2.config.showWarning = true;
			await client2.shouldReply("cmd2", "cmd2:456");
			await client2.shouldReply(
				"cmd2 --foo",
				"存在未知选项 foo，输入帮助以查看用法。",
			);
			cmd2.config.showWarning = false;
			await client2.shouldNotReply("cmd2 --foo");
			cmd2.config.checkUnknown = false;
		});

		it("option.validate", async () => {
			// bar 的错误消息 "SUFFIX" 被 i18n 当作路径渲染，missing 告警是
			// 该失败路径的预期伴生输出，静默之
			(Logger.levels as Record<string, number>)["i18n"] = 0;
			try {
				// 选项类型校验：抛错（可带自定义后缀）、正则、枚举列表各有提示
				const cmd3 = app
					.command("cmd3")
					.action(() => "after cmd3");
				cmd3.option("foo", "<foo>", {
					type: () => {
						throw new Error();
					},
				});
				cmd3.option("bar", "<bar>", {
					type: () => {
						throw new Error("SUFFIX");
					},
				});
				cmd3.option("baz", "<baz>", { type: /$^/ });
				cmd3.option("bax", "<baz>", {
					type: ["abc", "def"],
				});
				await client1.shouldReply("cmd3", "after cmd3");
				await client1.shouldReply(
					"cmd3 --foo xxx",
					"选项 foo 输入无效，输入帮助以查看用法。",
				);
				await client1.shouldReply(
					"cmd3 --bar xxx",
					"选项 bar 输入无效，SUFFIX",
				);
				await client1.shouldReply(
					"cmd3 --baz xxx",
					"选项 baz 输入无效，输入帮助以查看用法。",
				);
				await client1.shouldReply(
					"cmd3 --bax cba",
					"选项 bax 输入无效，输入帮助以查看用法。",
				);
				cmd3.dispose();
			} finally {
				delete (Logger.levels as Record<string, number>)[
					"i18n"
				];
			}
		});

		// 上游 master 同名用例为 command.before();fork 运行时尚无 beforeAll API
		it("command.before()", async () => {
			// before 钩子：返回值非空时替代指令执行，空值则取消执行
			const cmd3 = app
				.command("cmd3")
				.action(() => "after cmd3");
			await client1.shouldReply("cmd3", "after cmd3");
			let value = "before cmd3";
			cmd3.before(() => value);
			await client1.shouldReply("cmd3", "before cmd3");
			value = "";
			await client1.shouldNotReply("cmd3");
			cmd3.dispose();
		});
	});
});
