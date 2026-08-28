import { vi } from "vitest";
import { ref } from "vue";

/**
 * @file client/shared 域测试共用的 @koishi-ce/client 桩工厂。
 *
 * vitest.config.ts 把 vue-i18n 与 @koishi-ce/components 都 alias 到
 * @koishi-ce/client,因此被测模块(含间接依赖)的宿主全部收口在这一个 mock 上。
 * 桩只覆盖 shared 域源码实际用到的运行时导出(store/send/receive/message/
 * socket/useI18n/valueMap),Dict/Context 等仅类型导入会被转译器擦除。
 * 注意 vi.mock 工厂是提升执行的,不能直接 import 本文件——工厂内用
 * `await import(...)` 动态引入规避提升限制。
 */

/** mock 函数的类型别名(与 vi.fn() 返回类型一致)。 */
type Mock = ReturnType<typeof vi.fn>;

/** @koishi-ce/client 桩形态:字段可变,测试按需覆写后直接生效。 */
export interface KoishiClientStub {
    store: Record<string, any>;
    send: Mock;
    receive: Mock;
    message: { error: Mock; warning: Mock; success: Mock };
    /** console socket 的 ref:必须是真 Vue ref,watch(socket) 才能识别并响应断连。 */
    socket: { value: any };
    useI18n: Mock;
    valueMap: (
        source: Record<string, any>,
        fn: (value: any, key: string) => any,
    ) => Record<string, any>;
}

/** 创建一份干净的 @koishi-ce/client 桩(与官方 valueMap 语义一致)。 */
export function createKoishiClientStub(): KoishiClientStub {
    return {
        store: { registry: {}, dependencies: {}, packages: {}, config: {} },
        send: vi.fn(),
        receive: vi.fn(),
        message: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
        socket: ref(null) as any,
        useI18n: vi.fn(),
        valueMap(source, fn) {
            const result: Record<string, any> = {};
            for (const key of Object.keys(source)) result[key] = fn(source[key], key);
            return result;
        },
    };
}

/** 从 receive 桩里取出注册某通道(如 market/install-log)时的回调。 */
export function getReceiveCallback(receive: Mock, event: string): (...args: any[]) => void {
    const call = receive.mock.calls.find(([name]) => name === event);
    if (!call) throw new Error(`receive 未注册过通道:${event}`);
    return call[1];
}
