# 开发指南

> 面向在本仓库写代码的人（人类或 AI 会话）。核心原则：**设计先行、逻辑移植不发明、门禁全绿才合入**。

## 1. 环境要求

- **Node ≥ 20.19**（engines 声明；ESM 输出需 `require(esm)` 支持，宿主实际 Node 24.x）
- yarn（宿主是 yarn4 workspace，本插件已 symlink 到宿主 `node_modules/`）
- 仓库根 `yarn install` 后即可工作；工具链（tsdown/vite8/vitest4/biome2/eslint10/tsgo typescript7）全部在 devDependencies

## 2. 常用命令

```bash
yarn check            # 全量门禁（biome + tsc×2 + eslint + check-size，提交前必跑）
yarn check:size       # 只跑行数预算 + 依赖方向守卫
yarn build            # generate-node-locales → tsdown → lib/{node,shared} + build-client.ts → dist/
yarn build:client     # 只构建前端（scripts/build-client.ts，node 直跑 TS）
yarn test             # generate-node-locales → vitest run（src/**/*.test.ts 与 client/**/*.test.ts）
yarn lint:client      # eslint client/**/*.vue
```

`yarn check` 内部顺序：`generate-node-locales` → `check-i18n` → `biome check .` → `ts7 --noEmit`×2（src + client）→ `eslint client/**/*.vue` → `check-size`。全绿（exit 0）才算过门禁。

## 3. 质量门禁详解

### 3.1 biome（管 `src/` 的 ts/json）

- 格式：4 空格缩进、行宽 100、双引号、尾逗号
- 命名约定（`useNamingConvention` error）：类型 PascalCase、成员 camelCase/snake_case/PascalCase、对象字面量成员允许 CONSTANT_CASE
- `noFloatingPromises` error、`noNonNullAssertion` 放开
- `vcs.useIgnoreFile: true`——被 .gitignore 忽略的（如 `参考/`、`原版参考/`）不检查
- `src/core/registry/manifest.ts` 单独关闭命名约定（收敛 CJS 静态访问）

### 3.2 tsc（两套 tsconfig）

- 根 tsconfig 管 `src/`：target ES2025、module NodeNext、noEmit
- `client/tsconfig.json` 管 client（P4 起生效）

> **注意：`.vue` 文件不进 tsc 编译单元**——`import type {}` 写在 .vue 里对 `tsc -p client/tsconfig.json` 完全无效。类型加载必须放 .ts 文件；`.vue` 的 import 路径只有 vite build（`yarn build:client`）才验证，改完 .vue 的 import 必须跑一次。

### 3.3 eslint + vue-eslint-parser（管 `client/*.vue`）

- `ignorePatterns` 含 `^el-`/`^router-`（宿主全局组件）；父子共享状态的 prop mutation 单文件豁免。

### 3.4 check-size.ts（行数预算 + 依赖方向，不可回退）

扫描 `src/` 与 `client/`（跳过 node_modules 与 `__tests__`）：

**行数预算**：

| 口径 | 阈值 | 后果 |
|---|---|---|
| .ts/.mjs | 总行数 | — |
| .vue | `<template>` + `<script>` 合并（`<style>` 出仓 .scss 不计） | — |
| 任何文件 | > 250 行 | 警告（需拆分或说明理由） |
| 任何文件 | ≥ 350 行 | **直接 fail** |

目标区间是每文件 ≤200 行；>250 属"单一职责的内聚状态机"可解释范围（当前 5 个 client 侧：use-card-view 324 / use-bundle-install 369 / use-install 346 / use-filter 337 / avatars 306，src 侧 6 个：orchestrator / cache-store / source / bundle / installer.service / listeners），P6 收尾评估是否再拆。

**依赖方向**：`src/core/**` 逐行检查——`from 'koishi'` 与 `from '@koishijs/*'`（`@koishijs/registry` 例外）只允许出现在 `import type` / `export type {` 行，运行时 import 一律 error。

## 4. 编码约定（tsconfig 强制级）

以下不是风格建议，是编译不过的硬约束：

1. **`erasableSyntaxOnly`**：禁参数属性——不能写 `constructor(private x: T)`，必须显式字段 + 赋值。
2. **`noUncheckedIndexedAccess`**：`Dict<string>[key]` 返回 `string | undefined`；`hasOwn` 检查之后用 `!` 收窄。
3. **`exactOptionalPropertyTypes`**：可选属性赋值不能带 `undefined`（用 `?? null` 或类型上加 `| undefined`）。
4. **`verbatimModuleSyntax`**：类型导入必须 `import type`；重导出类型必须 `export type {`。
5. **`noUnusedLocals` / `noUnusedParameters` / `noImplicitReturns` / `noFallthroughCasesInSwitch`** 全开。
6. 项目风格：`satisfies` 优先、无 default export（Koishi `apply` 入口插件除外）、biome 自动 organizeImports。

## 5. 分层写作规则

| 你在写… | 允许 | 禁止 |
|---|---|---|
| `src/core/` | `import type { Dict } from "koishi"`；`@koishijs/registry`；node 内置；第三方（execa/semver/tar/p-map 等） | koishi 运行时（Context/Service/Logger/HTTP/Time/Schema）；`@koishijs/*`（registry 除外）；直接读写 koishi 状态 |
| `src/shared/` | 纯类型与纯函数 | 任何 I/O（provider.ts 的 DataService 基类除外） |
| `src/node/`（P3） | 组装 core、注入 deps、Koishi API 全可用 | 业务逻辑（一律下沉 core） |
| `client/`（P4） | `<script setup lang="ts">`；样式出仓同目录 .scss | 超大单文件（预算见 §3.4） |

