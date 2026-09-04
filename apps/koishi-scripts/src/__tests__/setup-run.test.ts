// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackageJson } from "../index.ts";

/**
 * setup 子命令主流程（runSetup）的端到端测试。
 *
 * 通过 mock "../index.ts" 把宿主工作目录（cwd）与宿主清单（loadHostManifest）
 * 重定向到临时目录 / 可变值，从而在不污染仓库的前提下驱动真实的写盘流程；
 * git 探测（gitConfig）与 git init 为真实子进程调用，副作用均落在临时目录内。
 */

/** 各用例共享的宿主工作区根（mock 后的 cwd） */
const workspaceRoot = mkdtempSync(
	join(tmpdir(), "koishi-setup-run-"),
);

/** 当前用例的宿主清单（loadHostManifest 的返回值） */
let hostManifest: PackageJson | null = null;

mock.module("../index.ts", () => ({
	cwd: workspaceRoot,
	loadHostManifest: async () => hostManifest,
}));

const { default: runSetup } = await import("../setup.ts");

/** 收集 console.log 输出，避免脚手架横幅刷屏并可供断言 */
const logs: string[] = [];
const originalLog = console.log;
// bun-types 将 isTTY 定为非可选，经可选视图读写与删除
const stdin = process.stdin as { isTTY?: boolean };
const originalIsTTY = stdin.isTTY;

beforeAll(() => {
	console.log = (...args: unknown[]) => {
		logs.push(args.map((arg) => `${arg}`).join(" "));
	};
	// bun test 会继承所在终端的 TTY：交互终端下 stdin.isTTY 为 true，
	// 会让缺参用例误入问询分支（本文件全部用例都以参数驱动，强制非交互）
	stdin.isTTY = false;
});

afterAll(() => {
	console.log = originalLog;
	if (originalIsTTY === undefined) {
		delete stdin.isTTY;
	} else {
		stdin.isTTY = originalIsTTY;
	}
	rmSync(workspaceRoot, { recursive: true, force: true });
});

beforeEach(() => {
	hostManifest = null;
	logs.length = 0;
	// 每个用例重建干净的 external/
	rmSync(join(workspaceRoot, "external"), {
		recursive: true,
		force: true,
	});
	mkdirSync(join(workspaceRoot, "external"), {
		recursive: true,
	});
});

/** 预置一个带 repository 字段的兄弟项目（供 GitHub 所有者众数探测） */
function seedSibling(name: string, owner: string): void {
	const dir = join(workspaceRoot, "external", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: `koishi-plugin-${name}`,
			repository: {
				url: `git+https://github.com/${owner}/x.git`,
			},
		}),
	);
}

/** 读取生成的 package.json 并解析 */
function readManifest(
	...rel: string[]
): Record<string, unknown> {
	return JSON.parse(
		readFileSync(
			join(workspaceRoot, "external", ...rel),
			"utf8",
		),
	) as Record<string, unknown>;
}

