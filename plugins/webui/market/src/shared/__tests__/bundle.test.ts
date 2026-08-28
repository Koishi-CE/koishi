import { describe, expect, it } from "vitest";
import {
    hasBundleKeyword,
    isBundleLike,
    isBundlePackageName,
    type PluginBundleManifest,
    type PluginBundleMember,
    parseBundleManifest,
    validateBundleManifest,
} from "../bundle.js";
import {
    getBundleGroupIdent,
    getBundleMemberIdent,
    getPluginShortname,
    normalizeBundleIdent,
    scanSensitiveConfig,
} from "../bundle-idents.js";

function makeMember(overrides: Partial<PluginBundleMember> = {}): PluginBundleMember {
    return {
        package: "koishi-plugin-chat",
        plugin: "chat",
        version: "^1.0.0",
        ...overrides,
    };
}

function makeBundle(members: PluginBundleMember[] = [makeMember()]): PluginBundleManifest {
    return { members };
}

describe("isBundlePackageName", () => {
    it("识别 koishi-plugin-pa-* 命名", () => {
        expect(isBundlePackageName("koishi-plugin-pa-demo")).toBe(true);
        expect(isBundlePackageName("@scope/koishi-plugin-pa-demo")).toBe(true);
        expect(isBundlePackageName("koishi-plugin-pa-x")).toBe(true);
    });

    it("拒绝普通插件包、非小写与空值", () => {
        expect(isBundlePackageName("koishi-plugin-chat")).toBe(false);
        expect(isBundlePackageName("koishi-plugin-pa-Demo")).toBe(false);
        expect(isBundlePackageName("@Scope/koishi-plugin-pa-demo")).toBe(false);
        expect(isBundlePackageName("")).toBe(false);
        expect(isBundlePackageName()).toBe(false);
    });
});

describe("hasBundleKeyword / isBundleLike", () => {
    it("hasBundleKeyword 大小写不敏感匹配 market:package", () => {
        expect(hasBundleKeyword(["a", "market:package"])).toBe(true);
        expect(hasBundleKeyword(["MARKET:PACKAGE"])).toBe(true);
        expect(hasBundleKeyword(["a"])).toBe(false);
        expect(hasBundleKeyword(undefined)).toBe(false);
    });

    it("isBundleLike 覆盖命名、关键字与 koishi.bundle 三种形态", () => {
        expect(isBundleLike({ name: "koishi-plugin-pa-demo" })).toBe(true);
        expect(isBundleLike({ keywords: ["market:package"] })).toBe(true);
        expect(isBundleLike({ koishi: { bundle: { members: [] } } })).toBe(true);
        expect(isBundleLike({ name: "koishi-plugin-chat" })).toBe(false);
        expect(isBundleLike({})).toBe(false);
    });
});

describe("parseBundleManifest", () => {
    it("非对象返回 undefined", () => {
        expect(parseBundleManifest(undefined)).toBeUndefined();
        expect(parseBundleManifest(null)).toBeUndefined();
        expect(parseBundleManifest("x")).toBeUndefined();
    });

    it("解析成员并过滤非法条目", () => {
        const parsed = parseBundleManifest({
            label: "Demo",
            description: "desc",
            members: [
                {
                    package: "koishi-plugin-chat",
                    plugin: "chat",
                    version: "^1.0.0",
                    required: true,
                    config: { foo: 1 },
                },
                {
                    package: "koishi-plugin-echo",
                    plugin: "echo",
                    version: "1.0.0",
                    required: false,
                },
                "not-a-record",
                null,
            ],
        });
        expect(parsed).toEqual({
            label: "Demo",
            description: "desc",
            members: [
                {
                    package: "koishi-plugin-chat",
                    plugin: "chat",
                    version: "^1.0.0",
                    required: true,
                    config: { foo: 1 },
                },
                {
                    package: "koishi-plugin-echo",
                    plugin: "echo",
                    version: "1.0.0",
                    required: false,
                    config: undefined,
                },
            ],
        });
    });

    it("members 非数组时为空数组", () => {
        expect(parseBundleManifest({ members: "x" })).toEqual({
            label: undefined,
            description: undefined,
            members: [],
        });
    });
});

