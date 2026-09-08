# @koishi-ce/scripts

## 1.2.1

### Patch Changes

- da5e8c0: 修复 `koishi-scripts build` 在宿主根 `packageManager` 钉 `bun@x` 时被 corepack 的 yarn/pnpm shim 拒绝执行（Unsupported package manager specification）的问题：external/ 子项目构建统一改用 `bun run build`（各项目自带 node_modules、build 脚本为纯净执行器，无需包管理器安装能力）。

## 1.2.0

### Minor Changes

- f35562c: 新增 `koishi-scripts update` 安全更新命令，模板接线为 `bun run update`：
  
  - 裸 `bun update` 是全树更新语义，会连带给市场安装的第三方插件与全部传递依赖重新求解，任一上游漂移都可能破坏运行时；下游项目实际需要跟随的只有 @koishi-ce/* 生态位。
  - update 命令以 @koishi-ce/* 为白名单显式执行 `bun update <pkg...>`，四行 npm alias 冻结线、市场安装的 koishi-plugin-* 与 bun-types 一律不碰。
  - 内置模板 scripts 挂载 `"update": "koishi-scripts update"`，模板 README 新增「更新依赖」小节并警示勿用裸 `bun update`。

## 1.1.0

### Minor Changes

- d1329eb: feat(create,scripts): 模板文本外置为真实文件，默认模板对齐官方实例预写策略，全面 Bun 化
  
  - **create-koishi-ce**：内嵌字符串模板全部迁移到 `src/template/` 真实文件（点文件存无点名、写入时映射），lib 产物与 src 直跑两种形态按相对路径定位；生成项目 package.json 新增 `packageManager: bun@<创建时版本>`；dev 脚本改 `NODE_ENV=development koishi start` 前缀写法（bun run 走 Bun Shell 跨平台，**移除 cross-env 依赖**）；koishi.yml 对齐官方实例——CE 控制台 / 基础插件全量预装（依赖数据库的 `~` 禁用），adapter / database 官方插件以 `~` 禁用条目**只预写不预装**（loader 跳过禁用条目，市场装后启用）；依赖表补入本次新增的五个再分发插件
  - **@koishi-ce/scripts**：setup 脚手架模板同样外置到 `src/template/`（shared / single / monorepo 三层 + `@@TOKEN@@` 占位渲染；biome 载荷以 `.tpl` 后缀存名防被识别为嵌套根配置）；脚手架全部 yarn 命令迁到 bun（根级批量构建走 `bun run --filter`），打印的后续步骤同步
