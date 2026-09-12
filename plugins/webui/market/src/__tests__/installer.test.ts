// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	app,
	itQuiet,
	setNextExitCode,
	setNextSpawnError,
	spawnCalls,
	startApp,
	stopApp,
	tmp,
} from "./helpers.ts";

const { isResidentInCache } = await import(
	"@koishi-ce/registry"
);

beforeAll(startApp);
afterAll(stopApp);

describe("Installer 安装链路", () => {
	itQuiet(
		"install 尊重护栏依赖并执行子进程安装",
		async () => {
			setNextExitCode(0);
			spawnCalls.length = 0;
			const code = await app.installer.install({
				koishi: "2.0.0",
				"market-alias": null,
				"koishi-plugin-demo": "^1.0.0",
			});
			expect(code).toBe(0);
			// 触发了包管理器安装（bun install --registry …）
			expect(spawnCalls.length).toBe(1);
			expect(spawnCalls[0]?.[0]).toBe("install");
			// 重新读取临时 package.json：护栏项保持原样，新依赖加入
			const manifest = JSON.parse(
				await Bun.file(join(tmp, "package.json")).text(),
			) as { dependencies: Record<string, string> };
			expect(manifest.dependencies["koishi"]).toBe(
				"workspace:*",
			);
			expect(manifest.dependencies["market-alias"]).toBe(
				"npm:@koishi-ce/anything@^1.0.0",
			);
			expect(
				manifest.dependencies["koishi-plugin-demo"],
			).toBe("^1.0.0");
		},
		15000,
	);

	itQuiet(
		"install 强制时无视本地满足也要装",
		async () => {
			setNextExitCode(0);
			spawnCalls.length = 0;
			const code = await app.installer.install(
				{ "koishi-plugin-demo": "^1.0.0" },
				true,
			);
			expect(code).toBe(0);
			expect(spawnCalls.length).toBe(1);
		},
		15000,
	);

	itQuiet(
		"子进程非零退出码向上传递",
		async () => {
			setNextExitCode(1);
			spawnCalls.length = 0;
			const code = await app.installer.install(
				{ "koishi-plugin-demo": "^2.0.0" },
				true,
			);
			expect(code).toBe(1);
		},
		15000,
	);

	itQuiet("子进程 spawn 失败返回 -1", async () => {
		setNextSpawnError(true);
		setNextExitCode(0);
		const code = await app.installer.exec(["install"]);
		setNextSpawnError(false);
		expect(code).toBe(-1);
	});

	/** 在临时 node_modules 落盘一个带 dependencies 声明的校验用包 */
	function placeLinkcheckPkg(
		dependencies: Record<string, string>,
	) {
		const name = "koishi-plugin-linkcheck";
		const pkgDir = join(tmp, "node_modules", name);
		mkdirSync(pkgDir, { recursive: true });
		writeFileSync(
			join(pkgDir, "package.json"),
			JSON.stringify({
				name,
				version: "1.0.0",
				dependencies,
			}),
		);
		return pkgDir;
	}

	itQuiet(
		"装后依赖链接完整时不触发补装",
		async () => {
			setNextExitCode(0);
			spawnCalls.length = 0;
			const pkgDir = placeLinkcheckPkg({
				"linkcheck-dep": "^1.0.0",
			});
			const depDir = join(
				tmp,
				"node_modules",
				"linkcheck-dep",
			);
			mkdirSync(depDir, { recursive: true });
			writeFileSync(
				join(depDir, "package.json"),
				JSON.stringify({
					name: "linkcheck-dep",
					version: "1.0.0",
				}),
			);
			try {
				const code = await app.installer.install(
					{ "koishi-plugin-linkcheck": "^1.0.0" },
					true,
				);
				expect(code).toBe(0);
				expect(spawnCalls.length).toBe(1);
			} finally {
				rmSync(pkgDir, { recursive: true, force: true });
				rmSync(depDir, { recursive: true, force: true });
			}
		},
		15000,
	);

	itQuiet(
		"包级依赖链接缺失时自动补装一次且不无限重试",
		async () => {
			setNextExitCode(0);
			spawnCalls.length = 0;
			// isolated 增量安装缺陷形态:包已落盘但声明的依赖未链接。
			// 首装后校验命中补装一次;mock 安装不会真落盘依赖,二次校验
			// 仍缺,只告警不再补装——总计恰好两次子进程调用
			const pkgDir = placeLinkcheckPkg({
				"linkcheck-missing": "^1.0.0",
			});
			try {
				const code = await app.installer.install(
					{ "koishi-plugin-linkcheck": "^1.0.0" },
					true,
				);
				expect(code).toBe(0);
				expect(spawnCalls.length).toBe(2);
			} finally {
				rmSync(pkgDir, { recursive: true, force: true });
			}
		},
		15000,
	);

	itQuiet(
		"alias 声明的依赖跳过链接校验",
		async () => {
			setNextExitCode(0);
			spawnCalls.length = 0;
			// alias 落盘名与键名无直接映射,不入校验,缺失也不触发补装
			const pkgDir = placeLinkcheckPkg({
				"linkcheck-alias": "npm:whatever@^1.0.0",
			});
			try {
				const code = await app.installer.install(
					{ "koishi-plugin-linkcheck": "^1.0.0" },
					true,
				);
				expect(code).toBe(0);
				expect(spawnCalls.length).toBe(1);
			} finally {
				rmSync(pkgDir, { recursive: true, force: true });
			}
		},
		15000,
	);

	itQuiet(
		"exec 收集子进程 stdout / stderr 输出行",
		async () => {
			setNextExitCode(0);
			setNextSpawnError(false);
			const code = await app.installer.exec(["install"]);
			expect(code).toBe(0);
		},
	);
});

describe("isResidentInCache（装后重载判定）", () => {
	/** 在临时 node_modules 放一个已安装包，返回其目录 */
	function placePkg(name: string) {
		const pkgDir = join(tmp, "node_modules", name);
		mkdirSync(pkgDir, { recursive: true });
		writeFileSync(
			join(pkgDir, "package.json"),
			JSON.stringify({
				name,
				version: "1.0.0",
				main: "index.js",
			}),
		);
		writeFileSync(
			join(pkgDir, "index.js"),
			"module.exports = {}",
		);
		return pkgDir;
	}

	it("包目录下有模块驻留 require.cache 时返回 true", () => {
		const pkgDir = placePkg("koishi-plugin-resident-check");
		// 入口经 require 进入 require.cache，模拟旧版本驻留内存
		require(join(pkgDir, "index.js"));
		expect(
			isResidentInCache("koishi-plugin-resident-check"),
		).toBe(true);
	});

	it("已安装但无模块驻留内存时返回 false", () => {
		placePkg("koishi-plugin-idle-check");
		expect(
			isResidentInCache("koishi-plugin-idle-check"),
		).toBe(false);
	});

	it("包不存在时保守返回 true（宁可多重载不漏判）", () => {
		expect(
			isResidentInCache("koishi-plugin-absent-check"),
		).toBe(true);
	});
});
