import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    assertInside,
    createCanonicalLocalPackageFilename,
    inspectPackageArchive,
    readFileHash,
} from "../tar.js";
import {
    buildTarBuffer,
    DEMO_MANIFEST,
    makeTempDir,
    type TarEntrySpec,
    writeTgz,
} from "./helpers.js";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir("market-tar-"));
});

afterEach(async () => {
    await cleanup();
});

/** 打包 specs 并落盘为 .tgz,返回文件路径。 */
async function pack(specs: TarEntrySpec[], filename = "demo-1.0.0.tgz") {
    return writeTgz(dir, filename, buildTarBuffer(specs));
}

describe("inspectPackageArchive", () => {
    it("解析合法归档的根部 manifest", async () => {
        const path = await pack([
            { name: "package/package.json", content: DEMO_MANIFEST },
            { name: "package/index.js", content: "export const apply = () => {}" },
            { name: "package/lib", typeflag: "5" },
        ]);
        await expect(inspectPackageArchive(path)).resolves.toMatchObject({
            name: "koishi-plugin-demo",
            version: "1.0.0",
        });
    });

    it("缺少 package/package.json 时报错", async () => {
        const path = await pack([{ name: "package/index.js", content: "x" }]);
        await expect(inspectPackageArchive(path)).rejects.toThrow(
            "本地插件归档中缺少 package/package.json",
        );
    });

    it("根之外的 package.json 不被认作 manifest", async () => {
        const path = await pack([{ name: "package/nested/package.json", content: DEMO_MANIFEST }]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("缺少 package/package.json");
    });

    it("损坏的 gzip 内容（截断）报读取错误", async () => {
        const { gzipSync } = await import("node:zlib");
        const path = join(dir, "broken.tgz");
        const full = gzipSync(
            buildTarBuffer([{ name: "package/package.json", content: DEMO_MANIFEST }]),
        );
        await writeFile(path, full.subarray(0, 40));
        await expect(inspectPackageArchive(path)).rejects.toThrow("无法读取本地插件归档");
    });

    it("坏校验和的 tar 头报读取错误", async () => {
        const path = await pack([
            { name: "package/package.json", content: DEMO_MANIFEST, corruptChecksum: true },
        ]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("无法读取本地插件归档");
    });

    it("条目数据被截断（声明大小超出实际内容）报读取错误", async () => {
        const path = await pack([
            { name: "package/package.json", content: DEMO_MANIFEST },
            { name: "package/index.js", declaredSize: 4096 },
        ]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("无法读取本地插件归档");
    });

    it("package.json 不是合法 JSON 时报错", async () => {
        const path = await pack([{ name: "package/package.json", content: "{oops" }]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("不是有效的 JSON");
    });

    it("package.json 解析结果非对象时报错", async () => {
        const nullPath = await pack([{ name: "package/package.json", content: "null" }]);
        await expect(inspectPackageArchive(nullPath)).rejects.toThrow("本地插件 package.json 无效");
        const numberPath = await pack([{ name: "package/package.json", content: "42" }]);
        await expect(inspectPackageArchive(numberPath)).rejects.toThrow(
            "本地插件 package.json 无效",
        );
    });

    it("包名不是 Koishi 插件时报错", async () => {
        const path = await pack([
            {
                name: "package/package.json",
                content: JSON.stringify({ name: "foo", version: "1.0.0" }),
            },
        ]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("不是有效的 Koishi 插件名称");
    });

    it("版本不是合法 SemVer 时报错", async () => {
        const path = await pack([
            {
                name: "package/package.json",
                content: JSON.stringify({ name: "koishi-plugin-demo", version: "not-semver" }),
            },
        ]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("不是有效的 SemVer");
    });

    it.each([
        ["相对路径穿越", "../evil.txt"],
        ["绝对路径", "/etc/passwd"],
        ["缺少 package 前缀", "outside/file.txt"],
        ["反斜杠穿越", "..\\evil.txt"],
        ["package 内的 .. 段", "package/sub/../../evil.txt"],
    ])("非法路径(%s)触发防护", async (_label, name) => {
        const path = await pack([
            { name: "package/package.json", content: DEMO_MANIFEST },
            { name, content: "x" },
        ]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("包含非法路径");
    });

    it("符号链接条目触发类型防护", async () => {
        const path = await pack([
            { name: "package/package.json", content: DEMO_MANIFEST },
            { name: "package/link", typeflag: "2", linkname: "../../target" },
        ]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("不允许的条目类型");
    });

    it("重复的根部 package.json 触发防护", async () => {
        const path = await pack([
            { name: "package/package.json", content: DEMO_MANIFEST },
            { name: "package/package.json", content: DEMO_MANIFEST },
        ]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("重复的 package.json");
    });

    it("零字节的 package.json 触发大小防护", async () => {
        const path = await pack([{ name: "package/package.json", content: "" }]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("package.json 大小无效");
    });

    it("声明超过 1 MiB 的 package.json 触发大小防护", async () => {
        const path = await pack([
            { name: "package/package.json", content: DEMO_MANIFEST, declaredSize: 1024 * 1024 + 1 },
        ]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("package.json 大小无效");
    });

    it("单个条目声明超大体积触发解压炸弹防护", async () => {
        const path = await pack([
            { name: "package/package.json", content: DEMO_MANIFEST },
            { name: "package/blob.bin", declaredSize: 256 * 1024 * 1024 + 1 },
        ]);
        await expect(inspectPackageArchive(path)).rejects.toThrow("解压后内容过大或文件数量过多");
    });

    it("海量条目触发数量上限防护", async () => {
        // 8193 个零字节文件条目(gzip 后极小),第 8193 个触发条目数上限
        const specs: TarEntrySpec[] = [{ name: "package/package.json", content: DEMO_MANIFEST }];
        for (let i = 0; i < 8192; i++) specs.push({ name: `package/f${i}`, content: "" });
        const path = await pack(specs);
        await expect(inspectPackageArchive(path)).rejects.toThrow("解压后内容过大或文件数量过多");
    });
});

describe("createCanonicalLocalPackageFilename", () => {
    it("普通包名:名称-版本-hash 前 12 位", () => {
        expect(
            createCanonicalLocalPackageFilename("koishi-plugin-demo", "1.0.0", "a".repeat(64)),
        ).toBe("koishi-plugin-demo-1.0.0-aaaaaaaaaaaa.tgz");
    });

    it("scope 包名压平成 a-b 形态", () => {
        expect(
            createCanonicalLocalPackageFilename(
                "@scope/koishi-plugin-demo",
                "2.0.0",
                "0123456789abcdef",
            ),
        ).toBe("scope-koishi-plugin-demo-2.0.0-0123456789ab.tgz");
    });

    it("文件名不安全字符(连续多字符)替换为单个连字符", () => {
        expect(
            createCanonicalLocalPackageFilename("koishi-plugin-中文Demo", "1.0.0", "a".repeat(12)),
        ).toBe("koishi-plugin--Demo-1.0.0-aaaaaaaaaaaa.tgz");
    });

    it("超长 slug 截断到 120 字符", () => {
        const name = `koishi-plugin-${"x".repeat(200)}`;
        const filename = createCanonicalLocalPackageFilename(name, "1.0.0", "a".repeat(12));
        expect(filename.length).toBe(120 + "-1.0.0-aaaaaaaaaaaa.tgz".length);
    });
});

describe("readFileHash", () => {
    it("文件不存在返回 undefined", async () => {
        expect(await readFileHash(join(dir, "missing.tgz"))).toBeUndefined();
    });

    it("返回内容的 sha256 hex", async () => {
        const content = Buffer.from("hello market-next");
        const path = join(dir, "file.tgz");
        await writeFile(path, content);
        expect(await readFileHash(path)).toBe(createHash("sha256").update(content).digest("hex"));
    });

    it("目标是目录时报错", async () => {
        const path = join(dir, "adir.tgz");
        await mkdir(path);
        await expect(readFileHash(path)).rejects.toThrow("本地插件归档目标不是文件");
    });
});

describe("assertInside", () => {
    it("root 直下目标通过", () => {
        const root = resolve(dir);
        expect(() => assertInside(root, resolve(root, "a.tgz"))).not.toThrow();
    });

    it("越出 root 的目标被拒绝", () => {
        const root = resolve(dir);
        expect(() => assertInside(root, resolve(dir, "..", "a.tgz"))).toThrow(
            "本地插件归档目标路径无效",
        );
        expect(() => assertInside(root, resolve(dir, "nested", "a.tgz"))).toThrow(
            "本地插件归档目标路径无效",
        );
    });
});
