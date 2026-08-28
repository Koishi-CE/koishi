/**
 * manifest.ts 单测:本地 manifest 解析(loadManifest/resolvePackageManifest)、
 * 版本摘要(getVersions)、探针挑选、插件名归一与兼容版本过滤。
 * 文件 IO 走真实临时目录,解析失败/坏 JSON 等分支用真实文件触发。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createScanner,
    filterCompatibleVersions,
    getVersions,
    loadManifest,
    pickMetadataProbe,
    type Registry,
    type RemotePackage,
    resolvePackageManifest,
    resolvePluginName,
    Scanner,
} from "../manifest.js";

/** 仓库根(用于解析真实安装的 vitest 包)。 */
const REPO_ROOT = process.cwd();

let tmp: string;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "registry-manifest-"));
});

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
});

/** 在指定目录写一个 package.json(自动建目录)。 */
function writePackageJson(dir: string, content: string) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), content, "utf8");
}

/** 最小 RemotePackage(仅填充被测代码读取的字段)。 */
function remote(version: string, peerDependencies?: Record<string, string>): RemotePackage {
    return { version, peerDependencies } as unknown as RemotePackage;
}

/** 由版本列表构造最小 Registry。 */
function registryOf(versions: RemotePackage[]): Registry {
    const map: Record<string, RemotePackage> = {};
    for (const item of versions) map[item.version] = item;
    return { versions: map } as unknown as Registry;
}

describe("loadManifest", () => {
    it("无 baseDir:从自身模块位置解析依赖包(node_modules 内,$workspace=false)", () => {
        const meta = loadManifest("vitest");
        expect(meta.name).toBe("vitest");
        expect(meta.$workspace).toBe(false);
        expect(meta.dependencies).toBeTypeOf("object");
    });

    it("baseDir 下 node_modules 包:保留 dependencies,$workspace=false", () => {
        writePackageJson(
            join(tmp, "node_modules", "demo-pkg"),
            JSON.stringify({
                name: "demo-pkg",
                version: "1.0.0",
                description: "",
                keywords: [],
                dependencies: { foo: "^1.0.0" },
            }),
        );
        const meta = loadManifest("demo-pkg", tmp);
        expect(meta.name).toBe("demo-pkg");
        expect(meta.$workspace).toBe(false);
        expect(meta.dependencies).toEqual({ foo: "^1.0.0" });
    });

    it("路径形态的 name(宿主 package.json):$workspace=true 且补空 dependencies", () => {
        writePackageJson(
            join(tmp, "host"),
            JSON.stringify({ name: "host", version: "1.0.0", description: "", keywords: [] }),
        );
        // Windows 下统一正斜杠,避免与 `${name}/package.json` 拼接出混合分隔符
        const hostDir = resolve(tmp, "host").replace(/\\/g, "/");
        const meta = loadManifest(hostDir);
        expect(meta.$workspace).toBe(true);
        expect(meta.dependencies).toEqual({});
    });

    it("坏 JSON 在解析阶段即抛错(ERR_INVALID_PACKAGE_CONFIG)", () => {
        writePackageJson(join(tmp, "node_modules", "bad-json"), "{ not valid json");
        // Node 的 resolver 在解析子路径时就校验 package.json,先于 loadManifest 的 JSON.parse
        expect(() => loadManifest("bad-json", tmp)).toThrow(
            expect.objectContaining({ code: "ERR_INVALID_PACKAGE_CONFIG" }),
        );
    });

    it("不存在的包抛 MODULE_NOT_FOUND", () => {
        expect(() => loadManifest("definitely-missing-pkg", tmp)).toThrow(
            expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
        );
    });
});

describe("resolvePackageManifest", () => {
    it("返回真实包的 package.json 路径", () => {
        const filename = resolvePackageManifest("vitest", REPO_ROOT);
        expect(filename).toContain("node_modules");
        expect(filename.endsWith("package.json")).toBe(true);
    });

    it("不存在的包抛 MODULE_NOT_FOUND", () => {
        expect(() => resolvePackageManifest("definitely-missing-pkg", tmp)).toThrow(
            expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
        );
    });
});

