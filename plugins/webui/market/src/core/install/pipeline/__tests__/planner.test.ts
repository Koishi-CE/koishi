import { describe, expect, it } from "vitest";
import type { Dependency } from "../../../deps/types.js";
import {
    createInstallHistoryChanges,
    formatDeps,
    formatLocalDeps,
    requiresPackageManager,
} from "../planner.js";

function localDeps(overrides: Record<string, Partial<Dependency>> = {}) {
    const result: Record<string, Dependency> = {};
    for (const [name, value] of Object.entries(overrides)) {
        result[name] = { request: "1.0.0", ...value };
    }
    return result;
}

describe("formatDeps / formatLocalDeps", () => {
    it("formatDeps 拼接 name@version，空值标记 (remove)", () => {
        expect(formatDeps({})).toBe("(none)");
        expect(formatDeps({ a: "1.0.0" })).toBe("a@1.0.0");
        expect(formatDeps({ a: "1.0.0", b: "" })).toBe("a@1.0.0, b@(remove)");
    });

    it("formatLocalDeps 输出结构化摘要", () => {
        expect(formatLocalDeps({})).toBe("(none)");
        expect(
            formatLocalDeps({
                foo: { request: "1.0.0", resolved: "1.0.0", source: "registry", local: false },
            }),
        ).toBe("foo{request=1.0.0,resolved=1.0.0,source=registry,local=false}");
    });
});

describe("createInstallHistoryChanges", () => {
    it("按 after 键序生成变更记录", () => {
        const changes = createInstallHistoryChanges(
            { a: "1.0.0" },
            { a: "2.0.0", b: "3.0.0" },
            { a: { request: "1.0.0", resolved: "1.0.0" } },
        );
        expect(changes).toEqual([
            {
                name: "a",
                beforeRequest: "1.0.0",
                beforeResolved: "1.0.0",
                afterRequest: "2.0.0",
                afterResolved: null,
            },
            {
                name: "b",
                beforeRequest: null,
                beforeResolved: null,
                afterRequest: "3.0.0",
                afterResolved: null,
            },
        ]);
    });
});

describe("requiresPackageManager", () => {
    it("forced 总是返回 true", () => {
        expect(requiresPackageManager({}, {}, {}, {}, true)).toBe(true);
    });

    it("空变更返回 false", () => {
        expect(requiresPackageManager({}, {}, {}, {})).toBe(false);
    });

    it("本地解析已满足请求范围时跳过", () => {
        const deps = localDeps({ foo: { resolved: "1.2.3" } });
        expect(requiresPackageManager({ foo: "^1.0.0" }, deps, { foo: "^1.0.0" }, {})).toBe(false);
    });

    it("已装版本不满足请求时返回 true", () => {
        const deps = localDeps({ foo: { resolved: "1.2.3" } });
        expect(requiresPackageManager({ foo: "^2.0.0" }, deps, { foo: "^2.0.0" }, {})).toBe(true);
    });

    it("空请求（移除依赖）返回 true", () => {
        expect(requiresPackageManager({ foo: "" }, {}, {}, {})).toBe(true);
    });

    it("请求变化且涉及本地来源时返回 true", () => {
        expect(requiresPackageManager({ foo: "file:../b" }, {}, { foo: "file:../a" }, {})).toBe(
            true,
        );
    });

    it("本地依赖且请求一致时跳过", () => {
        const deps = localDeps({ foo: { local: true, source: "file" } });
        expect(requiresPackageManager({ foo: "file:../a" }, deps, { foo: "file:../a" }, {})).toBe(
            false,
        );
    });

    it("请求变化但均为 registry 源时按满足性判定", () => {
        const deps = localDeps({ foo: { resolved: "1.2.3", source: "registry" } });
        // 请求从 ^1.0.0 改为 ^1.2.0，1.2.3 仍满足 → 不需要跑包管理器
        expect(requiresPackageManager({ foo: "^1.2.0" }, deps, { foo: "^1.0.0" }, {})).toBe(false);
    });
});
