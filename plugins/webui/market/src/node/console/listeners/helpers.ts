/**
 * @file listener 注册辅助:统一"入参 zod 校验 + authority 4"的注册范式。
 *
 * 模块职责:registerContractListener / registerContractListeners 把 console
 * listener 的公共样板(先 assertContract 校验参数形状、再派发 handler、
 * 绑定管理员权限)收敛到一处,各 listener 文件只写业务逻辑。
 *
 * 关键设计:参数校验是安全边界——console RPC 来自前端,不可信,必须在
 * 进业务前用 contracts.ts 的 zod schema 验形;权限统一 authority 4。
 *
 * 架构位置:node 适配层 console/listeners 模块,被 install/market/upload
 * 三个 listener 文件消费。
 */
import type { Context } from "@koishi-ce/koishi";
import { assertContract, type ContractName } from "../contracts.js";

export { refreshConsole } from "../refresh.js";

/**
 * 注册单个 contract listener:入口先做 zod 校验,不合法直接抛错拒绝,
 * 合法则透传给 handler。全部 market/* RPC 统一 authority 4。
 */
export function registerContractListener(
    ctx: Context,
    name: ContractName,
    handler: (...args: never[]) => unknown,
) {
    ctx.console.addListener(
        name,
        async (...args: never[]) => {
            assertContract(name, ...args);
            return handler(...args) as never;
        },
        { authority: 4 },
    );
}

/** 批量注册无额外编排的转发 listener；复杂流程应继续使用显式注册。 */
export function registerContractListeners(
    ctx: Context,
    entries: Partial<Record<ContractName, (...args: never[]) => unknown>>,
) {
    for (const [name, handler] of Object.entries(entries)) {
        if (handler) registerContractListener(ctx, name as ContractName, handler);
    }
}