describe("validateBundleManifest", () => {
    it("合法 bundle（带 keyword）校验通过", () => {
        const result = validateBundleManifest("koishi-plugin-pa-demo", makeBundle(), {
            keyword: true,
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
    });

    it("缺少 keyword 产生警告", () => {
        const result = validateBundleManifest("koishi-plugin-pa-demo", makeBundle());
        expect(result.valid).toBe(true);
        expect(result.warnings).toContain('missing keyword "market:package"');
    });

    it("缺少 koishi.bundle 直接判失败", () => {
        const result = validateBundleManifest("koishi-plugin-pa-demo", undefined, {
            keyword: true,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(["missing koishi.bundle"]);
    });

    it("非 bundle 命名即使带 bundle 也报错", () => {
        const result = validateBundleManifest("koishi-plugin-chat", makeBundle(), {
            keyword: true,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
            "bundle package name must be koishi-plugin-pa-* or @scope/koishi-plugin-pa-*",
        );
    });

    it("包名非小写报错", () => {
        const result = validateBundleManifest("KOISHI-PLUGIN-PA-DEMO", makeBundle(), {
            keyword: true,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("package name must be lowercase");
    });

    it("空 members 报错", () => {
        const result = validateBundleManifest("koishi-plugin-pa-demo", makeBundle([]), {
            keyword: true,
        });
        expect(result.errors).toContain("koishi.bundle.members must not be empty");
    });

    it("成员字段缺失与非小写分别报错", () => {
        const result = validateBundleManifest(
            "koishi-plugin-pa-demo",
            makeBundle([
                makeMember({ package: "", plugin: "chat", version: "^1.0.0" }),
                makeMember({ package: "Koishi-plugin-echo", plugin: "echo", version: "" }),
            ]),
            { keyword: true },
        );
        expect(result.errors).toContain("members[0].package is required");
        expect(result.errors).toContain("members[1].package must be lowercase");
        expect(result.errors).toContain("members[1].version is required");
        expect(result.valid).toBe(false);
    });

    it("非法包名与非法 semver range 报错", () => {
        const result = validateBundleManifest(
            "koishi-plugin-pa-demo",
            makeBundle([makeMember({ package: "not-a-plugin-name", version: "not-semver" })]),
            { keyword: true },
        );
        expect(result.errors).toContain(
            "members[0].package is not a valid Koishi plugin package name",
        );
        expect(result.errors).toContain("members[0].version is not a valid semver range");
    });

    it("成员引用 bundle 自身报错", () => {
        const result = validateBundleManifest(
            "koishi-plugin-pa-demo",
            makeBundle([makeMember({ package: "koishi-plugin-pa-demo" })]),
            { keyword: true },
        );
        expect(result.errors).toContain(
            "members[0].package must not reference the bundle package itself",
        );
    });

    it("重复成员报错，同包重复列出给警告", () => {
        const result = validateBundleManifest(
            "koishi-plugin-pa-demo",
            makeBundle([
                makeMember({ package: "koishi-plugin-chat", plugin: "chat" }),
                makeMember({ package: "koishi-plugin-chat", plugin: "chat" }),
            ]),
            { keyword: true },
        );
        expect(result.errors).toContain("members[1] duplicates another member");
        expect(result.warnings).toContain("members[1].package is listed more than once");
    });

    it("插件名非小写包形键与潜在冲突给警告", () => {
        const result = validateBundleManifest(
            "koishi-plugin-pa-demo",
            makeBundle([makeMember({ plugin: "chat" }), makeMember({ plugin: "Chat" })]),
            { keyword: true },
        );
        expect(result.warnings).toContain(
            "members[1].plugin should use lowercase package-like keys to avoid config conflicts",
        );
        expect(result.warnings).toContain("members[1].plugin may conflict with another member");
    });
});

describe("身份派生", () => {
    it("getPluginShortname 去掉插件前缀", () => {
        expect(getPluginShortname("koishi-plugin-chat")).toBe("chat");
        expect(getPluginShortname("@koishijs/plugin-console")).toBe("console");
        expect(getPluginShortname("@scope/koishi-plugin-foo")).toBe("@scope/foo");
    });

    it("normalizeBundleIdent 归一化并截断", () => {
        expect(normalizeBundleIdent("Foo Bar")).toBe("foo-bar");
        expect(normalizeBundleIdent("@scope/name")).toBe("scope-name");
        expect(normalizeBundleIdent("!!!")).toBe("bundle");
        expect(normalizeBundleIdent("a".repeat(60))).toHaveLength(48);
    });

    it("getBundleGroupIdent / getBundleMemberIdent", () => {
        // bundle 包短名保留 pa- 前缀，与组前缀拼接（如 pa-pa-demo）
        expect(getBundleGroupIdent("koishi-plugin-pa-demo")).toBe("pa-pa-demo");
        expect(getBundleGroupIdent("koishi-plugin-chat")).toBe("pa-chat");
        expect(
            getBundleMemberIdent("koishi-plugin-pa-demo", {
                package: "koishi-plugin-chat",
                plugin: "chat",
            }),
        ).toBe("pa-pa-demo-chat");
        expect(
            getBundleMemberIdent("koishi-plugin-pa-demo", {
                package: "koishi-plugin-chat",
                plugin: "",
            }),
        ).toBe("pa-pa-demo-chat");
    });
});

describe("scanSensitiveConfig", () => {
    it("递归收集敏感键路径", () => {
        expect(scanSensitiveConfig({ token: "x" })).toEqual(["token"]);
        expect(scanSensitiveConfig({ nested: { password: "y" } })).toEqual(["nested.password"]);
        expect(scanSensitiveConfig({ url: "x", command: "y", path: "z" })).toEqual([
            "url",
            "command",
            "path",
        ]);
        expect(scanSensitiveConfig({ safe: { name: "a" } })).toEqual([]);
        expect(scanSensitiveConfig(null)).toEqual([]);
        expect(scanSensitiveConfig("x")).toEqual([]);
    });
});
