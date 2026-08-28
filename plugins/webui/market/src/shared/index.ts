/**
 * src/shared 的统一出口（package.json 的 `./shared` 入口指向这里）。
 *
 * 职责：把共享语言层的子模块 re-export 给 node 端与 client 端消费——
 * node 侧（src/node、src/core）经包名引入，Vue 前端（client/）在 dev 下直接
 * 相对路径引 src/shared 源文件，两端引用同一份类型与纯函数，
 * 保证对协议结构、判定算法的理解严格一致。
 *
 * 注意：新增子模块时必须在此补一行 `export *`，否则不会进入共享出口
 * （bundle-idents.ts 曾因漏列而掉出 `./shared` 出口，P6 契约核对时已补回）；
 * 子模块之间应保持互相独立（除类型引用外），避免出口层出现循环依赖。
 */
export * from "./bundle.js";
export * from "./bundle-idents.js";
export * from "./dependency-source.js";
export * from "./lookup.js";
export * from "./provider.js";
export * from "./types.js";
export * from "./update.js";
