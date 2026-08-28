/**
 * @file RegistryClient 的构造注入面(core/registry/client 域)。
 *
 * 从 registry-client.ts 拆出的构造注入接口:HTTP 工厂、路由统计本与
 * 持久化文件、竞速失效域、状态通道等宿主能力全部从这里注入,
 * core 层不直接依赖网络栈与运行时。
 */
import type { RegistryStatus } from "../../../shared/types.js";
import type { RequestScope } from "../../racing/request-scope.js";
import type { RouteStatsBook } from "../../racing/stats.js";
import type { JsonStore } from "../../utils/json-store.js";
import type { RegistryStatsStore } from "../cache/stats-file.js";
import type { RegistryHttpClient } from "./route-fetch.js";

/** RegistryClient 的构造注入面:HTTP 工厂、统计本、快照文件与状态通道。 */
export interface RegistryClientDeps {
    /** 按 endpoint 构造 HTTP 客户端(node 层注入,core 不依赖网络栈) */
    httpFactory: (endpoint: string) => RegistryHttpClient;
    /** 判定异常是否 HTTP 类(错误归因用) */
    isHttpError: (error: unknown) => boolean;
    /** 路由学习统计本 */
    stats: RouteStatsBook;
    /** 路由统计持久化文件(防抖写) */
    statsFile: JsonStore<RegistryStatsStore>;
    /** 竞速失效域 */
    scope: RequestScope;
    /** 配置未指定端点时的默认值来源(如宿主 npm 配置探测) */
    defaultEndpoint: () => Promise<string>;
    /** 包级状态上报(loading/错误/端点/次数,带 serial) */
    statusSink: (name: string, status: Partial<RegistryStatus>, serial: number) => void;
    log: {
        debug(message: string): void;
        info(message: string): void;
        warn(message: string): void;
    };
}
