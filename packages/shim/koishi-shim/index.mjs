// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 上游包名 `koishi` / `@koishijs/core` / `@koishijs/loader` 三名共用的
 * 下游兼容 shim（纯 JS 预编译，不走根 tsdown 构建）。
 *
 * 本仓框架包名是 `@koishi-ce/koishi`，而社区插件（含上游官方 adapter /
 * database 插件与 koishi-plugin-* 生态）与部分本仓包的 peerDependencies
 * 指向上游名。下游项目若不占住这些名字，市场运行时安装会因 peer 无归属
 * 而自动装下 npm 官方全家桶，形成第二份框架副本，破坏 cordis 对象身份。
 *
 * workspace 内由 `packages/shim/` 下的 private 占位包解决（koishi 裸名 /
 * upstream-core / upstream-loader，根依赖 workspace:* 声明归属）；下游
 * 非 workspace 项目无法使用 workspace shim，改为在 package.json 里声明
 * npm alias（create-koishi-ce 模板已预置，四行 alias 只涉及本包与
 * console-shim 两个包）：
 *
 *   "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11"
 *   "@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11"   // 精确锁：@koishi-ce/loader 的 peer 逐字相等
 *   "@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11"
 *
 * 三名可共用本包的原因：`@koishi-ce/koishi` 是 core + loader 两包的合并
 * 再导出（与上游 koishi 主包入口同构），对三个名字的上游消费者而言
 * named 导出全覆盖（`Loader` / `Context` / `Session` / `Schema` / `h` /
 * `z` 等），且经同一 re-export 源保证模块实例全局唯一。
 *
 * 包管理器与市场 UI 判定 peer 是否满足时看的是 alias 落盘包的 version：
 * - `koishi ^4.18.11` 与 `@koishijs/loader ^4.6.11` 均被 4.18.11 满足；
 * - `@koishijs/core` 的 peer 形态是精确版本 `4.18.11`（@koishi-ce/loader
 *   声明），故该行的 alias 必须钉死不带 `^` 的 4.18.11——本包版本号因此
 *   刻意冻结 4.18.11（上游 cordis 3.x 冻结线），勿改为本仓 1.x 基线、
 *   勿随 changesets bump——要动只跟随上游 4.18.x 线，且任何新版本都不
 *   会破坏精确钉住 4.18.11 的 @koishijs/core alias。
 *
 * 已知缺口（刻意接受）：`import NodeLoader from "@koishijs/loader"` 形态
 * 的 default 导出经本 shim 不可达（ESM `export *` 不传播 default）；上游
 * 插件生态无此用法（loader 是宿主概念，插件不消费其 default），需要
 * default 的本仓代码一律直接 `import ... from "@koishi-ce/loader"`。
 */
export * from "@koishi-ce/koishi";
