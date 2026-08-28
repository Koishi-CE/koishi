import { describe, expect, it } from "vitest";
import { findPluginConfigKey, hasPluginConfigInTree } from "../plugins-map.js";

describe("findPluginConfigKey", () => {
    it("按短名命中普通键", () => {
        expect(findPluginConfigKey({ "chat:anything": {} }, "chat")).toBe("chat:anything");
        expect(findPluginConfigKey({ chat: {} }, "chat")).toBe("chat");
    });

    it("跳过 $ 元键", () => {
        // biome-ignore lint/style/useNamingConvention: koishi 配置树的 $ 元键形态
        expect(findPluginConfigKey({ $label: "x", chat: {} }, "$label")).toBeUndefined();
        // $ 键不会被当成 chat 的候选,返回真正的业务键
        // biome-ignore lint/style/useNamingConvention: koishi 配置树的 $ 元键形态
        expect(findPluginConfigKey({ $label: "x", "chat:1": {} }, "chat")).toBe("chat:1");
    });

    it("剥掉 ~ 禁用前缀后匹配", () => {
        expect(findPluginConfigKey({ "~chat:ident": {} }, "chat")).toBe("~chat:ident");
        // 短名本身带 ~ 时不会匹配普通键(前缀必须真的存在)
        expect(findPluginConfigKey({ chat: {} }, "~chat")).toBeUndefined();
    });

    it("scope 名保留在短名中参与比较", () => {
        expect(findPluginConfigKey({ "@scope/plugin-x:1": {} }, "@scope/plugin-x")).toBe(
            "@scope/plugin-x:1",
        );
        // 不带 scope 的短名不匹配带 scope 的键
        expect(findPluginConfigKey({ "@scope/plugin-x:1": {} }, "x")).toBeUndefined();
    });

    it("空表 / null / 无命中返回 undefined", () => {
        expect(findPluginConfigKey({}, "chat")).toBeUndefined();
        expect(findPluginConfigKey(null, "chat")).toBeUndefined();
        expect(findPluginConfigKey(undefined, "chat")).toBeUndefined();
        expect(findPluginConfigKey({ "other:1": {} }, "chat")).toBeUndefined();
    });

    it("group 键本身也可被定位（短名即 group）", () => {
        expect(findPluginConfigKey({ "group:main": {} }, "group")).toBe("group:main");
    });
});

describe("hasPluginConfigInTree", () => {
    it("顶层命中", () => {
        expect(hasPluginConfigInTree({ "~chat:x": {} }, "chat")).toBe(true);
    });

    it("递归命中任意深度的 group 嵌套", () => {
        const tree = {
            "group:a": {
                "group:b": {
                    "chat:deep": {},
                },
            },
        };
        expect(hasPluginConfigInTree(tree, "chat")).toBe(true);
    });

    it("嵌套非 group 节点不往下找", () => {
        const tree = { "other:1": { "chat:x": {} } };
        expect(hasPluginConfigInTree(tree, "chat")).toBe(false);
    });

    it("$ 打头的 group 元键不参与递归", () => {
        const tree = { "$group:meta": { "chat:x": {} } };
        expect(hasPluginConfigInTree(tree, "chat")).toBe(false);
    });

    it("禁用前缀的 group 仍会递归（~group:x 剥前缀后是 group）", () => {
        const tree = { "~group:paused": { "chat:x": {} } };
        expect(hasPluginConfigInTree(tree, "chat")).toBe(true);
    });

    it("group 值为 null / 空对象 / 无匹配返回 false", () => {
        expect(hasPluginConfigInTree({ "group:a": null }, "chat")).toBe(false);
        expect(hasPluginConfigInTree({ "group:a": {} }, "chat")).toBe(false);
        expect(hasPluginConfigInTree({}, "chat")).toBe(false);
        expect(hasPluginConfigInTree(null, "chat")).toBe(false);
    });

    it("同名兄弟 group 只要有任一嵌套命中即为 true", () => {
        const tree = {
            "group:a": {},
            "group:b": { "chat:x": {} },
        };
        expect(hasPluginConfigInTree(tree, "chat")).toBe(true);
    });
});
