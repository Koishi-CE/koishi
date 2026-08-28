import { describe, expect, it } from "vitest";
import { getEnvironmentDiff, getEnvironmentInstallChanges } from "../diff.js";
import type { EnvironmentDependencySnapshot, EnvironmentSnapshot } from "../snapshot.js";

function dep(
    overrides: Partial<EnvironmentDependencySnapshot> = {},
): EnvironmentDependencySnapshot {
    return { request: "1.0.0", ...overrides };
}

function snapshot(
    deps: Record<string, EnvironmentDependencySnapshot | undefined>,
): EnvironmentSnapshot {
    const cleaned: Record<string, EnvironmentDependencySnapshot> = {};
    for (const [name, value] of Object.entries(deps)) {
        if (value) cleaned[name] = value;
    }
    return {
        id: "env-test",
        createdAt: 0,
        source: "external",
        dependencies: cleaned,
    };
}

describe("getEnvironmentDiff", () => {
    it("无变化 → unchanged", () => {
        const current = snapshot({ foo: dep({ request: "^1.0.0", resolved: "1.2.0" }) });
        const target = snapshot({ foo: dep({ request: "^1.0.0", resolved: "1.2.0" }) });
        expect(getEnvironmentDiff(current, target)).toEqual([
            expect.objectContaining({
                name: "foo",
                status: "unchanged",
                currentVersion: "1.2.0",
                targetVersion: "1.2.0",
            }),
        ]);
    });

    it("resolved 缺失时按 request 比较", () => {
        const current = snapshot({ foo: dep({ request: "^1.0.0" }) });
        const target = snapshot({ foo: dep({ request: "^1.0.0" }) });
        expect(getEnvironmentDiff(current, target)[0]!.status).toBe("unchanged");
    });

    it("upgrade / downgrade / changed", () => {
        const current = snapshot({
            a: dep({ request: "^1.0.0", resolved: "1.0.0" }),
            b: dep({ request: "^1.0.0", resolved: "2.0.0" }),
            c: dep({ request: "^1.0.0", resolved: "1.0.0" }),
        });
        const target = snapshot({
            a: dep({ request: "^1.0.0", resolved: "1.2.0" }),
            b: dep({ request: "^1.0.0", resolved: "1.0.0" }),
            c: dep({ request: "^1.0.0" }),
        });
        const diff = getEnvironmentDiff(current, target);
        expect(diff.find((item) => item.name === "a")!.status).toBe("upgrade");
        expect(diff.find((item) => item.name === "b")!.status).toBe("downgrade");
        expect(diff.find((item) => item.name === "c")!.status).toBe("changed");
    });

    it("added / removed", () => {
        const current = snapshot({ a: dep({ request: "1.0.0", resolved: "1.0.0" }) });
        const target = snapshot({
            a: dep({ request: "1.0.0", resolved: "1.0.0" }),
            b: dep({ request: "2.0.0" }),
        });
        expect(getEnvironmentDiff(current, target).find((item) => item.name === "b")!.status).toBe(
            "added",
        );
        expect(getEnvironmentDiff(target, current).find((item) => item.name === "b")!.status).toBe(
            "removed",
        );
    });

    it("本地依赖差异 → unsupported（含被移除场景）", () => {
        const current = snapshot({
            local: dep({ request: "file:../x", source: "file", local: true }),
        });
        const target = snapshot({});
        expect(getEnvironmentDiff(current, target)[0]).toMatchObject({
            name: "local",
            status: "unsupported",
            reason: "local",
        });
    });

    it("本地依赖一致 → unchanged", () => {
        const local = dep({ request: "file:../x", source: "file", local: true, bound: true });
        expect(getEnvironmentDiff(snapshot({ local }), snapshot({ local }))[0]!.status).toBe(
            "unchanged",
        );
    });

    it("结果按键排序", () => {
        const current = snapshot({ b: dep(), a: dep() });
        const target = snapshot({ a: dep(), b: dep() });
        expect(getEnvironmentDiff(current, target).map((item) => item.name)).toEqual(["a", "b"]);
    });
});

describe("getEnvironmentInstallChanges", () => {
    it("unchanged/unsupported 跳过，移除为删除，其余取 target resolved/request", () => {
        const target = snapshot({
            a: dep({ request: "^1.0.0", resolved: "1.2.0" }),
            b: dep({ request: "2.0.0" }),
        });
        const diff = getEnvironmentDiff(
            snapshot({
                a: dep({ request: "^1.0.0", resolved: "1.0.0" }),
                c: dep({ request: "1.0.0", resolved: "1.0.0" }),
            }),
            target,
        );
        expect(getEnvironmentInstallChanges(diff, target)).toEqual({
            a: "1.2.0",
            b: "2.0.0",
            c: "",
        });
    });

    it("unsupported 不产生安装变化", () => {
        const current = snapshot({ x: dep({ request: "file:../x", source: "file", local: true }) });
        const target = snapshot({});
        const diff = getEnvironmentDiff(current, target);
        expect(getEnvironmentInstallChanges(diff, target)).toEqual({});
    });
});
