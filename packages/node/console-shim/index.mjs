/**
 * 上游包名 `@koishijs/plugin-console` 的下游兼容 shim（纯 JS 预编译，
 * 不走根 tsdown 构建）。
 *
 * 下游（非 workspace）项目由 create-koishi-ce 生成，package.json 中以
 * npm alias 钉名：
 *
 *   "@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11"
 *
 * 机制与 koishi 裸名的 @koishi-ce/koishi-shim 相同：Bun 对 npm: alias
 * 的 peer 判定看**落盘包的 version**，故本包版本冻结 5.30.x 线（满足
 * `^5.30.11` 形态的 peer 范围），勿随 changesets bump。没有该 alias 时，
 * 安装任何声明 `@koishijs/plugin-console` peer 的包都会让 Bun 自动装下
 * npm 官方 console（连带 @koishijs/console / @koishijs/core 全家桶），
 * 与 @koishi-ce/plugin-console 形成双实例。
 */
export * from "@koishi-ce/plugin-console";
export { default } from "@koishi-ce/plugin-console";
