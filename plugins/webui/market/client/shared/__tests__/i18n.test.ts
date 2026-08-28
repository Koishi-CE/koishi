import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KoishiClientStub } from "./helpers";

/**
 * @file i18n 装配层的单元测试。
 *
 * vue-i18n 经 vitest alias 指向 @koishi-ce/client,故 useI18n 的桩打在
 * @koishi-ce/client 上。globalComposer 是模块级懒持单例:依赖声明顺序——
 * "未注册"用例必须最先执行,其余用例各自用新 composer 重新注册覆盖。
 */

vi.mock("@koishi-ce/client", async () => {
    const { createKoishiClientStub } = await import("./helpers");
    return createKoishiClientStub();
});

// vi.mock 只是运行时替换,tsc 仍按真实模块类型推导;统一断言为桩视图
const { useI18n } = (await import("@koishi-ce/client")) as unknown as KoishiClientStub;
const { registerMarketNextI18n, translate, useMarketNextI18n } = await import("../i18n");

/** 构造带 spy 的全局 composer 桩(locale 对齐 vue-i18n 的 ref 形态)。 */
function createComposerStub(initial: Record<string, any> = {}) {
    return {
        locale: { value: "zh-CN" },
        t: vi.fn((key: string, ...args: any[]) => `t:${key}:${JSON.stringify(args)}`),
        getLocaleMessage: vi.fn((locale: string) => initial[locale]),
        mergeLocaleMessage: vi.fn(),
        setLocaleMessage: vi.fn(),
    };
}

/** 构造最小 ctx 桩:registerMarketNextI18n 只读 $i18n.i18n.global。 */
function createContextStub(composer: any) {
    return { $i18n: { i18n: { global: composer } } };
}

beforeEach(() => {
    useI18n.mockReset();
});

describe("translate", () => {
    it("composer 尚未就绪时原样返回 key(此用例必须最先执行)", () => {
        expect(translate("common.ok")).toBe("common.ok");
    });

    it("注册后经全局 composer 翻译并加 marketNext. 前缀,参数透传", () => {
        const composer = createComposerStub({ "zh-CN": {} });
        registerMarketNextI18n(createContextStub(composer) as any);
        expect(translate("common.ok", { count: 1 })).toBe(
            `t:marketNext.common.ok:${JSON.stringify([{ count: 1 }])}`,
        );
        expect(composer.t).toHaveBeenCalledWith("marketNext.common.ok", { count: 1 });
    });

    it("每次翻译都会 ensure:词条不完整时反复 merge 补齐", () => {
        const composer = createComposerStub();
        registerMarketNextI18n(createContextStub(composer) as any);
        expect(translate("a")).toContain("marketNext.a");
        const callsAfterFirst = composer.mergeLocaleMessage.mock.calls.length;
        expect(callsAfterFirst).toBeGreaterThan(0);
        expect(translate("b")).toContain("marketNext.b");
        expect(composer.mergeLocaleMessage.mock.calls.length).toBe(callsAfterFirst + 2);
    });

    it("词条已完整时翻译不再触发 merge", () => {
        // 复用真实词条结构:guard 注册后立刻补齐,再以完整词条作为 getLocaleMessage 返回
        const composer = createComposerStub();
        registerMarketNextI18n(createContextStub(composer) as any);
        const merged: Record<string, any> = {};
        for (const [locale, value] of composer.mergeLocaleMessage.mock.calls) {
            merged[locale] = value;
        }
        composer.getLocaleMessage.mockImplementation((locale: string) => ({
            marketNext: merged[locale]?.marketNext,
        }));
        composer.mergeLocaleMessage.mockClear();
        expect(translate("c")).toContain("marketNext.c");
        expect(composer.mergeLocaleMessage).not.toHaveBeenCalled();
    });
});

describe("registerMarketNextI18n", () => {
    it("注册即安装 guard 并补齐中英两个 locale 的词条", () => {
        const composer = createComposerStub();
        registerMarketNextI18n(createContextStub(composer) as any);
        const locales = composer.mergeLocaleMessage.mock.calls.map(([locale]) => locale);
        expect(locales).toEqual(expect.arrayContaining(["zh-CN", "en-US"]));
        for (const [, value] of composer.mergeLocaleMessage.mock.calls) {
            expect(Object.keys(value)).toEqual(["marketNext"]);
            // 九个文案域都应挂进命名空间
            expect(Object.keys(value.marketNext)).toEqual(
                expect.arrayContaining(["common", "operations", "market", "bundle"]),
            );
        }
    });

    it("guard:外部 setLocaleMessage 抹掉词条后自动重新补齐", () => {
        const composer = createComposerStub();
        registerMarketNextI18n(createContextStub(composer) as any);
        composer.mergeLocaleMessage.mockClear();
        composer.setLocaleMessage("zh-CN", {});
        expect(composer.mergeLocaleMessage.mock.calls.length).toBeGreaterThan(0);
    });
});

describe("useMarketNextI18n", () => {
    it("绑定全局 composer,返回的 t 自动加命名空间前缀并透出 locale", () => {
        const composer = createComposerStub({ "zh-CN": {} });
        useI18n.mockImplementation(() => composer);
        const { t, locale } = useMarketNextI18n();
        expect(useI18n).toHaveBeenCalledWith({ useScope: "global" });
        expect(t("common.ok")).toContain("marketNext.common.ok");
        expect(composer.t).toHaveBeenCalledWith("marketNext.common.ok");
        expect(locale.value).toBe("zh-CN");
    });

    it("同一 composer 重复调用不会重复包装 setLocaleMessage", () => {
        const composer = createComposerStub({ "zh-CN": {} });
        useI18n.mockImplementation(() => composer);
        useMarketNextI18n();
        const wrapped = composer.setLocaleMessage;
        useMarketNextI18n();
        expect(composer.setLocaleMessage).toBe(wrapped);
    });

    it("useMarketNextI18n 之后 translate 也能用同一 composer", () => {
        const composer = createComposerStub({ "zh-CN": {} });
        useI18n.mockImplementation(() => composer);
        useMarketNextI18n();
        expect(translate("any.key")).toContain("marketNext.any.key");
        expect(composer.t).toHaveBeenCalledWith("marketNext.any.key");
    });
});
