import { describe, expect, it } from "vitest";
import {
    allRegistryAttemptsNotFound,
    classifyDependencySource,
    classifyRegistryNotFoundDependency,
    type DependencySourceState,
    findDependenciesNeedingSourceCheck,
    findUnboundLocalDependencies,
    getRegistryAttemptReasons,
    isLocalDependency,
    reuseConfirmedDependencySource,
    shouldIncludeDiscoveredLocalPlugin,
    shouldPenalizeRegistryRoute,
} from "../dependency-source.js";

describe("classifyDependencySource", () => {
    it("本地协议前缀（大小写不敏感）", () => {
        expect(classifyDependencySource("file:../x")).toEqual({
            source: "file",
            local: true,
            bound: true,
        });
        expect(classifyDependencySource("link:foo")).toEqual({
            source: "link",
            local: true,
            bound: true,
        });
        expect(classifyDependencySource("portal:foo")).toEqual({
            source: "portal",
            local: true,
            bound: true,
        });
        expect(classifyDependencySource("workspace:foo")).toEqual({
            source: "workspace",
            local: true,
            bound: true,
        });
        expect(classifyDependencySource("FILE:../x")).toEqual({
            source: "file",
            local: true,
            bound: true,
        });
    });

    it("本地路径识别", () => {
        expect(classifyDependencySource("./foo")).toEqual({
            source: "file",
            local: true,
            bound: true,
        });
        expect(classifyDependencySource("../foo")).toEqual({
            source: "file",
            local: true,
            bound: true,
        });
        expect(classifyDependencySource(".\\foo")).toEqual({
            source: "file",
            local: true,
            bound: true,
        });
        expect(classifyDependencySource("C:\\dev\\pkg")).toEqual({
            source: "file",
            local: true,
            bound: true,
        });
        expect(classifyDependencySource("/abs/path")).toEqual({
            source: "file",
            local: true,
            bound: true,
        });
    });

    it("workspace 标记与 url/git 形态", () => {
        expect(classifyDependencySource("foo", { workspace: true })).toEqual({
            source: "workspace",
            local: true,
            bound: true,
        });
        expect(classifyDependencySource("https://x/y")).toEqual({
            source: "url",
            local: false,
            bound: true,
        });
        expect(classifyDependencySource("ftp://x/y")).toEqual({
            source: "url",
            local: false,
            bound: true,
        });
        expect(classifyDependencySource("git+https://github.com/a/b")).toEqual({
            source: "git",
            local: false,
            bound: true,
        });
        expect(classifyDependencySource("github:user/repo")).toEqual({
            source: "git",
            local: false,
            bound: true,
        });
        expect(classifyDependencySource("user/repo")).toEqual({
            source: "git",
            local: false,
            bound: true,
        });
        expect(classifyDependencySource("user/repo#branch")).toEqual({
            source: "git",
            local: false,
            bound: true,
        });
    });

    it("registry 默认与 unbound 形态", () => {
        expect(classifyDependencySource("koishi-plugin-chat")).toEqual({
            source: "registry",
            local: false,
            bound: true,
        });
        expect(
            classifyDependencySource("foo", { installed: true, registryNotFound: true }),
        ).toEqual({
            source: "unbound",
            local: true,
            bound: false,
        });
        expect(classifyDependencySource("foo", { installed: true, discoveredLocal: true })).toEqual(
            {
                source: "unbound",
                local: true,
                bound: false,
            },
        );
        expect(classifyDependencySource("foo", { installed: true })).toEqual({
            source: "registry",
            local: false,
            bound: true,
        });
    });
});

describe("classifyRegistryNotFoundDependency", () => {
    it("插件 + registry 源 + 已解析 → 判定为 unbound 本地", () => {
        expect(
            classifyRegistryNotFoundDependency(
                { request: "koishi-plugin-x", resolved: "1.0.0", source: "registry" },
                true,
            ),
        ).toEqual({ source: "unbound", local: true, bound: false });
    });

    it("非插件、无 resolved 或非 registry 源时返回 undefined", () => {
        expect(classifyRegistryNotFoundDependency(undefined, true)).toBeUndefined();
        expect(
            classifyRegistryNotFoundDependency(
                { request: "koishi-plugin-x", source: "registry" },
                true,
            ),
        ).toBeUndefined();
        expect(
            classifyRegistryNotFoundDependency(
                { request: "koishi-plugin-x", resolved: "1.0.0", source: "file" },
                true,
            ),
        ).toBeUndefined();
        expect(
            classifyRegistryNotFoundDependency(
                { request: "koishi-plugin-x", resolved: "1.0.0", source: "registry" },
                false,
            ),
        ).toBeUndefined();
    });
});

