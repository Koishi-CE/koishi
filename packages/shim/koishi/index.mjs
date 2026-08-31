/**
 * 上游包名 `koishi` 的兼容 shim（纯 JS 预编译，不走根 tsdown 构建）。
 *
 * 本仓框架包名是 `@koishi-ce/koishi`，而社区插件的 peerDependencies 指向
 * 上游名 `koishi`。没有本 shim 时，市场运行时安装（根目录 bun add）会因
 * peer 无归属而自动装下 npm 官方 koishi，形成第二份框架副本，破坏 cordis
 * 对象身份与 instanceof；本 shim 让 `koishi` 这个名字在本仓有唯一归属：
 *
 * - 根 package.json 声明 `"koishi": "workspace:*"`，Bun 的 peer 自动安装
 *   发现该名已被满足，不再拉入 npm 官方包；
 * - 社区插件运行时 `require("koishi")` 解析到本 shim，re-export 的正是
 *   @koishi-ce/koishi（core + loader 合并再分发，与上游 koishi 包入口
 *   等价），模块实例全局唯一。
 *
 * 版本号刻意为 4.18.11（上游 cordis 3.x 冻结线），用于满足社区插件
 * `koishi ^4.x` 形态的 peer 范围；勿改为本仓 1.x 基线版本。
 */
export * from "@koishi-ce/koishi";
