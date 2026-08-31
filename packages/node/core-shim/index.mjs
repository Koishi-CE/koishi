/**
 * 上游包名 `@koishijs/core` 的下游兼容 shim（纯 JS 预编译，不走根
 * tsdown 构建）。
 *
 * 下游（非 workspace）项目由 create-koishi-ce 生成，package.json 中以
 * npm alias 钉名：
 *
 *   "@koishijs/core": "npm:@koishi-ce/core-shim@4.18.11"
 *
 * 机制与 koishi 裸名的 @koishi-ce/koishi-shim 相同：Bun 对 npm: alias
 * 的 peer 判定看**落盘包的 version**，而 @koishi-ce/loader 的 peer 是
 * 精确版本 `4.18.11`（必须逐字相等），故本包版本冻结 4.18.11、alias
 * 声明不带 `^` 前缀，均勿随 changesets bump。没有该 alias 时，安装
 * @koishi-ce/loader 会让 Bun 自动装下 npm 官方 @koishijs/core 全家桶，
 * 形成第二份 koishi 核心副本。
 */
export * from "@koishi-ce/core";
