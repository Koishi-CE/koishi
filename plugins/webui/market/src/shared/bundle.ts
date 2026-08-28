/**
 * 插件捆绑包（plugin bundle / 合包）共享模块的聚合出口（package.json 的
 * `./shared` 入口经 index.ts `export * from "./bundle.js"` 由此转发）。
 *
 * 合包约定：一个 npm 包通过 package.json 里的 `koishi.bundle` 字段声明一组
 * 插件成员，并以关键字 `market:package` 与 `koishi-plugin-pa-*` 命名互相
 * 印证；安装时按成员逐项安装并把配置写入 koishi.yml 的 `group:pa-*` 分组
 * （分组标识派生见 bundle-idents.ts）。
 *
 * 本文件历史上同时承载类型与函数，因超出单文件行数目标拆分为两个子模块，
 * 此处按原路径原样转发全部导出（`export *`），保证 src/node 与 client/ 对
 * `shared/bundle` 的既有引用以及 `./shared` 出口的契约面完全不变：
 * - bundle-types.ts：清单/安装/移除各环节的类型定义与命名约定常量
 * - bundle-validate.ts：解析与校验纯函数族（parse/validate 系列）
 */
export * from "./bundle-types.js";
export * from "./bundle-validate.js";
