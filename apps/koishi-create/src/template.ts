// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 内置项目模板（create-koishi-ce 的默认模板）。
 *
 * 历史包袱修正：本脚手架最初直接下载上游官方 @koishijs/boilerplate 解包
 * 生成项目，产物依赖全是 npm 官方包（koishi / @koishijs/*），完全绕开了
 * 本仓的 @koishi-ce 再分发生态（官方 market 还带 Bun 下必炸的 get-registry）。
 * 默认模板改为内置的纯 @koishi-ce 依赖集；确需上游官方模板时用
 * --template <包名> 走 npm 远程下载（见 index.ts 的 scaffoldRemote）。
 *
 * 模板要点：
 * - 运行时 Bun：koishi CLI（@koishi-ce/koishi 的 bin）与 loader 插件加载链
 *   均以 Bun 为准（ESM-only 产物，Bun 原生加载 TS / yml）；
 * - "koishi" 裸名与 @koishijs/core / @koishijs/loader 上游名用 npm alias
 *   钉到 @koishi-ce/koishi-shim（4.18.x 冻结线，见 packages/shim/koishi-shim）：
 *   上游官方 adapter / database 插件与社区
 *   koishi-plugin-* 的 peer `koishi ^4.x` 等由此满足，不会拉入 npm 官方
 *   koishi 形成第二份框架副本；市场安装亦不改写该声明（installer 的
 *   isGuardedRequest 护栏将 npm:@koishi-ce alias 与 workspace: 同等保护）；
 * - 本仓没有 adapter / database 插件的再分发，模板不预装这两类；依赖数据库
 *   的插件（如 analytics）在 koishi.yml 中保持 ~ 禁用，待用户从市场安装
 *   数据库插件后再启用；
 * - 依赖版本统一 ^1.0.0 区间（安装时取最新 1.x），shim 版本例外（冻结线）。
 */
import type { Manifest } from "./index.ts";

/** 模板静态文件（相对项目根的路径 → 文件内容），package.json 另行渲染 */
export const templateFiles: Record<string, string> = {
	".env": [
		"GITHUB_MIRROR = https://ghproxy.com/https://github.com",
		"GITHUB_CONTENT_MIRROR = https://ghproxy.com/https://raw.githubusercontent.com",
		"GRAVATAR_MIRROR = https://cravatar.cn",
	].join("\n"),
	".gitignore": ["node_modules/", "data/"].join("\n"),
	"koishi.yml": [
		"plugins:",
		"  group:server:",
		"    server:",
		"      port: 5140",
		"      maxPort: 5149",
		"  group:basic:",
		"    ~admin: {}",
		"    ~bind: {}",
		"    commands: {}",
		"    help: {}",
		"    http: {}",
		"    ~inspect: {}",
		"    locales: {}",
		"    proxy-agent: {}",
		"  group:console:",
		"    actions: {}",
		"    ~analytics: {}",
		"    ~auth: {}",
		"    config: {}",
		"    console:",
		"      open: true",
		"    explorer: {}",
		"    insight: {}",
		"    logger: {}",
		"    market:",
		"      search:",
		"        endpoint: https://registry.koishi.chat/index.json",
		"    notifier: {}",
		"    oobe: {}",
		"    sandbox: {}",
		"    status: {}",
		"  group:develop:",
		"    $if: env.NODE_ENV === 'development'",
		"    hmr:",
		"      root: .",
	].join("\n"),
	"tsconfig.json": [
		"{",
		'  "compilerOptions": {',
		'    "target": "ESNext",',
		'    "module": "ESNext",',
		'    "moduleResolution": "bundler",',
		'    "lib": ["ESNext"],',
		'    "types": ["bun-types"],',
		'    "strict": true,',
		'    "skipLibCheck": true,',
		'    "noEmit": true,',
		'    "allowImportingTsExtensions": true,',
		'    "verbatimModuleSyntax": true,',
		'    "erasableSyntaxOnly": true',
		"  },",
		'  "include": ["plugins/*/src", "external/*/src"]',
		"}",
	].join("\n"),
	"README.md": `# Koishi 机器人项目

由 \`bun create koishi-ce\` 生成，运行于 [@koishi-ce 社区再分发版](https://github.com/Koishi-CE/koishi) 生态。

## 环境要求

- [Bun](https://bun.sh) ≥ 1.2（运行时：koishi CLI 与插件加载链以 Bun 为准）

## 快速开始

\`\`\`bash
bun install
bun run start        # 启动（生产模式）
bun run dev          # 启动（开发模式，启用 HMR 热更新）
\`\`\`

启动后访问控制台：<http://127.0.0.1:5140>

## 安装插件

推荐在控制台「插件市场」页安装（已预配 registry.koishi.chat 镜像源）；也可以手动 \`bun add <包名>\` 后在 \`koishi.yml\` 中启用。

上游官方 adapter（如 adapter-discord / adapter-telegram）、数据库插件（如 database-sqlite）与社区 koishi-plugin-* 插件均可直接安装：根依赖中的四行 npm alias——\`"koishi": "npm:@koishi-ce/koishi-shim@^4.18.11"\`、\`"@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11"\`、\`"@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11"\`、\`"@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11"\`——已把上游生态的 peer 依赖全部钉回 @koishi-ce 框架（前两行与后两行分别只涉及 koishi-shim / console-shim 两个包；**请勿删除或改写这四行**），不会形成第二份框架 / console / loader 副本。analytics 等依赖数据库的插件请先安装数据库插件，再去掉配置中对应的 \`~\` 前缀启用。

## 自定义插件

在 \`plugins/\` 目录下创建插件包（可用 \`bun run new <名称>\` 生成骨架），在 \`koishi.yml\` 中以相对路径引用（如 \`./plugins/my-plugin\`）即可启用；Bun 直接加载 TypeScript 源码，无需预编译。
`,
};