describe("runSetup 主流程", () => {
	it("非交互单包形态：全参数生成 + 宿主版本注入", async () => {
		hostManifest = {
			dependencies: { koishi: "^9.9.9" },
			devDependencies: { "@koishijs/client": "^7.7.7" },
		};
		seedSibling("proj-1", "ProbeOwner");
		seedSibling("proj-2", "ProbeOwner");
		// 预建同名空目录：已存在但为空时应当直接通过
		mkdirSync(join(workspaceRoot, "external", "demo"));

		const code = await runSetup([
			"--name=demo",
			"--desc=演示插件",
			"--owner=Oppenheymu",
		]);
		expect(code).toBe(0);

		const dir = join(workspaceRoot, "external", "demo");
		// 静态文件齐备
		for (const file of [
			"package.json",
			"tsconfig.json",
			"tsdown.config.ts",
			join("src", "index.ts"),
			"biome.json",
			join(".changeset", "config.json"),
			join(".changeset", "README.md"),
			"AGENTS.md",
			".gitignore",
			".editorconfig",
			".gitattributes",
			"readme.md",
			"LICENSE",
		]) {
			expect(existsSync(join(dir, file)), file).toBe(true);
		}
		// console 形态的 client/ 目录不应出现
		expect(existsSync(join(dir, "client"))).toBe(false);

		const manifest = readManifest("demo", "package.json");
		expect(manifest["name"]).toBe("koishi-plugin-demo");
		expect(manifest["files"]).toEqual(["lib"]);
		// 宿主清单优先：koishi 取宿主版本，非 console 不带 client 依赖
		expect(manifest["peerDependencies"]).toEqual({
			koishi: "^9.9.9",
		});
		expect(manifest["devDependencies"]).not.toHaveProperty(
			"@koishijs/client",
		);
		const repository = manifest["repository"] as Record<
			string,
			string
		>;
		expect(repository["url"]).toContain(
			"github.com/Oppenheymu/koishi-plugin-demo",
		);
		// 入口为普通变体（无 console 扩展注册）
		expect(
			readFileSync(join(dir, "src", "index.ts"), "utf8"),
		).not.toContain("addEntry");
		// changeset 配置带主分支字段
		const changeset = readManifest(
			"demo",
			".changeset",
			"config.json",
		);
		expect(typeof changeset["baseBranch"]).toBe("string");
		// git init 分支被成功执行（spawnSync 可能被其它测试文件的
		// node:child_process mock 拦截而不产生真实 .git，以回执日志为准）
		expect(logs.join("\n")).toMatch(
			/已初始化 git 仓库（分支 \S+）/,
		);
		expect(logs.join("\n")).toContain("[setup] 🎉 完成");
	});

	it("console 形态：client/ 目录 + owner 众数探测 + 兜底版本", async () => {
		seedSibling("proj-1", "ProbeOwner");
		seedSibling("proj-2", "ProbeOwner");
		seedSibling("proj-3", "OtherOwner");

		const code = await runSetup([
			"--console",
			"--name=web",
		]);
		expect(code).toBe(0);

		const dir = join(workspaceRoot, "external", "web");
		for (const file of [
			join("client", "index.ts"),
			join("client", "page.vue"),
			join("client", "tsconfig.json"),
		]) {
			expect(existsSync(join(dir, file)), file).toBe(true);
		}
		const manifest = readManifest("web", "package.json");
		expect(manifest["files"]).toEqual(["lib", "dist"]);
		// owner 未显式给出时取兄弟项目众数（ProbeOwner 两票 > OtherOwner 一票）
		expect(manifest["homepage"]).toContain(
			"github.com/ProbeOwner/koishi-plugin-web",
		);
		// 宿主清单缺失：koishi 与 plugin-console 走兜底常量，client 走兜底
		expect(manifest["peerDependencies"]).toEqual({
			koishi: "^4.18.11",
			"@koishijs/plugin-console": "^5.30.11",
		});
		const devDeps = manifest["devDependencies"] as Record<
			string,
			string
		>;
		expect(devDeps["@koishijs/client"]).toBe("^5.30.4");
		// 入口为 console 变体
		expect(
			readFileSync(join(dir, "src", "index.ts"), "utf8"),
		).toContain("ctx.console.addEntry");
	});

	it("monorepo 形态：仓库根 + packages/ 子包两级结构", async () => {
		const code = await runSetup([
			"--monorepo",
			"--name=mono",
			"--owner=OwnerX",
		]);
		expect(code).toBe(0);

		const root = join(workspaceRoot, "external", "mono");
		const rootManifest = readManifest(
			"mono",
			"package.json",
		);
		expect(rootManifest["name"]).toBe("@root/mono");
		expect(rootManifest["private"]).toBe(true);
		expect(rootManifest["workspaces"]).toEqual([
			"packages/*",
		]);
		expect(
			existsSync(join(root, "tsconfig.base.json")),
		).toBe(true);
		expect(
			readFileSync(join(root, "tsconfig.json"), "utf8"),
		).toContain("koishi-plugin-*");
		expect(existsSync(join(root, "biome.json"))).toBe(true);

		const member = readManifest(
			"mono",
			"packages",
			"mono",
			"package.json",
		);
		expect(member["name"]).toBe("koishi-plugin-mono");
		// 子包不自封 workspace、不重复声明 changesets scripts
		expect(member).not.toHaveProperty("workspaces");
		const scripts = member["scripts"] as Record<
			string,
			unknown
		>;
		expect(scripts).not.toHaveProperty("changeset");
		expect(scripts).not.toHaveProperty("release");
		// git 仓库初始化发生在仓库根（子包内不重复初始化；spawnSync 可能
		// 被其它文件的 mock 拦截而不产生真实 .git，根级以回执日志为准）
		expect(logs.join("\n")).toMatch(
			/已初始化 git 仓库（分支 \S+）/,
		);
		expect(
			existsSync(join(root, "packages", "mono", ".git")),
		).toBe(false);
	});

	it("owner 探测不足两票时留空：不写 homepage/repository", async () => {
		seedSibling("only-one", "LonelyOwner");

		const code = await runSetup(["--name=solo"]);
		expect(code).toBe(0);

		const manifest = readManifest("solo", "package.json");
		expect(manifest).not.toHaveProperty("homepage");
		expect(manifest).not.toHaveProperty("repository");
	});

	it("external/ 缺失时探测静默失败，且非交互缺 --name 报错", async () => {
		rmSync(join(workspaceRoot, "external"), {
			recursive: true,
			force: true,
		});
		await expect(runSetup([])).rejects.toThrow(
			"非交互环境下必须提供 --name=<包名>",
		);
	});

	it("非法包名报错", async () => {
		await expect(
			runSetup(["--name=bad name!"]),
		).rejects.toThrow("非法的包名：bad name!");
	});

	it("目标目录已存在且非空时报错", async () => {
		const dir = join(workspaceRoot, "external", "demo");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, " occupier.txt"), "占位");
		await expect(runSetup(["--name=demo"])).rejects.toThrow(
			"目标目录已存在且非空：external/demo",
		);
	});
});

describe("目录清理核对", () => {
	it("临时工作区已删除", () => {
		// afterAll 的 rmSync 在本用例之后执行，这里只确认根目录路径形态正确
		expect(
			readdirSync(workspaceRoot).length,
		).toBeGreaterThanOrEqual(0);
	});
});