**core 的 I/O 模式**：构造函数收 `deps` 对象，字段是函数或接口（如 `httpFactory`、`broadcast`、`isActive`、`notifyRefresh`）。参考 [CORE-MODULES.md](CORE-MODULES.md) 各模块的 deps 签名。

## 6. 已知坑（历史经验，别再踩）

1. **execa v10 无默认导出**：旧代码 `import spawn from 'execa'` 是老 API；用 `execa(name, args, { cwd, reject: false })`，exit code 从 `result.exitCode` 取。
2. **`package-manager-detector` 的 `detect()` 返回 Promise**：必须 `await` 后把 `{ name, version }` 注入 runner（旧代码漏 await 导致永远退回 npm，已修复，组装时别回退）。
3. **ESM 无 `__dirname`**：tsdown shims 默认关闭；用 `import.meta.url` + `fileURLToPath`。
4. **宿主 `exports.development` 不生效**：宿主 dev 脚本无 `--conditions development`，loader 永远解析 `lib/node/index.cjs`——**一切宿主验证以先 `yarn build` 产出 lib/ 为前提**。
5. **`install/logs/store.ts` 的 ANSI 清洗正则**带 `biome-ignore lint/suspicious/noControlCharactersInRegex` 注释，别删注释。
6. **client prod 构建只探测 `style.css`**：`scripts/build-client.ts`（对齐 `@koishijs/client` 官方 `build()` 的编程式构建）保证 CSS 产物名固定为 `style.css`（`cssFileName` + `index.css` 改名兜底 + 产物校验），改动构建配置时必须保住这一点。
7. **`.vue` 不进 tsc 编译单元**（见 §3.2）：`.vue` 的 import 路径只有 vite build 才验证，改完必须跑 `yarn build:client`。
8. **`store.X` 类型推导链**：`store.X` 的类型 = `Console.Services[X] extends DataService<infer T> ? T : never`。Services 声明合并来源：本插件 `lib/node/index.d.ts`（dependencies/registry/registryStatus/marketData）+ `src/shared/provider.ts`（market）+ 宿主 `@koishijs/plugin-config`。**client 的 `import type ... from 'koishi-plugin-marketn-refactored'` 依赖 lib/ 已构建**——全量验证前先 `yarn build`（或 tsdown）。
9. **`vue-compat.d.ts` 必须是模块**（含 `export {}`）：放在全局脚本（如 env.d.ts）里的 `declare module 'vue'` 是环境模块声明，会整体遮蔽真实 vue 类型（报 "Module 'vue' has no exported member 'ref'"）。
10. **typescript 锁 `~6.0.3`（ts7 脚本）**：升回 7.x 会让 @typescript-eslint/parser 在 require 时直接 throw（`yarn check` 挂）。升级需等 typescript-eslint 支持 TS ≥7.1。
11. **vue 锁宿主 3.5.41**：其 `shallowReactive` 品牌类型靠 `client/vue-compat.d.ts` 垫片兼容；宿主 vue 升级或 @koishijs/client 适配后可删。
12. **Biome 格式化 JSON 的行尾不可见字符**是已知无害现象：看到即跳过，不要调查成因、不要试图修复。

## 7. 阶段工作流

1. 开工前以 `src/` 与 `client/` 实际代码为准了解现状（旧逻辑对照 `参考/` 与 `原版参考/`），不依赖已删除的历史阶段文档。
2. 设计变更时**先明确设计要点再改代码**（设计先行）。
3. 每完成一个模块跑一次门禁（`yarn check`）；门禁全绿才合入。
4. 移植逻辑时源头是 `参考/` 与 `原版参考/`（勿改），契约验收基线是 [reference/前后端调用契约.md](reference/前后端调用契约.md)。

## 8. fallow 静态分析（可选工具）

Rust 版 TS 静态分析工具（devDependency），用于死代码/重复/复杂度体检：

| 命令 | 用途 | 退出码 |
|---|---|---|
| `yarn fallow dead-code` | 死代码 + 循环依赖 + 未声明依赖 | 1=有发现（正常），2=真错误 |
| `yarn fallow dead-code --format compact` | 简洁清单（对比用） | 同上 |
| `yarn fallow dead-code --format json` | JSON 留底 | 同上 |
| `yarn fallow dupes` | 重复代码块 | 同上 |
| `yarn fallow health --score` | 复杂度评分 | 同上 |

配置 `.fallowrc.jsonc`（ignorePatterns 忽略 `参考/`、`原版参考/`、`lib/`、`dist/`；entry 声明 `client/index.ts`）。基线报告缓存在 `.fallow/*.json`（自忽略）。

**误报豁免清单（fallow 不认识 koishi 生态，以下不要当死代码删）**：

- **DataService 框架回调**：`src/node/providers.ts` 等 `override async get()`——Koishi Console 在 refresh 时反射调用。
- **多态可选方法**：如 `probeInBackground`——经 `ctx.console.services.market?.probeInBackground?.()` 可选链调用。
- **命名遮蔽**：node 层 `MarketProvider` 继承并遮蔽 shared 同名基类——有意的插件模式。
- **Pick 接口分发**：`MarketDiskCache.conditionalHeaders`——经 `Pick<...>` 分发后被消费，已用行内 `// fallow-ignore-next-line` 豁免。
- **dev_dependencies_in_production**（vue/@koishijs/client/@vueuse/core 放 devDeps）——koishi 生态惯例：运行时由宿主 console 提供，vite external，对齐官方插件。
