import { describe, expect, it, vi } from "vitest";
import type { Dependency } from "../../../deps/types.js";
import { detectFullReload } from "../install-reload.js";

function deps(loaded: string[] = []) {
    return {
        isPackageLoaded: (name: string) => loaded.includes(name),
        log: { debug: vi.fn() },
    } as never;
}

function dependency(resolved: string, workspace = false) {
    return { resolved, workspace } as Dependency;
}

describe("detectFullReload", () => {
    it("已加载依赖解析版本变化时需要重载", () => {
        expect(
            detectFullReload(
                deps(["foo"]),
                { foo: dependency("1.0.0") },
                { foo: dependency("2.0.0") },
                { foo: "^1.0.0" },
                { foo: "^2.0.0" },
            ),
        ).toBe(true);
    });

    it("未加载依赖变化不需要重载", () => {
        expect(
            detectFullReload(
                deps(),
                { foo: dependency("1.0.0") },
                { foo: dependency("2.0.0") },
                { foo: "^1.0.0" },
                { foo: "^2.0.0" },
            ),
        ).toBe(false);
    });

    it("workspace 请求变更即使解析版本不变也需要重载", () => {
        expect(
            detectFullReload(
                deps(["foo"]),
                { foo: dependency("1.0.0", false) },
                { foo: dependency("1.0.0", true) },
                { foo: "npm:foo@1.0.0" },
                { foo: "workspace:*" },
            ),
        ).toBe(true);
    });
});
