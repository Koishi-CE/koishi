/**
 * env 文件解析与注入测试：dotenv 子集解析器、注入/撤销语义。
 */
import { afterEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectEnv, parseEnv, parseEnvFiles, revertEnv } from "../env.ts";

describe("parseEnv", () => {
	it("基础键值与空白处理", () => {
		expect(
			parseEnv(`
A=1
  B = spaced
EMPTY=
`),
		).toEqual({ A: "1", B: "spaced", EMPTY: "" });
	});

	it("注释行与行内注释", () => {
		expect(
			parseEnv(`
# full line comment
A=1 # trailing comment
B=2
`),
		).toEqual({ A: "1", B: "2" });
	});

	it("可选 export 前缀与冒号分隔符", () => {
		expect(parseEnv("export A=1\nB: 2")).toEqual({ A: "1", B: "2" });
	});

	it("单引号为字面值（不处理转义）", () => {
		expect(parseEnv(`A='x#y'\nB='two  words'`)).toEqual({
			A: "x#y",
			B: "two  words",
		});
	});

	it("双引号处理常见转义序列", () => {
		expect(parseEnv('A="line1\\nline2"\nB="tab\\there"')).toEqual({
			A: "line1\nline2",
			B: "tab\there",
		});
	});

	it("双引号值可跨行（如证书内容）", () => {
		expect(parseEnv('KEY="-----BEGIN-----\nbody\n-----END-----"')).toEqual({
			KEY: "-----BEGIN-----\nbody\n-----END-----",
		});
	});

	it("无法识别的行静默跳过", () => {
		expect(parseEnv("this is not a pair\n=noname\nA=1")).toEqual({
			A: "1",
		});
	});
});

describe("injectEnv / revertEnv", () => {
	afterEach(() => {
		delete process.env["KOISHI_TEST_ENV_A"];
		delete process.env["KOISHI_TEST_ENV_B"];
	});

	it("注入新键并可用键列表撤销", () => {
		const keys = injectEnv({
			KOISHI_TEST_ENV_A: "a",
			KOISHI_TEST_ENV_B: "b",
		});
		expect(keys).toEqual(["KOISHI_TEST_ENV_A", "KOISHI_TEST_ENV_B"]);
		expect(process.env["KOISHI_TEST_ENV_A"]).toBe("a");

		revertEnv(keys);
		expect(process.env["KOISHI_TEST_ENV_A"]).toBeUndefined();
		expect(process.env["KOISHI_TEST_ENV_B"]).toBeUndefined();
	});

	it("进程启动时已存在的键不被覆盖", () => {
		// PATH 在任何环境下都预先存在
		const original = process.env["PATH"];
		const keys = injectEnv({ PATH: "/definitely/not/real" });
		expect(keys).toEqual([]);
		expect(process.env["PATH"]).toBe(original);
	});
});

describe("parseEnvFiles", () => {
	it("按序合并多个文件（后者覆盖前者），缺失文件静默跳过", async () => {
		const dir = await fs.mkdtemp(join(tmpdir(), "koishi-loader-env-"));
		try {
			await Bun.write(join(dir, ".env"), "A=1\nB=first");
			await Bun.write(join(dir, ".env.local"), "B=second\nC=3");
			expect(
				await parseEnvFiles([
					join(dir, ".env"),
					join(dir, ".missing"),
					join(dir, ".env.local"),
				]),
			).toEqual({ A: "1", B: "second", C: "3" });
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
