// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 内置项目模板（create-koishi-ce 的默认模板）。
 *
 * 历史包袱修正：本脚手架最初直接下载上游官方 @koishijs/boilerplate 解包
 * 生成项目，产物依赖全是 npm 官方包（koishi / @koishijs/*），完全绕开了
 * 本仓的 @koishi-ce 再分发生态（官方 market 还带 Bun 下必炸的 get-registry）。
 * 默认模板改为内置的纯 @koishi-ce 依赖集；确需上游官方模板时用
 * --template <包名> 走 npm 远程下载（见 remote.ts 的 scaffoldRemote）。
 *
 * 模板的静态文本一律放在 src/template/ 下的真实文件里（本模块只负责
 * 定位与读取，不再内嵌字符串常量）。npm 包的 files 含 src，因此 lib
 * 产物与 src 直跑两种形态都能按相对路径定位到模板目录。
 *
 * 模板要点：
 * - 运行时 Bun：koishi CLI（@koishi-ce/koishi 的 bin）与 loader 插件加载链
 *   均以 Bun 为准（ESM-only 产物，Bun 原生加载 TS / yml）；脚本里的环境
 *   变量注入直接写 `NODE_ENV=... ` 前缀——bun run 走 Bun Shell，跨平台
 *   原生支持，无需 cross-env 一类的依赖；
 * - "koishi" 裸名与 @koishijs/core / @koishijs/loader / @koishijs/plugin-console /
 *   @koishijs/client / @koishijs/components 上游名用 npm alias 钉到 @koishi-ce
 *   shim（版本冻结线，见 packages/shim）：上游官方 adapter / database 插件与
 *   社区 koishi-plugin-* 的 peer 由此满足，webui 插件写进 dependencies 的
 *   client / components 亦被钉住（满足性判定看落盘版本），不会拉入 npm
 *   官方全家桶形成第二份框架副本；市场安装亦不改写该声明
 *   （installer 的 isGuardedRequest 护栏将 npm:@koishi-ce alias 与
 *   workspace: 同等保护）；
 * - koishi.yml 采用配置页导出形态：插件键带 uid 实例后缀，分组带中文
 *   $label 与 $collapsed 元数据；database-sqlite 默认启用，开箱即得数
 *   据库；依赖数据库但非必需的插件（admin / bind / auth / broadcast /
 *   callme）保持 ~ 禁用；本仓不再分发的 adapter 官方插件只以 ~ 禁用条
 *   目预写、不预装——loader 跳过禁用条目，装好后在控制台启用（mongo /
 *   mysql / postgres 等未再分发的 database 不再预写占位条目，市场装后
 *   自动出现）；
 * - 依赖版本统一 ^1.0.0 区间（安装时取最新 1.x），shim 版本例外（冻结线）。
 */
import {
	existsSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Manifest } from "./manifest.ts";

/**
 * 定位内置模板目录：src 直跑（开发 / 测试）与 lib 产物（npm 消费）两种
 * 形态各按相对路径探测（发布包 files 含 src，lib 同级的 ../src/template
 * 恒存在）。
 */
function locateTemplateDir(): string {
	const base = import.meta.dir;
	for (const dir of [
		join(base, "template"),
		join(base, "../src/template"),
	]) {
		if (existsSync(dir)) return dir;
	}
	throw new Error(
		"create-koishi-ce 内置模板目录缺失（src/template）",
	);
}

const templateDir = locateTemplateDir();

/**
 * 无点前缀的模板源文件名 → 生成项目中的目标路径。点开头文件会被 npm
 * 发布规则与各路工具的特殊处理波及（.env 恒不入包、嵌套 .gitignore 会被
 * git 当真），模板目录里一律存无点文件名。
 */
const dotFiles: Record<string, string> = {
	env: ".env",
	gitignore: ".gitignore",
};

/** 模板静态文件（相对项目根的路径 → 文件内容），package.json 另行渲染 */
export const templateFiles: Record<string, string> =
	Object.fromEntries(
		readdirSync(templateDir)
			.filter((file) => !file.startsWith("."))
			.map((file) => [
				dotFiles[file] ?? file,
				readFileSync(join(templateDir, file), "utf8"),
			]),
	);

