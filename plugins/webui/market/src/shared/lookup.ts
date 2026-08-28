import type { SearchObject } from "@koishi-ce/registry";
import type { Dict } from "@koishi-ce/koishi";

/** 从市场快照数据中收集实现了指定服务的插件名（client 与 node 的 market/lookup 共用）。 */
export function collectServiceProviders(
    data: Dict<SearchObject>,
    services: string[],
): Dict<string[]> {
    const result = Object.fromEntries(services.map((name) => [name, [] as string[]]));
    const requested = new Set(services);
    for (const object of Object.values(data)) {
        const implemented = object?.manifest?.service?.implements;
        if (!Array.isArray(implemented)) continue;
        for (const service of implemented) {
            if (requested.has(service)) result[service]!.push(object.package.name);
        }
    }
    for (const service of services) result[service]!.sort();
    return result;
}
