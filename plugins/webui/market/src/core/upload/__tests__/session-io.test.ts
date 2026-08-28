import { promises as fsp } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    decodeBase64Chunk,
    formatUploadBytes,
    LOCAL_UPLOAD_CHUNK_SIZE,
    placeUploadArchive,
    sweepTemporaryUploads,
    validateUploadFilename,
} from "../session-io.js";
import { makeTempDir } from "./helpers.js";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir("market-io-"));
});

afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
});

describe("validateUploadFilename", () => {
    it("接受合法的 .tgz basename(含大写扩展名)", () => {
        expect(validateUploadFilename("demo-1.0.0.tgz")).toBe("demo-1.0.0.tgz");
        expect(validateUploadFilename("Demo.TGZ")).toBe("Demo.TGZ");
    });

    it("拒绝非字符串", () => {
        expect(() => validateUploadFilename(undefined)).toThrow("请选择 npm pack 生成的 .tgz 文件");
        expect(() => validateUploadFilename(123)).toThrow("请选择 npm pack 生成的 .tgz 文件");
    });

    it("拒绝带路径分隔的文件名", () => {
        expect(() => validateUploadFilename("a/b.tgz")).toThrow("请选择 npm pack 生成的 .tgz 文件");
        expect(() => validateUploadFilename("..\\demo.tgz")).toThrow(
            "请选择 npm pack 生成的 .tgz 文件",
        );
    });

    it("拒绝非 .tgz 后缀", () => {
        expect(() => validateUploadFilename("demo.tar")).toThrow(
            "请选择 npm pack 生成的 .tgz 文件",
        );
        expect(() => validateUploadFilename("demo.tgz.bak")).toThrow(
            "请选择 npm pack 生成的 .tgz 文件",
        );
    });
});

describe("decodeBase64Chunk", () => {
    it("解码合法分块", () => {
        const buffer = decodeBase64Chunk(Buffer.from("market-next").toString("base64"));
        expect(buffer.toString("utf8")).toBe("market-next");
    });

    it("接受空串(编码为空 Buffer,长度校验由上层做)", () => {
        expect(decodeBase64Chunk("").length).toBe(0);
    });

    it("拒绝非字符串与非法字符", () => {
        expect(() => decodeBase64Chunk(undefined)).toThrow("本地插件上传分块编码无效");
        expect(() => decodeBase64Chunk(123)).toThrow("本地插件上传分块编码无效");
        expect(() => decodeBase64Chunk("!!!not-base64")).toThrow("本地插件上传分块编码无效");
        // 含 url-safe 字母表(-)同样拒绝
        expect(() => decodeBase64Chunk("ab-cd")).toThrow("本地插件上传分块编码无效");
    });

    it("拒绝长度非 4 倍数的编码", () => {
        expect(() => decodeBase64Chunk("abcde")).toThrow("本地插件上传分块编码无效");
    });

    it("拒绝超过单块上限的编码", () => {
        const limit = Math.ceil(LOCAL_UPLOAD_CHUNK_SIZE / 3) * 4 + 4;
        // 生成超出上限 4 字符的合法 base64(round-trip 一致)
        const oversized = Buffer.alloc(LOCAL_UPLOAD_CHUNK_SIZE + 64).toString("base64");
        expect(oversized.length).toBeGreaterThan(limit);
        expect(() => decodeBase64Chunk(oversized)).toThrow("本地插件上传分块编码无效");
    });

    it("拒绝 round-trip 不一致的畸形 padding", () => {
        // "AB==" 解码后再编码得到 "AA==",与输入不一致
        expect(() => decodeBase64Chunk("AB==")).toThrow("本地插件上传分块编码无效");
    });
});

describe("formatUploadBytes", () => {
    it("各级单位与向上取整", () => {
        expect(formatUploadBytes(0)).toBe("0 B");
        expect(formatUploadBytes(1023)).toBe("1023 B");
        expect(formatUploadBytes(1024)).toBe("1 KiB");
        expect(formatUploadBytes(1025)).toBe("2 KiB");
        expect(formatUploadBytes(1024 * 1024 - 1)).toBe("1024 KiB");
        expect(formatUploadBytes(1024 * 1024)).toBe("1 MiB");
        expect(formatUploadBytes(1024 * 1024 + 1)).toBe("2 MiB");
    });
});