describe("getVersions", () => {
    it("按 semver 降序排列且只保留依赖元数据字段", () => {
        const result = getVersions([
            remote("1.0.0", { koishi: "^4.0.0" }),
            remote("2.0.0", { koishi: "^4.18.0" }),
            remote("1.5.0"),
        ]);
        expect(Object.keys(result)).toEqual(["2.0.0", "1.5.0", "1.0.0"]);
        expect(result["1.0.0"]).toEqual({ peerDependencies: { koishi: "^4.0.0" } });
        // 未提供的可选字段不出现在摘要里
        expect(result["1.5.0"]).toEqual({ peerDependencies: undefined });
    });

    it("保留 deprecated 标记", () => {
        const result = getVersions([
            { version: "1.0.0", deprecated: "use v2" } as unknown as RemotePackage,
        ]);
        expect(result["1.0.0"]).toEqual({ deprecated: "use v2", peerDependencies: undefined });
    });
});

describe("pickMetadataProbe", () => {
    it("优先级:koishi > console > 任意插件 > 首个", () => {
        expect(pickMetadataProbe(["foo", "koishi", "bar"])).toBe("koishi");
        expect(pickMetadataProbe(["foo", "@koishijs/plugin-console", "bar"])).toBe(
            "@koishijs/plugin-console",
        );
        expect(pickMetadataProbe(["foo", "koishi-plugin-chatgpt", "bar"])).toBe(
            "koishi-plugin-chatgpt",
        );
        expect(pickMetadataProbe(["foo", "bar"])).toBe("foo");
    });

    it("空列表返回 undefined", () => {
        expect(pickMetadataProbe([])).toBeUndefined();
    });
});

describe("resolvePluginName", () => {
    it("官方/社区全名原样返回,裸名展开为两个候选", () => {
        expect(resolvePluginName("@koishijs/plugin-foo")).toEqual(["@koishijs/plugin-foo"]);
        expect(resolvePluginName("koishi-plugin-foo")).toEqual(["koishi-plugin-foo"]);
        expect(resolvePluginName("@scope/koishi-plugin-foo")).toEqual(["@scope/koishi-plugin-foo"]);
        expect(resolvePluginName("foo")).toEqual(["@koishijs/plugin-foo", "koishi-plugin-foo"]);
    });

    it("scope 短名展开为 scope 下的插件名", () => {
        expect(resolvePluginName("@scope/foo")).toEqual(["@scope/koishi-plugin-foo"]);
    });
});

describe("filterCompatibleVersions", () => {
    it("koishi 本体只保留满足 4.x 的版本", () => {
        const result = filterCompatibleVersions(
            "koishi",
            registryOf([remote("4.17.0"), remote("3.0.0"), remote("5.0.0-alpha.1")]),
        );
        expect(Object.keys(result)).toEqual(["4.17.0"]);
    });

    it("插件包只保留 peerDependencies 兼容 koishi4 的版本", () => {
        const result = filterCompatibleVersions(
            "koishi-plugin-demo",
            registryOf([
                remote("2.0.0", { koishi: "^4.0.0" }),
                remote("1.0.0", { koishi: "^3.0.0" }),
                remote("0.9.0"),
            ]),
        );
        expect(Object.keys(result)).toEqual(["2.0.0"]);
    });

    it("非插件包不过滤,全量保留", () => {
        const result = filterCompatibleVersions(
            "lodash",
            registryOf([remote("4.17.0"), remote("3.0.0")]),
        );
        expect(Object.keys(result)).toEqual(["4.17.0", "3.0.0"]);
    });
});

describe("Scanner 静态与工厂", () => {
    it("Scanner 静态解包后可直接判定插件与兼容性", () => {
        expect(Scanner.isPlugin("koishi-plugin-foo")).toBe(true);
        expect(Scanner.isPlugin("@koishijs/plugin-foo")).toBe(true);
        expect(Scanner.isPlugin("lodash")).toBe(false);
        expect(Scanner.isCompatible("^4.0.0", remote("1.0.0", { koishi: "^4.18.0" }))).toBe(true);
        expect(Scanner.isCompatible("^4.0.0", remote("1.0.0", { koishi: "^3.0.0" }))).toBe(false);
    });

    it("createScanner 构造出带初始进度的扫描器实例", () => {
        const scanner = createScanner(vi.fn());
        expect(scanner.progress).toBe(0);
        expect(scanner.total).toBeUndefined();
        expect(scanner.collect).toBeTypeOf("function");
        expect(scanner.analyze).toBeTypeOf("function");
    });
});
