/**
 * Parser API 测试：命令参数与选项的解析行为。
 * 覆盖参数 / 选项的类型推导与强转、短选项连写、贪婪与严格模式、
 * 固定取值选项、终止符语义以及元素类型（img 等）的解析。
 */

import { describe, expect, it } from "bun:test";
import { type Command, Context } from "@koishi-ce/koishi";
import "../../../tests/shape";

const app = new Context();

let cmd: Command;

describe("Parser API", () => {
	// 基础解析：位置参数的切分与 stringify 的双向还原
	describe("Basic Support", () => {
		// 位置参数按空白切分；变长参数声明下多余的 token 全部收入 args
		it("parse arguments", () => {
			cmd = app.command("cmd1 <foo> [...bar]");
			expect(cmd.parse("")).toHaveShape({ args: [] });
			expect(cmd.parse("a")).toHaveShape({ args: ["a"] });
			expect(cmd.parse("a b")).toHaveShape({ args: ["a", "b"] });
			expect(cmd.parse("a b c")).toHaveShape({ args: ["a", "b", "c"] });
		});

		// stringify：args / options 还原为命令行文本，含空格的值补引号，
		// false 值用 --no- 前缀表示
		it("stringify arguments", () => {
			cmd = app.command("cmd4");
			cmd.option("alpha", "-a <val>");
			cmd.option("beta", "-b");
			expect(cmd.stringify(["foo", "bar"], {})).toBe("cmd4 foo bar");
			expect(cmd.stringify([], { alpha: 2 })).toBe("cmd4 --alpha 2");
			expect(cmd.stringify([], { alpha: " " })).toBe('cmd4 --alpha " "');
			expect(cmd.stringify([], { beta: true })).toBe("cmd4 --beta");
			expect(cmd.stringify([], { beta: false })).toBe("cmd4 --no-beta");
		});
	});

	// 选项注册与解析：类型标注、隐式类型推导、连写短选项、贪婪 / 严格模式等
	describe("Register Options", () => {
		// 各种选项声明方式：短写法、显式类型、fallback 推导类型
		it("register", () => {
			cmd = app.command("cmd2 <foo> [bar:text]");
			cmd.option("alpha", "-a");
			cmd.option("beta", "-b <beta:number>");
			// 由 fallback 的类型推导参数类型
			cmd.option("gamma", "-c <gamma>", { fallback: 0 });
			// 通过定义串标注参数类型
			cmd.option("delta", "-d <delta:string>");
			// 直接给定参数类型时，不应被默认值覆盖
			cmd.option("epsilon", "-e <epsilon:posint>", { fallback: 1 });
		});

		// 选项基础解析：boolean 化、取值消费、负数取值、--no- 取反
		it("option parser", () => {
			expect(cmd.parse("--alpha")).toHaveShape({ options: { alpha: true } });
			expect(cmd.parse("--beta")).toHaveShape({ options: { beta: 0 } });
			expect(cmd.parse("--no-alpha")).toHaveShape({
				options: { alpha: false },
			});
			expect(cmd.parse("--no-beta")).toHaveShape({
				options: { beta: false },
			});
			expect(cmd.parse("--alpha 1")).toHaveShape({
				options: { alpha: true },
			});
			expect(cmd.parse("--beta 1")).toHaveShape({ options: { beta: 1 } });
			expect(cmd.parse('--beta "1"')).toHaveShape({ options: { beta: 1 } });
			expect(cmd.parse("--beta -1")).toHaveShape({ options: { beta: -1 } });
		});

		// 类型化选项：类型不符时报错；string 类型接受任意文本；
		// posint 拒绝非正整数
		it("typed options", () => {
			expect(cmd.parse("")).toHaveShape({ error: "", options: { gamma: 0 } });
			expect(cmd.parse("--gamma")).toHaveShape({
				error: "",
				options: { gamma: 0 },
			});
			expect(cmd.parse("--gamma 1")).toHaveShape({
				error: "",
				options: { gamma: 1 },
			});
			expect(cmd.parse("--gamma -1")).toHaveShape({
				error: "",
				options: { gamma: -1 },
			});
			expect(cmd.parse("--gamma a").error).toBeTruthy();
			expect(cmd.parse("--delta")).toHaveShape({
				error: "",
				options: { delta: "" },
			});
			expect(cmd.parse("--delta 1")).toHaveShape({
				error: "",
				options: { delta: "1" },
			});
			expect(cmd.parse("--delta -1")).toHaveShape({
				error: "",
				options: { delta: "-1" },
			});
			expect(cmd.parse("--epsilon awee").error).toBeTruthy();
			expect(cmd.parse("--epsilon 1.2").error).toBeTruthy();
		});

		// 短选项连写：-ab 等价于 -a -b，支持 "=值" 与空格取值、负数取值
		it("short alias", () => {
			expect(cmd.parse("-ab")).toHaveShape({
				options: { alpha: true, beta: 0 },
			});
			expect(cmd.parse("-ab=")).toHaveShape({
				options: { alpha: true, beta: 0 },
			});
			expect(cmd.parse("-ab 1")).toHaveShape({
				options: { alpha: true, beta: 1 },
			});
			expect(cmd.parse("-ab=1")).toHaveShape({
				options: { alpha: true, beta: 1 },
			});
			expect(cmd.parse("-ab -1")).toHaveShape({
				options: { alpha: true, beta: -1 },
			});
			expect(cmd.parse("-ab=-1")).toHaveShape({
				options: { alpha: true, beta: -1 },
			});
		});

		// 贪婪参数（text）：吞掉剩余全部输入；遇到选项写法时从选项处开始算剩余
		it("greedy arguments", () => {
			expect(cmd.parse("")).toHaveShape({ args: [] });
			expect(cmd.parse("a")).toHaveShape({ args: ["a"] });
			expect(cmd.parse("a b")).toHaveShape({ args: ["a", "b"] });
			expect(cmd.parse("a b c")).toHaveShape({ args: ["a", "b c"] });
			expect(cmd.parse("-a b c")).toHaveShape({ args: ["b", "c"] });
			expect(cmd.parse("a -b c")).toHaveShape({ args: ["a"] });
			expect(cmd.parse("a b -c")).toHaveShape({ args: ["a", "b -c"] });
		});

		// 严格选项模式：未注册的选项写法一律按普通参数处理
		it("strict options", () => {
			cmd = app.command("test-strict", { strictOptions: true });
			cmd.option("gamma", "-c", { value: 1 });
			expect(cmd.parse("-a")).toHaveShape({ options: {}, args: ["-a"] });
			expect(cmd.parse("--alpha")).toHaveShape({
				options: {},
				args: ["--alpha"],
			});
			expect(cmd.parse("--no-alpha")).toHaveShape({
				options: {},
				args: ["--no-alpha"],
			});
			expect(cmd.parse("-c")).toHaveShape({ options: { gamma: 1 } });
		});

		// 贪婪参数 + 严格选项：未注册选项整体作为贪婪文本的收入
		// https://github.com/koishijs/koishi/issues/1473
		it("greedy + strict options", () => {
			cmd = app.command("test-greedy-strict [foo:text]", {
				strictOptions: true,
			});
			expect(cmd.parse("-a -b -c")).toHaveShape({ args: ["-a -b -c"] });
		});

		// 固定取值（value）选项：出现即取预设值；
		// 带默认值时未传入也填充
		it("valued options", () => {
			cmd = app.command("cmd2 <foo> [bar:text]");
			cmd.option("alpha", "-A, --no-alpha", { value: false });
			cmd.option("gamma", "-C", { value: 1 });
			expect(cmd.parse("-A")).toHaveShape({ options: { alpha: false } });
			expect(cmd.parse("-a")).toHaveShape({ options: { alpha: true } });
			expect(cmd.parse("--alpha")).toHaveShape({ options: { alpha: true } });
			expect(cmd.parse("--no-alpha")).toHaveShape({
				options: { alpha: false },
			});
			expect(cmd.parse("-C")).toHaveShape({ options: { gamma: 1 } });
			expect(cmd.parse("")).toHaveShape({ options: { gamma: 0 }, args: [] });
		});

		// 同一选项的多种写法取不同固定值：后注册的变体可覆盖默认行为
		it("valued override", () => {
			cmd = app.command("test2 <msg>");
			cmd.option("writer", "-w <id:number>");
			cmd.option("writer", "-W, --anonymous", { value: 0 });
			expect(cmd.parse("foo -w 1 bar")).toHaveShape({
				args: ["foo", "bar"],
				options: { writer: 1 },
			});
			expect(cmd.parse("foo -W bar")).toHaveShape({
				args: ["foo", "bar"],
				options: { writer: 0 },
			});
		});

		// 类型化参数：变长 number 参数把每个 token 强转为数字
		it("typed arguments", () => {
			cmd = app.command("test3 [...args:number]");
			expect(cmd.parse("1 2 -3")).toHaveShape({ args: [1, 2, -3] });
		});
	});

	// 高级特性：符号选项、选项注销、"--" 剩余选项与终止符语义
	describe("Advanced Features", () => {
		// 符号选项："#" 这样的非字母写法也能触发选项解析
		it("symbol alias", () => {
			cmd = app.command("cmd3");
			cmd.option("sharp", "# <id>");
			expect(cmd.parse("# 1")).toHaveShape({
				args: [],
				options: { sharp: "1" },
			});
		});

		// 同一符号被两个选项抢占时应抛错
		it("duplicate option", () => {
			expect(() => cmd.option("flat", "#")).toThrow();
		});

		// 注销选项后，原写法退化为普通参数
		it("remove option", () => {
			expect(cmd.removeOption("sharp" as never)).toBe(true);
			expect(cmd.parse("# 1")).toHaveShape({ args: ["#", "1"], options: {} });
			expect(cmd.removeOption("sharp" as never)).toBe(false);
		});

		// "--" 剩余选项：其后的内容整体作为 text 值，引号与终止符不特殊处理
		it("rest option", () => {
			cmd.option("rest", "-- <rest:text>");
			expect(cmd.parse("a b -- c d")).toHaveShape({
				args: ["a", "b"],
				options: { rest: "c d" },
			});
			expect(cmd.parse('a "b -- c" d')).toHaveShape({
				args: ["a", "b -- c", "d"],
				options: {},
			});
			expect(cmd.parse('a b -- "c d"')).toHaveShape({
				args: ["a", "b"],
				options: { rest: '"c d"' },
			});
		});

		// 终止符（普通参数场景）： ";" 截断解析，剩余文本进 rest；
		// 引号的闭合优先级高于终止符
		it("terminator 1", () => {
			expect(cmd.parse("foo bar baz", ";")).toHaveShape({
				args: ["foo", "bar", "baz"],
			});
			expect(cmd.parse('"foo bar" baz', ";")).toHaveShape({
				args: ["foo bar", "baz"],
			});
			expect(cmd.parse('"foo bar "baz', ";")).toHaveShape({
				args: ['"foo bar "baz'],
			});
			expect(cmd.parse('foo" bar" baz', ";")).toHaveShape({
				args: ['foo"', 'bar"', "baz"],
			});
			expect(cmd.parse("foo;bar baz", ";")).toHaveShape({
				args: ["foo"],
				rest: "bar baz",
			});
			expect(cmd.parse('"foo;bar";baz', ";")).toHaveShape({
				args: ["foo;bar"],
				rest: "baz",
			});
		});

		// 终止符（贪婪选项场景）：贪婪值内部保留引号原文，终止符仍然生效
		it("terminator 2", () => {
			expect(cmd.parse("-- foo bar baz", ";")).toHaveShape({
				options: { rest: "foo bar baz" },
			});
			expect(cmd.parse('-- "foo bar" baz', ";")).toHaveShape({
				options: { rest: '"foo bar" baz' },
			});
			expect(cmd.parse('-- "foo bar baz"', ";")).toHaveShape({
				options: { rest: '"foo bar baz"' },
			});
			expect(cmd.parse("-- foo;bar baz", ";")).toHaveShape({
				options: { rest: "foo" },
				rest: "bar baz",
			});
			expect(cmd.parse('-- "foo;bar" baz', ";")).toHaveShape({
				options: { rest: '"foo;bar" baz' },
			});
			expect(cmd.parse('-- "foo;bar";baz', ";")).toHaveShape({
				options: { rest: '"foo;bar"' },
				rest: "baz",
			});
		});
	});

	// 元素类型参数：按消息元素（而非纯文本）解析
	describe("Types", () => {
		// img 类型：解析 img 元素并取其属性；外层包裹元素（如 <p>）被剥掉；
		// 类型不符时报错
		it("img", () => {
			cmd = app.command("img <img:img>");
			expect(cmd.parse('<img src="/"/>')).toHaveShape({
				args: [{ src: "/" }],
			});
			expect(cmd.parse("<p></p>")).toHaveShape({
				error: "internal.invalid-argument",
			});
			expect(cmd.parse('<p><img src="/"/></p>')).toHaveShape({
				args: [{ src: "/" }],
			});
		});
	});
});
