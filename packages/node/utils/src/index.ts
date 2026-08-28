/**
 * `@koishi-ce/utils` 包入口：Koishi 的通用工具函数集合。
 *
 * 汇总再分发 cosmokit 的全部工具（`is` 另以 isType 别名导出）、
 * inaba 的 Random 随机数库，以及本包自带的杂项、观察器与字符串模块。
 * 该包不依赖 Koishi 运行时，可被任何 Node 侧包安全引用。
 */

import Random from "inaba";

export * from "cosmokit";
export { is as isType } from "cosmokit";
export * from "./misc";
export * from "./observe";
export * from "./string";
export { Random };
