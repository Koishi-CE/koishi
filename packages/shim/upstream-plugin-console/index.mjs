/**
 * 上游包名 `@koishijs/plugin-console` 的兼容 shim（纯 JS 预编译，不走
 * 根 tsdown 构建）。
 *
 * 本仓库 webui 插件的 peerDependencies 刻意声明上游名
 * `@koishijs/plugin-console ^5.30.11`（见 AGENTS.md 硬性约束）。没有本
 * shim 时，下游实例与仓库根的 bun install 会因该 peer 无归属而自动装
 * 下 npm 官方 @koishijs/plugin-console（连带 @koishijs/console、
 * @koishijs/core 等全家桶），与 @koishi-ce/plugin-console 形成两份
 * console 实例；本 shim 让这个名字有唯一归属：
 *
 * - 根 package.json 声明 `"@koishijs/plugin-console": "workspace:*"`，
 *   Bun 的 peer 自动安装发现该名已被满足，不再拉入官方包；
 * - 社区插件运行时 `require("@koishijs/plugin-console")` 解析到本 shim，
 *   re-export 的正是 @koishi-ce/plugin-console，模块实例全局唯一。
 *
 * 版本号刻意为 5.30.11（与上游 webui 5.30.x 冻结线对齐），用于满足
 * `^5.30.11` 形态的 peer 范围；勿改为本仓 1.x 基线版本。
 */
export * from "@koishi-ce/plugin-console";
export { default } from "@koishi-ce/plugin-console";
