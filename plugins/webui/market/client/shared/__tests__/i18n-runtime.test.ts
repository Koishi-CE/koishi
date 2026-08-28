import { describe, expect, it, vi } from "vitest";

/**
 * @file i18n 命名空间补齐与守护机制的单元测试。
 *
 * 覆盖:ensureLocaleNamespace 的完整/缺失判定与 merge 触发、
 * installLocaleNamespaceGuard 的 setLocaleMessage 劫持、applying 防递归、
 * 重复注册覆盖 ensure、多 composer 互不影响。
 */

const { ensureLocaleNamespace, installLocaleNamespaceGuard } = await import("../i18n-runtime");

/** 构造带 spy 的最小 composer。 */
function createComposer(initial: Record<string, any> = {}) {
    const messages: Record<string, any> = structuredClone(initial);
    return {
        messages,
        mergeLocaleMessage: vi.fn((locale: string, value: any) => {
            const current: Record<string, any> = (messages[locale] ??= {});
            for (const [key, child] of Object.entries(value)) {
                // 浅合并语义与 {...x, ...y} 一致;用 assign 规避 tsc7 对 any 展开的收紧
                current[key] = Object.assign({}, current[key], child);
            }
        }),
        setLocaleMessage: vi.fn((locale: string, value: any) => {
            messages[locale] = value;
        }),
        getLocaleMessage: (locale: string) => messages[locale],
    };
}

describe("ensureLocaleNamespace", () => {
    it("词条缺失时 merge 进命名空间并返回 true", () => {
        const composer = createComposer({ "zh-CN": {} });
        const changed = ensureLocaleNamespace(composer, "marketNext", { "zh-CN": { a: 1 } });
        expect(changed).toBe(true);
        expect(composer.mergeLocaleMessage).toHaveBeenCalledWith("zh-CN", { marketNext: { a: 1 } });
    });

    it("词条已完整覆盖预期时跳过 merge 并返回 false", () => {
        const composer = createComposer({ "zh-CN": { marketNext: { a: 1, nested: { x: true } } } });
        const changed = ensureLocaleNamespace(composer, "marketNext", {
            "zh-CN": { a: 1, nested: { x: true } },
        });
        expect(changed).toBe(false);
        expect(composer.mergeLocaleMessage).not.toHaveBeenCalled();
    });

    it("嵌套词条缺叶子键时视为不完整(递归比对)", () => {
        const composer = createComposer({ "zh-CN": { marketNext: { nested: { x: 1 } } } });
        const changed = ensureLocaleNamespace(composer, "marketNext", {
            "zh-CN": { nested: { x: 1, y: 2 } },
        });
        expect(changed).toBe(true);
    });

    it("叶子值不一致(类型或内容)时视为不完整", () => {
        const composer = createComposer({ "zh-CN": { marketNext: { a: 1, b: "x" } } });
        expect(ensureLocaleNamespace(composer, "marketNext", { "zh-CN": { a: 2 } })).toBe(true);
        expect(ensureLocaleNamespace(composer, "marketNext", { "zh-CN": { b: ["x"] } })).toBe(true);
    });

    it("现有词条是非对象(数组/null)而预期是对象时视为不完整", () => {
        const arrayComposer = createComposer({ "zh-CN": { marketNext: [1, 2] } });
        expect(ensureLocaleNamespace(arrayComposer, "marketNext", { "zh-CN": { a: 1 } })).toBe(
            true,
        );
        const nullComposer = createComposer({ "zh-CN": { marketNext: null } });
        expect(ensureLocaleNamespace(nullComposer, "marketNext", { "zh-CN": { a: 1 } })).toBe(true);
    });

    it("locale 整体缺失或 getLocaleMessage 返回非对象时也走 merge", () => {
        const composer = createComposer();
        expect(ensureLocaleNamespace(composer, "marketNext", { "en-US": { a: 1 } })).toBe(true);
        expect(ensureLocaleNamespace(composer, "marketNext", { "zh-CN": undefined })).toBe(false);
    });

    it("预期叶子为非对象时按引用/值全等比较", () => {
        // 不经 clone 构造,保证数组叶子与预期是同一引用
        const shared = [1];
        const composer = {
            getLocaleMessage: () => ({ marketNext: { list: shared, flag: true } }),
            mergeLocaleMessage: vi.fn(),
            setLocaleMessage: vi.fn(),
        };
        // 同一引用的数组叶子视为完整
        expect(ensureLocaleNamespace(composer, "marketNext", { "zh-CN": { list: shared } })).toBe(
            false,
        );
        expect(composer.mergeLocaleMessage).not.toHaveBeenCalled();
        // 原始值叶子按值全等:相等完整、不等不完整
        expect(ensureLocaleNamespace(composer, "marketNext", { "zh-CN": { flag: true } })).toBe(
            false,
        );
        expect(ensureLocaleNamespace(composer, "marketNext", { "zh-CN": { flag: false } })).toBe(
            true,
        );
        // 内容相同但引用不同的数组叶子按引用比较,视为不完整
        expect(ensureLocaleNamespace(composer, "marketNext", { "zh-CN": { list: [1] } })).toBe(
            true,
        );
    });

    it("多 locale 混合:一个完整一个缺失时仅 merge 缺失的那个", () => {
        const composer = createComposer({ "zh-CN": { marketNext: { a: 1 } } });
        const changed = ensureLocaleNamespace(composer, "marketNext", {
            "zh-CN": { a: 1 },
            "en-US": { a: 1 },
        });
        expect(changed).toBe(true);
        expect(composer.mergeLocaleMessage).toHaveBeenCalledTimes(1);
        expect(composer.mergeLocaleMessage).toHaveBeenCalledWith("en-US", { marketNext: { a: 1 } });
    });
});