describe("sweepTemporaryUploads", () => {
    it("目录不存在时静默完成", async () => {
        await expect(
            sweepTemporaryUploads(join(dir, "missing"), new Set(), Date.now(), 1000),
        ).resolves.toBeUndefined();
    });

    it("目录路径指向文件时(非 ENOENT 错误)向上抛出", async () => {
        const blocked = join(dir, "blocked");
        await writeFile(blocked, "x");
        await expect(sweepTemporaryUploads(blocked, new Set(), Date.now(), 1000)).rejects.toThrow();
    });

    it("只删除过期且不属于活跃会话的 .part 文件", async () => {
        const root = join(dir, "tmp");
        await mkdir(root);
        const activePath = join(root, "active.part");
        const stalePath = join(root, "stale.part");
        const freshPath = join(root, "fresh.part");
        const otherFile = join(root, "keep.txt");
        const subDir = join(root, "sub.part");
        for (const path of [activePath, stalePath, freshPath, otherFile]) {
            await writeFile(path, "x");
        }
        await mkdir(subDir);

        const now = Date.now();
        // 把 stale 的 mtime 拨回 TTL 之前
        await fsp.utimes(stalePath, new Date(now - 10_000), new Date(now - 10_000));
        await sweepTemporaryUploads(root, new Set([activePath]), now, 5000);

        await expect(fsp.stat(stalePath)).rejects.toMatchObject({ code: "ENOENT" });
        for (const kept of [activePath, freshPath, otherFile, subDir]) {
            await expect(fsp.stat(kept)).resolves.toBeTypeOf("object");
        }
    });
});

describe("placeUploadArchive", () => {
    async function prepare(content = "archive-bytes") {
        const sessionPath = join(dir, "session.part");
        await writeFile(sessionPath, content);
        return { sessionPath, content };
    }

    /** 内容 sha256(与 placeUploadArchive 的哈希口径一致)。 */
    async function sha256(content: string) {
        const { createHash } = await import("node:crypto");
        return createHash("sha256").update(content).digest("hex");
    }

    it("目标不存在时 rename 落位并返回目标路径", async () => {
        const { sessionPath, content } = await prepare();
        const hash = await sha256(content);
        const target = await placeUploadArchive(dir, sessionPath, "demo-1.0.0.tgz", hash);
        expect(target).toBe(resolve(dir, "demo-1.0.0.tgz"));
        await expect(fsp.readFile(target, "utf8")).resolves.toBe(content);
        await expect(fsp.stat(sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("目标已存在且内容一致时幂等复用", async () => {
        const { sessionPath, content } = await prepare();
        const hash = await sha256(content);
        const targetPath = resolve(dir, "demo-1.0.0.tgz");
        await writeFile(targetPath, content);
        const target = await placeUploadArchive(dir, sessionPath, "demo-1.0.0.tgz", hash);
        expect(target).toBe(targetPath);
        await expect(fsp.stat(sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("目标已存在但内容不一致时拒绝覆盖", async () => {
        const { sessionPath, content } = await prepare();
        const hash = await sha256(content);
        const targetPath = resolve(dir, "demo-1.0.0.tgz");
        await writeFile(targetPath, "different-content");
        await expect(placeUploadArchive(dir, sessionPath, "demo-1.0.0.tgz", hash)).rejects.toThrow(
            "同名本地插件归档已存在，但文件内容不一致。",
        );
    });

    it("目标路径越界被拒绝", async () => {
        const { sessionPath } = await prepare();
        await expect(
            placeUploadArchive(dir, sessionPath, "..\\evil.tgz", "a".repeat(64)),
        ).rejects.toThrow("本地插件归档目标路径无效");
        await expect(
            placeUploadArchive(dir, sessionPath, "sub/demo.tgz", "a".repeat(64)),
        ).rejects.toThrow("本地插件归档目标路径无效");
    });

    it("目标是目录时报错", async () => {
        const { sessionPath, content } = await prepare();
        const hash = await sha256(content);
        await mkdir(resolve(dir, "demo-1.0.0.tgz"));
        await expect(placeUploadArchive(dir, sessionPath, "demo-1.0.0.tgz", hash)).rejects.toThrow(
            "本地插件归档目标不是文件",
        );
    });

    it("rename 失败但并发落位内容一致时复用", async () => {
        const { sessionPath, content } = await prepare();
        const hash = await sha256(content);
        const targetPath = resolve(dir, "demo-1.0.0.tgz");
        const spy = vi.spyOn(fsp, "rename").mockImplementation(async () => {
            // 模拟并发会话先一步落位了同内容文件
            await writeFile(targetPath, content);
            throw Object.assign(new Error("EEXIST: race"), { code: "EEXIST" });
        });
        const target = await placeUploadArchive(dir, sessionPath, "demo-1.0.0.tgz", hash);
        expect(target).toBe(targetPath);
        await expect(fsp.stat(sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
        spy.mockRestore();
    });

    it("rename 失败且目标并未出现时抛原错误", async () => {
        const { sessionPath, content } = await prepare();
        const hash = await sha256(content);
        const spy = vi
            .spyOn(fsp, "rename")
            .mockRejectedValue(Object.assign(new Error("EPERM: denied"), { code: "EPERM" }));
        await expect(placeUploadArchive(dir, sessionPath, "demo-1.0.0.tgz", hash)).rejects.toThrow(
            "EPERM: denied",
        );
        // 会话文件保留(调用方可重试)
        await expect(fsp.stat(sessionPath)).resolves.toBeTypeOf("object");
        spy.mockRestore();
    });
});
