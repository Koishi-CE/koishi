/**
 * @file 安装类 console listener(install 域)。
 *
 * 模块职责:
 * - market/install:通用安装/卸载 RPC 的服务端,安装成功后补建插件配置
 *   并刷新固定通道集;
 * - market/install-bundle:合包安装,直接转交 market/bundle.ts 的编排;
 * - 其余为查询/准备类转发:安装回退候选、安装历史与日志明细、本地绑定准备。
 *
 * 关键设计:
 * - market/install 的 beforeReload 回调只包含"非本插件自身"的目标:
 *   本插件(marketn-refactored)升级会触发 reload,不能在自己的回调里
 *   给自己补配置;
 * - 安装失败(code 非 0)不补配置,但通道照刷:前端需要看到失败后的
 *   依赖现状。
 *
 * 架构位置:node 适配层 console/listeners,由 listeners/index.ts 聚合注册。
 */
import type { Context } from "@koishi-ce/koishi";
import { ensurePluginConfigs } from "../../config/plugin-configs.js";
import { SELF_PACKAGE } from "../../installer/index.js";
import { installBundle } from "../../market/bundle.js";
import type { MarketDataStore } from "../../market/data-store.js";
import { assertContract } from "../contracts.js";
import { INSTALL_REFRESH_CHANNELS } from "../refresh.js";
import { refreshConsole, registerContractListener } from "./helpers.js";

/** 安装类 listener：market/install 主流程、套装安装与安装历史/回退端点查询。 */
export function registerInstallListeners(ctx: Context, dataStore: MarketDataStore) {
    ctx.console.addListener(
        "market/install",
        async (deps, forced, options) => {
            assertContract("market/install", deps, forced, options);
            options ||= {};
            const installNames = Object.entries(deps)
                // 版本为 null 的条目是卸载,不需要补配置;本插件自身也排除
                // (自己升级会 reload,回调里给自己写配置会踩到旧 scope)
                .filter(([, version]) => version)
                .map(([name]) => name)
                .filter((name) => name !== SELF_PACKAGE);
            const code = await ctx.installer.install(
                deps,
                forced,
                installNames.length ? () => ensurePluginConfigs(ctx, installNames) : undefined,
                options,
            );
            if (!code) {
                await ensurePluginConfigs(ctx, installNames);
            }
            await refreshConsole(ctx, INSTALL_REFRESH_CHANNELS);
            return code;
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/install-bundle",
        async (request, forced, options) => {
            assertContract("market/install-bundle", request, forced, options);
            options ||= {};
            return installBundle(ctx, dataStore, request, forced, options);
        },
        { authority: 4 },
    );

    registerContractListener(ctx, "market/install-fallback-candidate", (failedEndpoint) =>
        ctx.installer.getInstallFallbackCandidate(failedEndpoint),
    );
    registerContractListener(ctx, "market/install-history", (limit) =>
        ctx.installer.getInstallHistory(limit),
    );
    registerContractListener(ctx, "market/install-history-detail", (id) =>
        ctx.installer.getInstallLogDetail(id),
    );
    registerContractListener(ctx, "market/prepare-local-binding", (name) =>
        ctx.installer.prepareLocalBinding(name),
    );
}
