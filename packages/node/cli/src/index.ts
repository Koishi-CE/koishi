/**
 * `@koishi-ce/koishi` 包入口。
 *
 * 本文件专为不使用 CLI 的用户准备：将 core 与 loader 两包的导出合并再分发，
 * 并默认导出 NodeLoader 实现，使开发者可以直接以编程方式启动 Koishi。
 */

import Loader from "@koishi-ce/loader";

export * from "@koishi-ce/core";
export * from "@koishi-ce/loader";
export { Loader };
