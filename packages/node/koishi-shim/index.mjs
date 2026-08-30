/**
 * 上游包名 `koishi` 的下游兼容 shim（纯 JS 预编译，不走根 tsdown 构建）。
 *
 * 本仓框架包名是 `@koishi-ce/koishi`，而社区插件（含上游官方 adapter /
 * database 插件与 koishi-plugin-* 生态）的 peerDependencies 指向上游名
 * `koishi`。下游项目若不占住这个名字，市场运行时安装会因 peer 无归属而
 * 自动装下 npm 官方 koishi，形成第二份框架副本，破坏 cordis 对象身份。
 *
 * workspace 内由 `packages/node/koishi`（裸名 shim，根依赖 workspace:*
 * 声明归属）解决；下游非 workspace 项目无法使用 workspace shim，改为在
 * package.json 里声明 npm alias：
 *
 *   "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11"
 *
 * 包管理器与市场 UI 判定 peer `koishi ^4.x` 是否满足时看的是 alias 落盘
 * 包的 version，因此本包版本号刻意为 4.18.11（上游 cordis 3.x 冻结线），
 * 勿改为本仓 1.x 基线、勿随 changesets bump——要动只跟随上游 4.18.x 线。
 *
 * 本 shim 内部仅 re-export 依赖树中的 `@koishi-ce/koishi`：同一版本范围
 * 会被提升去重，模块实例全局唯一，与 workspace shim 的机制同构。
 */
export * from "@koishi-ce/koishi";