describe("installLocaleNamespaceGuard", () => {
    it("注册时立即补齐缺失词条", () => {
        const composer = createComposer();
        installLocaleNamespaceGuard(composer, "marketNext", { "zh-CN": { a: 1 } });
        expect(composer.mergeLocaleMessage).toHaveBeenCalledWith("zh-CN", { marketNext: { a: 1 } });
    });

    it("外部的 setLocaleMessage 会抹掉词条,guard 在 set 后自动重新补齐", () => {
        const composer = createComposer();
        installLocaleNamespaceGuard(composer, "marketNext", { "zh-CN": { a: 1 } });
        composer.mergeLocaleMessage.mockClear();
        // 模拟旧版 bundle 恢复 locale 快照:整体覆盖导致命名空间被抹掉
        composer.setLocaleMessage("zh-CN", { other: {} });
        expect(composer.mergeLocaleMessage).toHaveBeenCalledWith("zh-CN", { marketNext: { a: 1 } });
    });

    it("guard 补齐过程中再触发 setLocaleMessage 不会递归(applying 标记)", () => {
        const composer = createComposer();
        installLocaleNamespaceGuard(composer, "marketNext", { "zh-CN": { a: 1 } });
        let mergeCalls = 0;
        composer.mergeLocaleMessage.mockImplementation((locale: string, value: any) => {
            mergeCalls++;
            // 模拟 composer 实现异常:merge 内部又回调了 setLocaleMessage
            composer.setLocaleMessage(locale, value);
        });
        composer.setLocaleMessage("zh-CN", {});
        // 若无 applying 防递归,这里会无限循环导致超时
        expect(mergeCalls).toBe(1);
    });

    it("同一 composer 重复注册:不重复包装 setLocaleMessage,ensure 被最新词条覆盖", () => {
        const composer = createComposer();
        installLocaleNamespaceGuard(composer, "marketNext", { "zh-CN": { a: 1 } });
        const wrapped = composer.setLocaleMessage;
        installLocaleNamespaceGuard(composer, "marketNext", { "zh-CN": { b: 2 } });
        expect(composer.setLocaleMessage).toBe(wrapped);
        composer.mergeLocaleMessage.mockClear();
        composer.setLocaleMessage("zh-CN", {});
        expect(composer.mergeLocaleMessage).toHaveBeenCalledWith("zh-CN", { marketNext: { b: 2 } });
    });

    it("不同 composer 的 guard 相互独立", () => {
        const first = createComposer();
        const second = createComposer();
        installLocaleNamespaceGuard(first, "marketNext", { "zh-CN": { a: 1 } });
        installLocaleNamespaceGuard(second, "marketNext", { "zh-CN": { b: 2 } });
        first.setLocaleMessage("zh-CN", {});
        second.setLocaleMessage("zh-CN", {});
        expect(first.mergeLocaleMessage).toHaveBeenCalledWith("zh-CN", { marketNext: { a: 1 } });
        expect(second.mergeLocaleMessage).toHaveBeenCalledWith("zh-CN", { marketNext: { b: 2 } });
    });
});
