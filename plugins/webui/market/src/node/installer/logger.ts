/**
 * @file installer 的日志适配:koishi Logger -> core InstallLogger。
 *
 * 模块职责:
 * - createInstallLogger:把 koishi 的 Logger 实例收窄成 core 层约定的
 *   InstallLogger 接口(debug/info/warn/error 四级),使 core 类不感知
 *   koishi 运行时。
 *
 * 架构位置:node 适配层 installer 模块,由 installer/index.ts 的 Installer
 * 构造函数与 wire.ts 的组装逻辑消费。
 */
import type { Logger } from "@koishi-ce/koishi";
import type { InstallLogger } from "../../core/install/types.js";

/** koishi Logger -> core InstallLogger 的窄接口适配(core 不 import koishi)。 */
export function createInstallLogger(logger: Logger): InstallLogger {
    return {
        debug: (message) => logger.debug(message),
        info: (message) => logger.info(message),
        warn: (message) => logger.warn(message),
        error: (message) => logger.error(message),
    };
}