/**
 * 内置模板的 package.json 基础内容（name/version 会被 renderManifest 覆写，
 * prod 模式下 workspaces 与 devDependencies 会被移除）。
 */
export function baseManifest(): Manifest {
	return {
		type: "module",
		workspaces: ["plugins/*", "external/*"],
		scripts: {
			start: "koishi start",
			dev: "cross-env NODE_ENV=development koishi start",
			new: "koishi-scripts setup",
		},
		dependencies: {
			"@koishi-ce/koishi": "^1.0.0",
			"@koishi-ce/plugin-actions": "^1.0.0",
			"@koishi-ce/plugin-admin": "^1.0.0",
			"@koishi-ce/plugin-analytics": "^1.0.0",
			"@koishi-ce/plugin-auth": "^1.0.0",
			"@koishi-ce/plugin-bind": "^1.0.0",
			"@koishi-ce/plugin-commands": "^1.0.0",
			"@koishi-ce/plugin-config": "^1.0.0",
			"@koishi-ce/plugin-console": "^1.0.0",
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
			"@koishi-ce/plugin-sandbox": "^1.0.0",
			"@koishi-ce/plugin-server": "^1.0.0",
			"@koishi-ce/plugin-status": "^1.0.0",
			// 上游裸名占位：npm alias 钉到 @koishi-ce 的 koishi shim（勿删，
			// 语义见文件头注释）；版本必须保持 4.18.x 冻结线以满足 ^4 peer
			koishi: "npm:@koishi-ce/koishi-shim@^4.18.11",
			// 上游 console 名占位：CE 插件的 peer 声明上游名，无归属时 Bun
			// 会自动装下 npm 官方 console 全家桶形成双实例；版本冻结 5.30.x
			"@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11",
			// 上游 core 名占位：@koishi-ce/loader 的 peer 精确锁 4.18.11，
			// alias 须逐字相等（不带 ^），版本冻结勿 bump。core 与 loader
			// 两个名字共用 koishi-shim：@koishi-ce/koishi 是 core + loader
			// 的合并再导出（与上游 koishi 主包同构），named 导出全覆盖
			"@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11",
			// 上游 loader 名占位：config / hmr 插件的 peer；同样指向
			// koishi-shim（4.18.11 满足 ^4.6.11），勿指回已废弃的 loader-shim
			"@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11",
		},
		devDependencies: {
			"@koishi-ce/client": "^1.0.0",
			"@koishi-ce/plugin-hmr": "^1.0.0",
			"@koishi-ce/scripts": "^1.0.0",
			"bun-types": "^1.4.0",
			"cross-env": "^7.0.3",
		},
	};
}