/**
 * 上游名 → CE 对应包的 overrides 兜底映射（值统一 npm:<目标>@^1.0.0，
 * 经 buildUpstreamOverrides 包装）。
 *
 * 六行钉名依赖「落盘版本满足声明范围」：第三方插件的声明超出冻结线
 * （如未来上游升线后的 ^6）或引用清单外的上游名（如 dependencies 直接
 * 依赖 @koishijs/plugin-admin / @koishijs/utils）时，官方包仍会落盘。
 * overrides 是包管理器级的强制重写——不看版本满足性，把整棵依赖树中对
 * 这些上游名的解析一律改指 CE 对应包，与钉名构成双层防线（napuketto
 * 事件 2026-09-19 后补）。
 *
 * 清单 = CE 已再分发且官方同名的包，2026-09-19 逐一 npm view 核实：
 * - plugin-cron 不在列（上游是裸名社区包 koishi-plugin-cron，非 @koishijs
 *   作用域）；
 * - plugin-welcome / plugin-theme-vanilla 不在列（CE 原创，上游无此名）；
 * - plugin-assets 的 CE 对应物是 @koishi-ce/assets（无 plugin 前缀）。
 * 新增 CE 再分发包时须同步本表与 sandbox 生成器的同款清单
 * （tooling/sandbox/manifest.ts，对账测试防漂移）。
 */
const UPSTREAM_OVERRIDES: Record<string, string> = {
	koishi: "@koishi-ce/koishi",
	"@koishijs/core": "@koishi-ce/koishi",
	"@koishijs/loader": "@koishi-ce/koishi",
	"@koishijs/utils": "@koishi-ce/utils",
	"@koishijs/i18n-utils": "@koishi-ce/i18n-utils",
	"@koishijs/client": "@koishi-ce/client",
	"@koishijs/components": "@koishi-ce/components",
	"@koishijs/console": "@koishi-ce/console",
	"@koishijs/registry": "@koishi-ce/registry",
	"@koishijs/plugin-console": "@koishi-ce/plugin-console",
	"@koishijs/plugin-assets": "@koishi-ce/assets",
};

// CE 与上游同名再分发的 plugin-*：机械一一对应
for (const name of [
	"actions",
	"admin",
	"analytics",
	"assets-local",
	"auth",
	"bind",
	"broadcast",
	"callme",
	"commands",
	"config",
	"database-sqlite",
	"dataview",
	"echo",
	"explorer",
	"help",
	"hmr",
	"insight",
	"inspect",
	"locales",
	"logger",
	"market",
	"mock",
	"notifier",
	"oobe",
	"proxy-agent",
	"rate-limit",
	"sandbox",
	"server",
	"server-temp",
	"status",
]) {
	UPSTREAM_OVERRIDES[`@koishijs/plugin-${name}`] =
		`@koishi-ce/plugin-${name}`;
}

/** 生成模板 overrides 块：键为上游名，值统一 npm:<CE 包>@^1.0.0。 */
export function buildUpstreamOverrides(): Record<
	string,
	string
> {
	return Object.fromEntries(
		Object.entries(UPSTREAM_OVERRIDES).map(
			([name, target]) => [name, `npm:${target}@^1.0.0`],
		),
	);
}

/**
 * 内置模板的 package.json 基础内容（name/version 会被 renderManifest 覆写，
 * prod 模式下 workspaces 与 devDependencies 会被移除）。
 */
