/**
 * @file market/lookup RPC 的服务端:按名称/服务在市场快照里查插件。
 *
 * 模块职责:对 market 快照(provider.getSnapshot)做过滤式查询,返回命中的
 * 插件数据与"服务 -> 提供者列表"映射,供前端服务市场页等轻量查询使用
 * (不必拉全量快照)。
 *
 * 关键设计:请求参数先归一化(去重/trim/长度上限/条数上限),防御超大或
 * 脏输入;快照不存在时返回空结果而非报错。
 *
 * 架构位置:node 适配层 console 模块,由 listeners/market.ts 注册为
 * market/lookup listener;服务归类逻辑在 shared/lookup.ts 纯函数。
 */
import { collectServiceProviders } from "../../shared/lookup.js";
import type { MarketLookupRequest, MarketLookupResult, MarketPayload } from "../../shared/types.js";
import type { MarketProvider } from "../market/index.js";

/**
 * 归一化请求值数组:只留非空字符串(trim)、长度 <= 214(npm 包名上限)、
 * 去重后截断到 limit(names 512 / services 128)。
 */
function normalizeMarketLookupValues(values: unknown, limit: number) {
    if (!Array.isArray(values)) return [];
    return Array.from(
        new Set(
            values
                .filter((value): value is string => typeof value === "string")
                .map((value) => value.trim())
                .filter((value) => value && value.length <= 214),
        ),
    ).slice(0, limit);
}

/** 归一化后的查询词:names 与 services 各自去重截断后的集合。 */
interface NormalizedLookupQuery {
    names: string[];
    services: string[];
}

/** 归一化整份请求:非对象请求按空请求处理,names/services 分别限额。 */
function normalizeLookupQuery(request: MarketLookupRequest): NormalizedLookupQuery {
    const source: MarketLookupRequest = request && typeof request === "object" ? request : {};
    return {
        names: normalizeMarketLookupValues(source.names, 512),
        services: normalizeMarketLookupValues(source.services, 128),
    };
}

/** 按查询词构造空结果:services 预置为全空提供者列表。 */
function createLookupResult(query: NormalizedLookupQuery): MarketLookupResult {
    return {
        data: {},
        services: Object.fromEntries(query.services.map((name) => [name, []])),
    };
}

/** 用快照数据填充结果:命中名称拷进 data,服务归类交给 shared 纯函数。 */
function fillResultFromSnapshot(
    result: MarketLookupResult,
    data: NonNullable<MarketPayload["data"]>,
    query: NormalizedLookupQuery,
) {
    for (const name of query.names) {
        if (data[name]) result.data[name] = data[name];
    }
    if (query.services.length) {
        result.services = collectServiceProviders(data, query.services);
    }
}

/** market/lookup：按名称/服务检索市场数据（provider 快照过滤）。 */
export async function lookupMarket(
    provider: MarketProvider | undefined,
    request: MarketLookupRequest = {},
): Promise<MarketLookupResult> {
    const query = normalizeLookupQuery(request);
    const result = createLookupResult(query);
    if (!provider || (!query.names.length && !query.services.length)) return result;

    const snapshot = await provider.getSnapshot();
    result.revision = snapshot?.revision;
    result.dataVersion = snapshot?.dataVersion;
    fillResultFromSnapshot(result, snapshot?.data ?? {}, query);
    return result;
}