describe("reuseConfirmedDependencySource", () => {
    const previous: DependencySourceState = {
        request: "koishi-plugin-x",
        resolved: "1.0.0",
        source: "unbound",
    };

    it("新鲜确认且请求/解析一致时保留 unbound", () => {
        expect(
            reuseConfirmedDependencySource(
                previous,
                { request: "koishi-plugin-x", resolved: "1.0.0", source: "registry" },
                true,
            ),
        ).toEqual({ source: "unbound", local: true, bound: false });
    });

    it("过期确认、请求变化或解析缺失时不保留", () => {
        expect(reuseConfirmedDependencySource(previous, previous, false)).toBeUndefined();
        expect(
            reuseConfirmedDependencySource(
                previous,
                { request: "koishi-plugin-y", resolved: "1.0.0", source: "registry" },
                true,
            ),
        ).toBeUndefined();
        expect(
            reuseConfirmedDependencySource(
                previous,
                { request: "koishi-plugin-x", source: "registry" },
                true,
            ),
        ).toBeUndefined();
        expect(
            reuseConfirmedDependencySource({ ...previous, source: "registry" }, previous, true),
        ).toBeUndefined();
    });
});

describe("findUnboundLocalDependencies", () => {
    it("返回 unbound 且未被本次变更覆盖的依赖，按键排序", () => {
        const dependencies: Record<string, DependencySourceState | undefined> = {
            a: { request: "a", source: "unbound", local: true, bound: false },
            b: { request: "b", source: "unbound", local: true, bound: false },
            c: { request: "c", source: "registry" },
        };
        expect(findUnboundLocalDependencies(dependencies, { b: "1.0.0" })).toEqual(["a"]);
    });
});

describe("findDependenciesNeedingSourceCheck", () => {
    const deps: Record<string, DependencySourceState | undefined> = {
        a: { request: "a", resolved: "1.0.0", source: "registry" },
        b: { request: "b", resolved: "1.0.0", source: "registry" },
        c: { request: "c", resolved: "1.0.0", source: "file", local: true },
        d: { request: "d", resolved: "1.0.0", source: "registry" },
        e: { request: "e", source: "registry" },
    };

    it("排除本地、未解析、已完成与有变更的依赖", () => {
        expect(findDependenciesNeedingSourceCheck(deps, { d: "1.1.0" }, ["a"])).toEqual(["b"]);
    });
});

describe("isLocalDependency", () => {
    it("识别本地来源", () => {
        expect(isLocalDependency()).toBe(false);
        expect(isLocalDependency({ request: "x", source: "registry" })).toBe(false);
        expect(isLocalDependency({ request: "x", source: "file" })).toBe(true);
        expect(isLocalDependency({ request: "x", source: "workspace" })).toBe(true);
        expect(isLocalDependency({ request: "x", source: "unbound" })).toBe(true);
        expect(isLocalDependency({ request: "x", local: true })).toBe(true);
        expect(isLocalDependency({ request: "x", workspace: true })).toBe(true);
    });
});

describe("shouldIncludeDiscoveredLocalPlugin", () => {
    it("已声明不收录；已配置/运行中/workspace 收录", () => {
        expect(shouldIncludeDiscoveredLocalPlugin({ declared: true })).toBe(false);
        expect(shouldIncludeDiscoveredLocalPlugin({ configured: true })).toBe(true);
        expect(shouldIncludeDiscoveredLocalPlugin({ running: true })).toBe(true);
        expect(shouldIncludeDiscoveredLocalPlugin({ workspace: true })).toBe(true);
        expect(shouldIncludeDiscoveredLocalPlugin({})).toBe(false);
    });
});

describe("registry 尝试归因辅助", () => {
    it("allRegistryAttemptsNotFound", () => {
        expect(allRegistryAttemptsNotFound([])).toBe(false);
        expect(allRegistryAttemptsNotFound(["not-found"])).toBe(true);
        expect(allRegistryAttemptsNotFound(["not-found", "timeout"])).toBe(false);
    });

    it("getRegistryAttemptReasons 读取 marketNextReasons 并回退", () => {
        expect(
            getRegistryAttemptReasons({ marketNextReasons: ["timeout", "", "not-found"] }),
        ).toEqual(["timeout", "not-found"]);
        expect(getRegistryAttemptReasons({ marketNextReasons: "x" }, "fallback")).toEqual([
            "fallback",
        ]);
        expect(getRegistryAttemptReasons(new Error("x"))).toEqual([]);
        expect(getRegistryAttemptReasons(new Error("x"), "unknown")).toEqual(["unknown"]);
    });

    it("shouldPenalizeRegistryRoute", () => {
        expect(shouldPenalizeRegistryRoute("not-found")).toBe(false);
        expect(shouldPenalizeRegistryRoute("timeout")).toBe(true);
        expect(shouldPenalizeRegistryRoute(undefined)).toBe(true);
    });
});
