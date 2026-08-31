/**
 * 上游包名 `@koishijs/loader` 的下游兼容 shim（纯 JS 预编译，不走根
 * tsdown 构建）。
 *
 * 下游（非 workspace）项目由 create-koishi-ce 生成，package.json 中以
 * npm alias 钉名：
 *
 *   "@koishijs/loader": "npm:@koishi-ce/loader-shim@^4.6.11"
 *
 * 机制与 koishi 裸名的 @koishi-ce/koishi-shim 相同：Bun 对 npm: alias
 * 的 peer 判定看**落盘包的 version**，故本包版本冻结 4.6.x 线（满足
 * `^4.6.11` 形态的 peer 范围），勿随 changesets bump。没有该 alias 时，
 * @koishi-ce/plugin-config / plugin-hmr 的 peer 会让 Bun 自动装下 npm
 * 官方 @koishijs/loader，形成两份 loader 实现。
 */
export * from "@koishi-ce/loader";
export { default } from "@koishi-ce/loader";
