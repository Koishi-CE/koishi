# create-koishi-ce

## 1.6.4

### Patch Changes

- e537fa2: fallow 审计收敛：断掉 core 最后一处循环依赖并收敛重复代码样板（1024 → 357 行）。
  
  - core：runtime.ts 的 `Service.setup` 经新增的 context 工厂槽（`context/factory.ts`）创建 root Context，消除 context/index.ts ↔ runtime.ts 模块环，公共 API 不变。
  - console（核心包）：新增 `clientEntry` 导出——插件向控制台注册前端产物的三环境路径样板（KOISHI_BASE 部署 / browser 构建 / 本地 dev-prod），各 webui 插件入口的三分支复制统一改为一行调用。
  - client：新增 `extendLocales`（插件前端入口的七语种词典批量注入，配合 `import.meta.glob` 收敛 import+extend 样板）与 `scrollActiveTree`（keep-alive 页面重激活时把 el-tree 激活节点滚到可视中央）。
  - loader：公共导出 `insertKey` / `rename`（键顺序保持式改名工具），config 插件 writer 复用之。
  - utils：新增 npm-registry 模块（`getLocalRegistry` / `readNpmrcRegistry` / `NPM_OFFICIAL_REGISTRY`），create-koishi-ce 与 market 的本机 registry 探测共享同一实现。
  - config：manager/* 事件签名收敛到 `src/shared/console-events.ts` 唯一定义（node 与浏览器两端声明合并经 extends 引用）；global/group 设置面板的 modelValue 代理改用 `defineModel`。
  - admin/sandbox/sqlite/check-docs-links：对称逻辑（用户组加入与移出、方向键历史回溯、`_all`/`_get` 读取原语、链接检查循环）就近抽取共享实现。
- Updated dependencies [e537fa2]
  - @koishi-ce/utils@1.1.0

## 1.6.3

### Patch Changes

- 978411f: 添加插件列表兼容嵌套 monorepo 工作区，扫描改为 workspaces 声明驱动：
  
  - 未启用插件的收录不再硬编码「external/ 一级」，以宿主 package.json 的 workspaces 通配为唯一真相源展开（正/负模式、清单文件锚点、win32 路径归一）——声明写多深，列表就能看多深，克隆到 external/ 的 monorepo 形态插件（packages/ 子包在二级及更深）无需平铺即可见可启用；声明缺失 / 非法时回退约定目录。
  - 顺带修复 plugins/ 一级目录下未启用自建包的可见性盲区（同受声明覆盖）。
  - 内置模板 workspaces 升级为 globstar + 负向排除写法：`["plugins/*", "external/**", "!external/**/node_modules/**"]`——Bun 原生支持完整 glob 语法，三行替代上游生态的多层枚举，node_modules 残留（跨包管理器搬迁）被排除在 workspace 成员之外。

## 1.6.2

### Patch Changes

- f35562c: 新增 `koishi-scripts update` 安全更新命令，模板接线为 `bun run update`：
  
  - 裸 `bun update` 是全树更新语义，会连带给市场安装的第三方插件与全部传递依赖重新求解，任一上游漂移都可能破坏运行时；下游项目实际需要跟随的只有 @koishi-ce/* 生态位。
  - update 命令以 @koishi-ce/* 为白名单显式执行 `bun update <pkg...>`，四行 npm alias 冻结线、市场安装的 koishi-plugin-* 与 bun-types 一律不碰。
  - 内置模板 scripts 挂载 `"update": "koishi-scripts update"`，模板 README 新增「更新依赖」小节并警示勿用裸 `bun update`。

## 1.6.1

### Patch Changes

- 33efc85: 内置模板依赖清单补上 @koishi-ce/plugin-welcome：欢迎页独立插件化时只在模板 koishi.yml 预写了条目，package.json 依赖漏装，新生成的项目开箱即报插件解析失败。另新增模板 koishi.yml 预写条目与依赖清单的对账测试，防止同类漏装再犯。

## 1.6.0

### Minor Changes

- d5f806f: 内置模板的 scripts 补齐插件开发全链入口：新增 `clone`（克隆插件仓库到 `external/`）、`build`（串行构建 `external/`）、`release:version` / `release:dryrun` / `release`（changeset 消费 → 构建 → npm 发布三环，均为 `koishi-scripts` 子命令）；模板 README 同步修正 `new` 的实际落点（`external/` 而非 `plugins/`）并补构建发布说明。
- f90fa0a: 默认模板预写启用新插件 @koishi-ce/plugin-welcome（控制台组），生成的项目开箱即有欢迎页开屏动画。

## 1.5.0

### Minor Changes

- 8101067: 内置模板补齐本仓工作区全部插件，并重排为配置页导出形态：插件键带 uid 实例后缀，分组带中文 `$label` / `$collapsed` 元数据。dependencies 新增 @koishi-ce/plugin-broadcast、@koishi-ce/plugin-callme、@koishi-ce/plugin-echo 与 @koishi-ce/plugin-database-sqlite，devDependencies 新增 @koishi-ce/plugin-mock；其中 sqlite 默认启用（数据落 data/koishi.db），开箱即得数据库；broadcast / callme 依赖数据库、mock 属开发用，均以 ~ 禁用预写。

## 1.4.0

### Minor Changes

- c2b990e: 内置模板补齐本仓工作区全部插件：dependencies 新增 @koishi-ce/plugin-broadcast、@koishi-ce/plugin-callme、@koishi-ce/plugin-echo（koishi.yml 预写进 group:basic，依赖数据库的前两者默认禁用）与 @koishi-ce/plugin-database-sqlite（预装，koishi.yml 保持 ~ 禁用，配置页启用即可当数据库用，无需市场安装）；devDependencies 新增 @koishi-ce/plugin-mock（group:develop 禁用预写）。

## 1.3.1

### Patch Changes

- 11aabfe: refactor(create): 交互层从 prompts 迁移到 @clack/prompts
  
  - 移除 `prompts` 与 `@types/prompts`（clack 自带 TS 类型，无需 `@types/*` 包）
  - 项目名输入与各类确认改用 `@clack/prompts` 的 `text` / `confirm`：Ctrl+C 优雅返回取消符号（不再抛 SIGINT 堆栈），项目名校验内联进 `validate`
  - 测试 mock 同步切换至 `@clack/prompts`（按 prompt 类型分发的可编程答案队列不变）
- 5b65d63: refactor(create): 移除 yargs-parser 与自研 tar 解析，命令行与模板解包改用社区包 / 标准工具
  
  - 命令行解析换用 `node:util` 的 `parseArgs`（Bun 内置同一 API），移除 `yargs-parser` 与 `@types/yargs-parser`；未知选项由静默忽略改为明确报错
  - 远程模板解包改用 `giget`（其解压实现内联打包 `tar`，零传递依赖）：tarball 先落本地缓存再解压到目标目录，按 npm tarball 惯例剥离顶层 `package/` 目录，自带路径穿越防护；不再维护自研 ustar / pax 解析
  - 原自研 tar 的打包侧（`tarPack`）保留为测试专用 fixture 构造器（`src/__tests__/tar-pack.ts`），随附数字字段与 pax 头兼容修复（对齐 node-tar 解析约定）；相应单测收敛到 run-remote 端到端用例

## 1.3.0

### Minor Changes

- d1329eb: feat(create,scripts): 模板文本外置为真实文件，默认模板对齐官方实例预写策略，全面 Bun 化
  
  - **create-koishi-ce**：内嵌字符串模板全部迁移到 `src/template/` 真实文件（点文件存无点名、写入时映射），lib 产物与 src 直跑两种形态按相对路径定位；生成项目 package.json 新增 `packageManager: bun@<创建时版本>`；dev 脚本改 `NODE_ENV=development koishi start` 前缀写法（bun run 走 Bun Shell 跨平台，**移除 cross-env 依赖**）；koishi.yml 对齐官方实例——CE 控制台 / 基础插件全量预装（依赖数据库的 `~` 禁用），adapter / database 官方插件以 `~` 禁用条目**只预写不预装**（loader 跳过禁用条目，市场装后启用）；依赖表补入本次新增的五个再分发插件
  - **@koishi-ce/scripts**：setup 脚手架模板同样外置到 `src/template/`（shared / single / monorepo 三层 + `@@TOKEN@@` 占位渲染；biome 载荷以 `.tpl` 后缀存名防被识别为嵌套根配置）；脚手架全部 yarn 命令迁到 bun（根级批量构建走 `bun run --filter`），打印的后续步骤同步

## 1.2.1

### Patch Changes

- 4298163: 模板的上游名 npm alias 收敛为两包四名：`@koishijs/core` 与 `@koishijs/loader` 两行 alias 改指 `@koishi-ce/koishi-shim`（`@koishi-ce/koishi` 是 core + loader 的合并再导出、与上游 koishi 主包同构，named 导出全覆盖），不再引用已废弃的 `@koishi-ce/core-shim` / `@koishi-ce/loader-shim`；模板 README 同步更新。shim 体系同步重组：workspace 占位与发布 shim 统一迁入 `packages/shim/`，`packages/node/` 恢复纯功能包职责。

## 1.2.0

### Minor Changes

- 6f77b35: 修复市场装完插件同进程解析失败（Bun 父目录快照缓存），并为 console / core / loader 三个上游 peer 名新增占位 shim
  
  根因实证：Bun 对失败的解析按「父目录快照」做进程内缓存——解析失败时只要包的直接父目录（node_modules 或 node_modules/@scope）已存在，该目录内容列表即被缓存，包落盘后同进程内该包任何形态、任何解析 API（createRequire.resolve / Bun.resolveSync）都永久失败（生产装完插件报 failed to resolve / cannot resolve plugin、重启即消的原因；开发环境因依赖已在 node_modules 而无法复现）。
  
  - registry：resolvePackageJson 改为全程纯 fs 探测（装前探测零解析 API 调用，消除污染源），isResidentInCache 下沉至本包供 config / market 共用；LocalScanner 跳过带 upstreamShim 标记的占位包
  - loader：resolvePlugin 对裸名候选在 Bun.resolveSync 失败后纯 fs 沿 node_modules 链定位包目录、按 manifest（bun→require→node→default 条件序）计算入口绝对路径——require 绝对路径不受快照影响，装完插件无需重启即可加载
  - config：parsePackage 驻留判断弃用裸名 require.resolve（负缓存假警源），改用 isResidentInCache
  - market：installer 改用下沉后的 isResidentInCache
  - create-koishi-ce 模板：新增三行 npm alias——@koishijs/plugin-console → @koishi-ce/console-shim@^5.30.11、@koishijs/core → @koishi-ce/core-shim@4.18.11（loader peer 精确锁，不带 ^）、@koishijs/loader → @koishi-ce/loader-shim@^4.6.11；无占位时 Bun 的 peer 自动安装会把 npm 官方 console / core / loader 全家桶拉进下游实例形成双实例
  
  注意：@koishi-ce/console-shim、@koishi-ce/core-shim、@koishi-ce/loader-shim 为新包（在 changesets ignore 中，版本冻结），发布须先于本版 create-koishi-ce，否则下游安装 alias 解析不到。

## 1.1.0

### Minor Changes

- 770d611: 修复 create-koishi-ce 生成全官方生态项目的根本缺陷：默认模板此前直接下载上游官方 @koishijs/boilerplate 解包，产物依赖全是 npm 官方包（koishi / @koishijs/*，559 包），完全绕开 @koishi-ce 再分发生态，且官方 market 在 Bun 下因 get-registry 依赖直接崩溃。默认模板改为内置的纯 @koishi-ce 依赖集（Bun 运行时、预配 registry.koishi.chat 市场镜像源、不预装本仓无再分发的 adapter / database，官方版可后续从市场安装）；--template 保留为远程模板逃生舱。配套新增 @koishi-ce/koishi-shim（版本冻结 4.18.x 线，不随 changesets 演进），模板以 npm alias "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11" 钉住上游裸名——上游官方插件与社区 koishi-plugin-* 的 peer `koishi ^4.x` 由此满足，市场安装不再拉入 npm 官方 koishi 形成第二份框架副本。plugin-market：安装清单护栏扩展，npm:@koishi-ce alias 声明与 workspace: 声明同等不可覆盖/删除。

## 1.0.1

### Patch Changes

- cab5689: 修复 `bunx create-koishi-ce` 在 Bun 运行时下 registry 探测崩溃（子进程退出码 1 导致脚手架中断）：既有实现按 user-agent 派生探测命令，bun 场景下执行不存在的 `bun config get registry` 后非 npm 分支直接 reject。现移除 `get-registry` 依赖，改为零子进程的原生探测——依次读环境变量 `npm_config_registry` → 项目 `.npmrc` → 用户 `~/.npmrc`，取首个合法 http(s) 地址，任何一步拿不到都静默回落官方源，探测路径不再可能打断主流程。
