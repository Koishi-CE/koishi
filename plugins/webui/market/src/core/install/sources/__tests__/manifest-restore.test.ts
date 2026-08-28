import { promises as fsp } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackageJson } from "@koishi-ce/registry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallLogger } from "../../types.js";
import {
    overrideDependencies,
    type PackageManifestSnapshot,
    resolveLocalDeps,
    restorePackageManifest,
} from "../manifest-restore.js";

function makeLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies InstallLogger;
}

describe("overrideDependencies", () => {
    it("增改删请求并按键排序", () => {
        const manifest = {
            name: "app",
            dependencies: { foo: "1.0.0", baz: "3.0.0" },
        } as unknown as PackageJson;
        overrideDependencies(manifest, { foo: "2.0.0", bar: "1.0.0", baz: "" });
        expect(manifest.dependencies).toEqual({ bar: "1.0.0", foo: "2.0.0" });
    });

    it("无 dependencies 时初始化", () => {
        const manifest = { name: "app" } as PackageJson;
        overrideDependencies(manifest, { a: "1.0.0" });
        expect(manifest.dependencies).toEqual({ a: "1.0.0" });
    });
});

describe("restorePackageManifest", () => {
    let dir: string;
    let cwd: string;
    let snapshot: PackageManifestSnapshot;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "manifest-restore-"));
        cwd = join(dir, "project");
        await fsp.mkdir(cwd, { recursive: true });
        snapshot = {
            manifest: { name: "app", dependencies: { foo: "1.0.0" } } as unknown as PackageJson,
            content: JSON.stringify({ name: "app", dependencies: { foo: "1.0.0" } }),
            dependencies: { foo: "1.0.0" },
        };
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("按快照回滚请求并写回文件", async () => {
        await fsp.writeFile(
            join(cwd, "package.json"),
            JSON.stringify({ name: "app", dependencies: { foo: "2.0.0", bar: "1.0.0" } }),
        );
        const manifest = await restorePackageManifest(
            cwd,
            snapshot,
            { foo: "2.0.0", bar: "2.0.0" },
            "failed",
            makeLogger(),
        );
        expect(manifest.dependencies).toEqual({ foo: "1.0.0" }); // foo 回滚，bar 删除
        const written = JSON.parse(await fsp.readFile(join(cwd, "package.json"), "utf8"));
        expect(written.dependencies).toEqual({ foo: "1.0.0" });
    });

    it("文件损坏时回退快照内容", async () => {
        await fsp.writeFile(join(cwd, "package.json"), "not json");
        const manifest = await restorePackageManifest(
            cwd,
            snapshot,
            { foo: "2.0.0" },
            "failed",
            makeLogger(),
        );
        expect(manifest.dependencies).toEqual({ foo: "1.0.0" });
    });
});

describe("resolveLocalDeps", () => {
    let dir: string;
    let cwd: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "resolve-local-deps-"));
        cwd = join(dir, "project");
        await fsp.mkdir(join(cwd, "node_modules", "koishi-plugin-chat"), { recursive: true });
        await fsp.writeFile(join(cwd, "package.json"), "{}");
        await fsp.writeFile(
            join(cwd, "node_modules", "koishi-plugin-chat", "package.json"),
            JSON.stringify({ name: "koishi-plugin-chat", version: "1.2.0" }),
        );
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("回填已装版本并按请求归类来源", () => {
        const deps = resolveLocalDeps(
            {
                "koishi-plugin-chat": "1.0.0",
                "koishi-plugin-echo": "^2.0.0",
                "local-pkg": "file:../local",
            },
            cwd,
        );
        expect(deps["koishi-plugin-chat"]).toMatchObject({
            request: "1.0.0",
            resolved: "1.2.0",
            workspace: false,
            source: "registry",
            local: false,
            bound: true,
        });
        expect(deps["koishi-plugin-echo"]).toMatchObject({
            request: "^2.0.0",
            source: "registry",
            local: false,
            bound: true,
        });
        expect(deps["local-pkg"]).toMatchObject({
            request: "file:../local",
            source: "file",
            local: true,
            bound: true,
        });
    });
});
