/**
 * Installer 的 registry 状态管理 mixin：维护 registryStatus 通道的值、
 * 触发 200ms 节流广播、增量收集（drainRegistryStatus）与整体清空，
 * 供 core 的 owner 回调（setRegistryStatus / clearRegistryStatus /
 * isPackageLoaded / drainRegistryStatus）单点消费。
 *
 * 宿主面（由 installer/index.ts 的 Installer 类在构造器赋值）：
 * - scope：registry 请求失效域，setRegistryStatus 按 serial 判过期；
 * - flushRegistryStatus：节流广播句柄（createInstallerCore 构造）；
 * - require：以宿主 package.json 为基准创建的 require（isPackageLoaded 探测）。
 *
 * 架构位置：node 适配层 installer 模块；Installer 类的 mixin 之一。
 */
import type { Context, Dict } from "@koishi-ce/koishi";
import type { RequestScope } from "../../core/racing/request-scope.js";
import type { RegistryStatus } from "../../shared/types.js";

/** mixin 基类约束：任意构造函数（Service 天然满足）。 */
// biome-ignore lint/suspicious/noExplicitAny: TS mixin 要求基类构造器参数为 any[]
type GConstructor = abstract new (...args: any[]) => object;

export function RegistryStatusMixin<T extends GConstructor>(Base: T) {
    abstract class RegistryStatusImpl extends Base {
        /** koishi 上下文（基类 Service 提供；此处声明供类型推导使用）。 */
        public declare ctx: Context;

        /** registry 状态表（registryStatus 通道的值）：包名 → 最新状态。 */
        public registryStatus: Dict<RegistryStatus> = {};

        /** @internal 待广播的 registry 状态增量：由 drainRegistryStatus 取走并经节流广播清空。 */
        public tempRegistryStatus: Dict<RegistryStatus> = {};

        /** @internal registry 请求失效域：setRegistryStatus 按 serial 判过期。 */
        public declare scope: RequestScope;

        /** @internal registryStatus 节流广播句柄（200ms，wire.ts 中构造）。 */
        public declare flushRegistryStatus: () => void;

        /** @internal 以宿主 package.json 为基准创建的 require：供 isPackageLoaded 探测 require.cache。 */
        public declare require: NodeRequire;

        setRegistryStatus(name: string, status: Partial<RegistryStatus>, serial: number) {
            if (this.scope.isStale(serial)) return;
            const value: RegistryStatus = {
                ...this.registryStatus[name],
                ...status,
                updatedAt: Date.now(),
            };
            this.registryStatus[name] = this.tempRegistryStatus[name] = value;
            this.flushRegistryStatus();
        }

        clearRegistryStatus() {
            this.registryStatus = {};
            this.tempRegistryStatus = {};
            void this.ctx.get("console")?.broadcast("market/registry-status/clear", {});
        }

        drainRegistryStatus(): Dict<RegistryStatus> {
            const status = this.tempRegistryStatus;
            this.tempRegistryStatus = {};
            return status;
        }

        isPackageLoaded(name: string) {
            try {
                return this.require.resolve(name) in this.require.cache;
            } catch {
                return true;
            }
        }
    }
    return RegistryStatusImpl;
}