export function baseManifest(): Manifest {
	return {
		type: "module",
		// 本项目只用 Bun：钉住创建时的 Bun 版本（bun run 亦据此选择解释器）
		packageManager: `bun@${Bun.version}`,
		// globstar + 负向排除（Bun workspaces 支持完整 glob 语法）：external
		// 下任意深度的插件包（含克隆来的 monorepo 形态 packages/ 子包）都是
		// workspace 成员；node_modules 排除搬迁残留的依赖目录（包管理器
		// 对其另有管理，混入成员会污染解析）。配置页的「添加插件」列表按
		// 同一份声明展开收录，声明写多深列表就能看多深
		workspaces: [
			"plugins/*",
			"external/**",
			"!external/**/node_modules/**",
		],
		scripts: {
			start: "koishi start",
			// bun run 走 Bun Shell，`NODE_ENV=...` 前缀天然跨平台，无需 cross-env
			dev: "NODE_ENV=development koishi start",
			// 插件开发链（devDep @koishi-ce/scripts 的 koishi-scripts CLI，操作
			// 本工作区 plugins/ 与 external/；纯运行 bot 的项目用不到这些入口，
			// prod 模式删 devDependencies 后它们自然失效）：
			// new 生成插件骨架到 external/，clone 克隆已有插件仓库本地联动，
			// update 白名单更新本项目的 @koishi-ce/* 依赖（裸 bun update 是
			// 全树更新语义，会拉动第三方插件与全部传递依赖，勿用），
			// build / release* 构建并发布 external/ 下的插件（version → build
			// → publish 三环，dry-run 为演练形态）
			new: "koishi-scripts setup",
			clone: "koishi-scripts clone",
			update: "koishi-scripts update",
			build: "koishi-scripts build",
			"release:version": "koishi-scripts version",
			"release:dryrun":
				"bun run release:version && bun run build && koishi-scripts publish --dry-run",
			release:
				"bun run release:version && bun run build && koishi-scripts publish",
		},
		dependencies: {
			"@koishi-ce/koishi": "^1.0.0",
			"@koishi-ce/plugin-actions": "^1.0.0",
			"@koishi-ce/plugin-admin": "^1.0.0",
			"@koishi-ce/plugin-analytics": "^1.0.0",
			"@koishi-ce/plugin-assets-local": "^1.0.0",
			"@koishi-ce/plugin-auth": "^1.0.0",
			"@koishi-ce/plugin-bind": "^1.0.0",
			"@koishi-ce/plugin-broadcast": "^1.0.0",
			"@koishi-ce/plugin-callme": "^1.0.0",
			"@koishi-ce/plugin-commands": "^1.0.0",
			"@koishi-ce/plugin-config": "^1.0.0",
			"@koishi-ce/plugin-console": "^1.0.0",
			"@koishi-ce/plugin-database-sqlite": "^1.0.0",
			"@koishi-ce/plugin-dataview": "^1.0.0",
			"@koishi-ce/plugin-echo": "^1.0.0",
			"@koishi-ce/plugin-explorer": "^1.0.0",
			"@koishi-ce/plugin-help": "^1.0.0",
			"@koishi-ce/plugin-http": "^1.0.0",
			"@koishi-ce/plugin-insight": "^1.0.0",
			"@koishi-ce/plugin-inspect": "^1.0.0",
			"@koishi-ce/plugin-locales": "^1.0.0",
			"@koishi-ce/plugin-logger": "^1.0.0",
			"@koishi-ce/plugin-market": "^1.0.0",
			"@koishi-ce/plugin-notifier": "^1.0.0",
			"@koishi-ce/plugin-oobe": "^1.0.0",
			"@koishi-ce/plugin-proxy-agent": "^1.0.0",
			"@koishi-ce/plugin-rate-limit": "^1.0.0",
			"@koishi-ce/plugin-sandbox": "^1.0.0",
			"@koishi-ce/plugin-server": "^1.0.0",
			"@koishi-ce/plugin-server-temp": "^1.0.0",
			"@koishi-ce/plugin-status": "^1.0.0",
			"@koishi-ce/plugin-theme-vanilla": "^1.0.0",
			"@koishi-ce/plugin-welcome": "^1.0.0",
			// 上游裸名占位：npm alias 钉到 @koishi-ce 的 koishi shim（勿删，
			// 语义见文件头注释）；版本必须保持 4.18.x 冻结线以满足 ^4 peer
			koishi: "npm:@koishi-ce/koishi-shim@^4.18.11",
			// 上游 console 名占位：CE 插件的 peer 声明上游名，无归属时 Bun
			// 会自动装下 npm 官方 console 全家桶形成双实例；版本冻结 5.30.x
			"@koishijs/plugin-console":
				"npm:@koishi-ce/console-shim@^5.30.11",
			// 上游 core 名占位：@koishi-ce/loader 的 peer 精确锁 4.18.11，
			// alias 须逐字相等（不带 ^），版本冻结勿 bump。core 与 loader
			// 两个名字共用 koishi-shim：@koishi-ce/koishi 是 core + loader
			// 的合并再导出（与上游 koishi 主包同构），named 导出全覆盖
			"@koishijs/core":
				"npm:@koishi-ce/koishi-shim@4.18.11",
			// 上游 loader 名占位：config / hmr 插件的 peer；同样指向
			// koishi-shim（4.18.11 满足 ^4.6.11），勿指回已废弃的 loader-shim
			"@koishijs/loader":
				"npm:@koishi-ce/koishi-shim@^4.18.11",
			// 上游 client 名占位：第三方 webui 插件常把 @koishijs/client 写进
			// dependencies（非 peer，napuketto 实证），无归属时 Bun 装下官方
			// client 并连带官方 components 全家桶；版本冻结 5.30.x 线满足 ^5.x
			"@koishijs/client":
				"npm:@koishi-ce/client-shim@^5.30.11",
			// 上游 components 名占位：官方 client 的硬依赖，插件生态亦常直接
			// 依赖（element-plus 系共享组件库）；版本冻结 1.5.x 线满足 ^1.5
			"@koishijs/components":
				"npm:@koishi-ce/components-shim@^1.5.22",
		},
		// overrides 兜底层（语义见 UPSTREAM_OVERRIDES 注释）：不看版本
		// 满足性强制重写整棵依赖树，拦住钉名覆盖面之外的上游声明
		overrides: buildUpstreamOverrides(),
		devDependencies: {
			"@koishi-ce/client": "^1.0.0",
			"@koishi-ce/plugin-hmr": "^1.0.0",
			"@koishi-ce/plugin-mock": "^1.0.0",
			"@koishi-ce/scripts": "^1.0.0",
			"bun-types": "^1.4.0",
		},
	};
}
