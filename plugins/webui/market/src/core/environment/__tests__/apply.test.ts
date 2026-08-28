import { describe, expect, it } from "vitest";
import type { Dependency } from "../../deps/types.js";
import { buildEnvironmentDependencies, planEnvironmentApply } from "../apply.js";
import type { EnvironmentDependencySnapshot, EnvironmentSnapshot } from "../snapshot.js";

function snapshot(deps: Record<string, EnvironmentDependencySnapshot>): EnvironmentSnapshot {
    return { id: "env-test", createdAt: 0, source: "external", dependencies: deps };
}

describe("buildEnvironmentDependencies", () => {
    it("去掉 ^/~ 前缀并按本地解析结果回填", () => {
        const localDeps: Record<string, Dependency> = {
            foo: {
                request: "1.2.3",
                resolved: "1.2.3",
                source: "registry",
                local: false,
                bound: true,
            },
            bar: { request: "workspace:*", workspace: true, local: true, bound: true },
        };
        const result = buildEnvironmentDependencies(
            { foo: "^1.2.3", bar: "workspace:*", baz: "file:../baz" },
            localDeps,
        );
        expect(result["foo"]).toMatchObject({
            request: "^1.2.3",
            resolved: "1.2.3",
            invalid: false,
        });
        expect(result["bar"]).toMatchObject({
            request: "workspace:*",
            workspace: true,
            local: true,
            invalid: false,
        });
        expect(result["baz"]).toMatchObject({ request: "file:../baz", invalid: true });
    });

    it("非法范围标记 invalid", () => {
        expect(buildEnvironmentDependencies({ foo: "not-a-version" }, {})["foo"]!.invalid).toBe(
            true,
        );
    });
});

describe("planEnvironmentApply", () => {
    it("返回 diff、unsupported 与安装请求变化", () => {
        const current = snapshot({
            foo: { request: "^1.0.0", resolved: "1.0.0" },
            local: { request: "file:../x", source: "file", local: true },
        });
        const target = snapshot({ foo: { request: "^1.0.0", resolved: "1.2.0" } });
        const plan = planEnvironmentApply(current, target);
        expect(plan.unsupported.map((item) => item.name)).toEqual(["local"]);
        expect(plan.changes).toEqual({ foo: "1.2.0" });
        expect(plan.diff.map((item) => item.status)).toEqual(["upgrade", "unsupported"]);
    });
});
