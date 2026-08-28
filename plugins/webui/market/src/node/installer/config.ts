/**
 * @file installer(registry/安装)子配置的 Schema 与选项类型(installer 域)。
 *
 * 作为 config/index.ts 中 registry 字段的类型来源,同时被 wire.ts 读取以
 * 配置 RegistryClient/并发/超时等。字段说明见各 Schema description。
 */
import { Schema, Time } from "@koishi-ce/koishi";

/** getDeps 的选项透传类型:metadata = 等 latest 元数据,background = 是否后台刷新。 */
export interface InstallerGetDepsOptions {
    metadata?: boolean;
    background?: boolean;
}

/** registry/安装相关配置(koishi.yml 中本插件节点的 registry 子对象)。 */
export interface InstallerConfig {
    endpoint?: string;
    timeout?: number;
    autoRoute?: boolean;
    retry?: number;
    concurrency?: number;
    installLogRetentionHours?: number;
    /** @deprecated use installLogRetentionHours */
    installLogRetention?: number;
}

/** InstallerConfig 的 Koishi Schema:registry 端点/超时/重试/并发/日志保留。 */
export const InstallerConfig: Schema<InstallerConfig> = Schema.object({
    endpoint: Schema.string().role("link"),
    timeout: Schema.number()
        .role("time")
        .default(Time.second * 5),
    autoRoute: Schema.boolean().default(true),
    retry: Schema.number().min(0).max(5).step(1).default(1),
    concurrency: Schema.number().min(1).max(16).step(1).default(4),
    installLogRetentionHours: Schema.number()
        .min(1)
        .max(24 * 365)
        .step(1)
        .default(72),
});
