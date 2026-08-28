/**
 * Installer 的安装日志 mixin：历史列表与详情读取方法内聚在这里，
 * 转发给 core 的安装日志读取器，并维护"历史与详情共享活动日志状态"
 * 的读取依赖组装。
 *
 * 宿主面（由 installer/index.ts 的 Installer 类在构造器赋值）：
 * - log：统一日志（InstallLogger 协议适配 koishi logger）；
 * - logs：活动安装会话日志存储；
 * - retention：安装日志过期清理。
 *
 * 架构位置：node 适配层 installer 模块；Installer 类的 mixin 之一。
 */
import type { Context } from "@koishi-ce/koishi";
import {
	getInstallHistory,
	getInstallLogDetail,
} from "../../core/install/logs/reader.js";
import type { InstallLogRetention } from "../../core/install/logs/retention.js";
import type { InstallLogStore } from "../../core/install/logs/store.js";
import type { InstallLogger } from "../../core/install/types.js";

/** mixin 基类约束：任意构造函数（Service 天然满足）。 */
// biome-ignore lint/suspicious/noExplicitAny: TS mixin 要求基类构造器参数为 any[]
type GConstructor = abstract new (...args: any[]) => object;

export function LogsMixin<T extends GConstructor>(Base: T) {
	abstract class LogsImpl extends Base {
		/** koishi 上下文（基类 Service 提供；此处声明供类型推导使用）。 */
		public declare ctx: Context;

		/** @internal 统一日志：core 的 InstallLogger 协议适配 koishi logger。 */
		public declare log: InstallLogger;

		/** @internal 活动安装会话日志（写盘 + market/install-log 广播）。 */
		public declare logs: InstallLogStore;

		/** @internal 安装日志过期清理（保留时长来自配置）。 */
		public declare retention: InstallLogRetention;

		getInstallHistory(limit = 20) {
			return getInstallHistory(limit, this.getInstallLogReaderDeps());
		}

		getInstallLogDetail(id: string) {
			return getInstallLogDetail(id, this.getInstallLogReaderDeps());
		}

		/** 历史与详情必须共享活动日志状态，避免读取未完成的安装文件。 */
		getInstallLogReaderDeps() {
			return {
				cwd: this.ctx.baseDir,
				log: this.log,
				activeFile: () => this.logs.activeFile,
				waitForWrite: () => this.logs.waitForWrite(),
				cleanup: () =>
					this.retention.cleanup(
						this.logs.activeFile,
						this.logs.activeMetadataFile,
					),
			};
		}
	}
	return LogsImpl;
}
