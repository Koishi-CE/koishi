// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 工作区别名计算（原 index.ts 的 collectWorkspaceAliases 拆出独立模块，
 * 使单测可以不拉起 vite 依赖树即可直接调用）。
 *
 * 将全部工作区包名映射到其源码目录，行为对齐根 tsconfig 的 paths 别名。
 * 没有被任何工作区包依赖的插件（如 plugin-logger）不会出现在 node_modules
 * 的链接里，bundler 无法按包名解析，必须显式提供这层映射。
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 计算工作区别名表。
 *
 * @param repoRoot 仓库根目录（默认从本模块位置上跳四级推导；测试可注入
 *   临时目录）。该参数须为正斜杠形态或可被 Bun.Glob 接受的路径。
 * @returns 包名 → 入口目录的别名表。
 *
 * 容错语义（本函数在模块顶层 await 执行，任何路径都不应抛出——抛出会
 * 拖垮整个 builder 的加载）：
 * - 仓库根不存在 package.json（下游 npm 安装形态，四级上跳不落在仓库
 *   根）→ 空表即正确语义，静默返回；
 * - package.json 存在但解析失败（损坏）→ 打印 error 后返回空表：
 *   后续构建会以模块解析错误的形式暴露，但根因在此处可见；
 * - 单个工作区包的 package.json 损坏 → 打印 warn 后跳过该包，不影响
 *   其余包的别名。
 */
export async function collectWorkspaceAliases(
	repoRoot = resolve(
		import.meta.dir,
		"../../../..",
	).replace(/\\/g, "/"),
): Promise<Record<string, string>> {
	// 源码形态(src/)与产物形态(lib/)都在包根下一级，上跳四级到仓库根一致
	const manifestPath = `${repoRoot}/package.json`;
	// 下游 npm 安装形态（.bun 嵌套布局或根提升布局）四级上跳不落在
	// 任何仓库根：读不到清单即没有 workspace 源码可映射，空表即正确
	// 语义
	if (!existsSync(manifestPath)) return {};
	let manifest: { workspaces?: string[] };
	try {
		manifest = await Bun.file(manifestPath).json();
	} catch (error) {
		console.error(
			`[console-builder] 工作区别名计算：仓库根 ${repoRoot} 的 package.json 解析失败，本次构建无工作区别名可用（跨包裸名导入将以模块解析错误暴露）：`,
			error,
		);
		return {};
	}
	const aliases: Record<string, string> = {};
	for (const pattern of manifest.workspaces ?? []) {
		// scanSync 产出的相对路径在 Windows 上是反斜杠,统一归一化为正斜杠
		const files = new Bun.Glob(
			`${pattern}/package.json`,
		).scanSync({
			cwd: repoRoot,
		});
		for (const file of files) {
			const rel = file.replaceAll("\\", "/");
			const dir = `${repoRoot}/${rel.slice(0, -"/package.json".length)}`;
			try {
				const { name } = await Bun.file(
					`${dir}/package.json`,
				).json();
				if (!name) continue;
				// 控制台前端语境下,裸包名对到浏览器端入口(替代上游 lib 的 browser
				// 导出条件);`<name>/src` 子路径对到源码目录,供共享代码引用;
				// `<name>/client` 子路径对到浏览器端入口(上游生态以该子路径跨插件
				// 引用彼此的 client API,如 market 引用 config 的 EnvInfo 类型,
				// 上游与 npm 产物的 exports 均未声明它,同样靠仓库内别名解析)。
				// 子路径键必须先插入——别名解析按插入序取首个命中项
				const srcEntry = `${dir}/src/index.ts`;
				const clientEntry = `${dir}/client/index.ts`;
				const hasSrc = existsSync(`${dir}/src`);
				const hasClient = existsSync(clientEntry);
				// 无任何入口的包不建别名：指向不存在路径的假会
				// 让 bundler 报出与真实原因无关的解析错误
				if (!hasSrc && !hasClient) continue;
				if (hasSrc) aliases[`${name}/src`] = `${dir}/src`;
				if (hasClient)
					aliases[`${name}/client`] = clientEntry;
				// 插件包同时有 src/（node 侧）与 client/（浏览器侧）时，裸名
				// 在浏览器构建语境下应落到 client 入口；其余包（浏览器库、
				// 宿主 SPA、无前端的插件）落到 src/index.ts
				aliases[name] = hasClient
					? clientEntry
					: existsSync(srcEntry)
						? srcEntry
						: `${dir}/src`;
			} catch (error) {
				// 该包的清单损坏：跳过并留痕（别名静默缺失会让 bundler
				// 报出与真实原因无关的解析错误，排查无从下手）
				console.warn(
					`[console-builder] 工作区别名计算：跳过清单损坏的工作区包 ${dir}：`,
					error,
				);
			}
		}
	}
	return aliases;
}
