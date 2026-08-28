import { promises as fsp } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalPackageUploadStore } from "../session.js";
import {
    assertInside,
    createCanonicalLocalPackageFilename,
    inspectPackageArchive,
    readFileHash,
} from "../tar.js";

vi.mock("../tar.js", () => ({
    inspectPackageArchive: vi.fn(),
    createCanonicalLocalPackageFilename: vi.fn(),
    readFileHash: vi.fn(),
    assertInside: vi.fn(),
}));

const MANIFEST = { name: "koishi-plugin-demo", version: "1.0.0" };
const CHUNK = Buffer.from("0123456789").toString("base64");
const TARGET = "koishi-plugin-demo-1.0.0-abc123.tgz";

let dir: string;
let store: LocalPackageUploadStore;
let warn: (message: string) => void;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "market-upload-"));
    warn = vi.fn<(message: string) => void>();
    store = new LocalPackageUploadStore(dir, warn);
    vi.mocked(inspectPackageArchive).mockResolvedValue(MANIFEST as never);
    vi.mocked(createCanonicalLocalPackageFilename).mockReturnValue(TARGET);
    vi.mocked(readFileHash).mockResolvedValue(undefined);
    vi.mocked(assertInside).mockImplementation(() => {});
});

afterEach(async () => {
    await store.dispose(); // 关闭错误路径下残留的 FileHandle
    await rm(dir, { recursive: true, force: true });
    // restoreAllMocks:还原对 fsp 的 spyOn;clearAllMocks:清模块 mock 的调用记录
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe("LocalPackageUploadStore", () => {
    it("完整流程：start → append → finish → commit", async () => {
        const started = await store.start({ filename: "demo-1.0.0.tgz", size: 10 });
        expect(started.uploadId).toMatch(/^[0-9a-f-]{36}$/);
        expect(started.chunkSize).toBeGreaterThan(0);
        expect(started.maxSize).toBe(64 * 1024 * 1024);

        const progress = await store.append({
            uploadId: started.uploadId,
            index: 0,
            data: CHUNK,
        });
        expect(progress).toEqual({ received: 10, size: 10 });

        const finished = await store.finish({ uploadId: started.uploadId });
        expect(finished).toMatchObject({
            manifest: MANIFEST,
            filename: "demo-1.0.0.tgz",
            size: 10,
            targetFilename: TARGET,
        });
        expect(inspectPackageArchive).toHaveBeenCalledTimes(1);

        const committed = await store.commit(started.uploadId);
        expect(committed).toMatchObject({
            name: "koishi-plugin-demo",
            version: "1.0.0",
            filename: TARGET,
            request: `file:.yarn/local/${TARGET}`,
            size: 10,
        });
    });

    it("start 拒绝非法文件名", async () => {
        await expect(store.start({ filename: "a/b.tgz", size: 10 })).rejects.toThrow(
            "请选择 npm pack 生成的 .tgz 文件。",
        );
        await expect(store.start({ filename: "demo.tar", size: 10 })).rejects.toThrow(
            "请选择 npm pack 生成的 .tgz 文件。",
        );
    });

    it("start 拒绝非法大小", async () => {
        await expect(store.start({ filename: "demo.tgz", size: 0 })).rejects.toThrow(
            "本地插件归档大小必须在 1 B 到",
        );
        await expect(
            store.start({ filename: "demo.tgz", size: 64 * 1024 * 1024 + 1 }),
        ).rejects.toThrow("本地插件归档大小必须在 1 B 到");
        await expect(store.start({ filename: "demo.tgz", size: 1.5 })).rejects.toThrow(
            "本地插件归档大小必须在 1 B 到",
        );
    });

    it("append 校验分块顺序", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        await expect(
            store.append({ uploadId: started.uploadId, index: 1, data: CHUNK }),
        ).rejects.toThrow("分块顺序无效");
    });

    it("append 校验 base64 编码", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        await expect(
            store.append({ uploadId: started.uploadId, index: 0, data: "!!!not-base64" }),
        ).rejects.toThrow("分块编码无效");
    });

    it("append 拒绝超过剩余大小的分块", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 5 });
        await expect(
            store.append({ uploadId: started.uploadId, index: 0, data: CHUNK }),
        ).rejects.toThrow("分块大小无效");
    });

    it("finish 在未传完时拒绝", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        const partial = Buffer.from("01234").toString("base64");
        await store.append({ uploadId: started.uploadId, index: 0, data: partial });
        await expect(store.finish({ uploadId: started.uploadId })).rejects.toThrow("尚未上传完成");
    });

    it("commit 在未校验时拒绝", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        await store.append({ uploadId: started.uploadId, index: 0, data: CHUNK });
        await expect(store.commit(started.uploadId)).rejects.toThrow("请先完成本地插件归档校验");
    });

    it("非法 uploadId 拒绝", async () => {
        await expect(
            store.append({ uploadId: "not-a-uuid", index: 0, data: CHUNK }),
        ).rejects.toThrow("上传会话无效");
        await expect(store.finish({ uploadId: "not-a-uuid" })).rejects.toThrow("上传会话无效");
    });

    it("append 在已校验后拒绝", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        await store.append({ uploadId: started.uploadId, index: 0, data: CHUNK });
        await store.finish({ uploadId: started.uploadId });
        await expect(
            store.append({ uploadId: started.uploadId, index: 1, data: CHUNK }),
        ).rejects.toThrow("已经完成校验");
    });

    it("commit 遇同名不同内容时报错", async () => {
        vi.mocked(readFileHash).mockResolvedValue("different-hash");
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        await store.append({ uploadId: started.uploadId, index: 0, data: CHUNK });
        await store.finish({ uploadId: started.uploadId });
        await expect(store.commit(started.uploadId)).rejects.toThrow("文件内容不一致");
    });

    it("cancel 移除会话", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        expect(await store.cancel(started.uploadId)).toBe(true);
        expect(await store.cancel(started.uploadId)).toBe(false);
    });

    it("pruneExpired 清理过期会话", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        await store.pruneExpired(Date.now() + 15 * 60 * 1000 + 1);
        await expect(
            store.append({ uploadId: started.uploadId, index: 0, data: CHUNK }),
        ).rejects.toThrow("本地插件上传已过期");
    });

    it("pruneExpired 清理失败仅告警不抛出", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        vi.spyOn(fsp, "rm").mockRejectedValueOnce(new Error("EBUSY"));
        await expect(store.pruneExpired(Date.now() + 15 * 60 * 1000 + 1)).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(started.uploadId));
    });

    it("dispose 清理失败仅告警不抛出", async () => {
        await store.start({ filename: "demo.tgz", size: 10 });
        vi.spyOn(fsp, "rm").mockRejectedValueOnce(new Error("EBUSY"));
        await expect(store.dispose()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("failed to dispose"));
    });

    it("start 请求缺省时按非法文件名拒绝", async () => {
        await expect(store.start(undefined as never)).rejects.toThrow(
            "请选择 npm pack 生成的 .tgz 文件",
        );
    });

    it("append 请求缺省/非整数序号/空块/超限块均拒绝", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        await expect(store.append(undefined as never)).rejects.toThrow("本地插件上传会话无效");
        await expect(
            store.append({ uploadId: started.uploadId, index: 0.5, data: CHUNK }),
        ).rejects.toThrow("分块顺序无效");
        await expect(
            store.append({ uploadId: started.uploadId, index: 0, data: "" }),
        ).rejects.toThrow("分块大小无效");
        // 解码后超过单块上限(512 KiB),但 base64 长度仍在编码校验上限内
        const oversized = Buffer.alloc(512 * 1024 + 4).toString("base64");
        await expect(
            store.append({ uploadId: started.uploadId, index: 0, data: oversized }),
        ).rejects.toThrow("分块大小无效");
    });

    it("uploadId 形态合法但无对应会话时报过期", async () => {
        await expect(
            store.append({
                uploadId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEFFFF0000",
                index: 0,
                data: CHUNK,
            }),
        ).rejects.toThrow("本地插件上传已过期");
    });

    it("finish 幂等:重复调用复用校验结果", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        await store.append({ uploadId: started.uploadId, index: 0, data: CHUNK });
        const first = await store.finish({ uploadId: started.uploadId });
        const second = await store.finish({ uploadId: started.uploadId });
        expect(second).toEqual(first);
        expect(inspectPackageArchive).toHaveBeenCalledTimes(1);
    });

    it("finish 校验失败即销毁会话,不可继续操作", async () => {
        vi.mocked(inspectPackageArchive).mockRejectedValueOnce(new Error("bad archive"));
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        await store.append({ uploadId: started.uploadId, index: 0, data: CHUNK });
        await expect(store.finish({ uploadId: started.uploadId })).rejects.toThrow("bad archive");
        await expect(store.finish({ uploadId: started.uploadId })).rejects.toThrow("已过期");
        await expect(store.cancel(started.uploadId)).resolves.toBe(false);
    });

    it("commit 真实落盘到 .yarn/local 并销毁会话", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        await store.append({ uploadId: started.uploadId, index: 0, data: CHUNK });
        await store.finish({ uploadId: started.uploadId });
        const committed = await store.commit(started.uploadId);

        const target = resolve(dir, ".yarn", "local", committed.filename);
        await expect(fsp.readFile(target)).resolves.toEqual(Buffer.from("0123456789"));
        // 会话已销毁:重复 commit 报过期
        await expect(store.commit(started.uploadId)).rejects.toThrow("已过期");
        expect(await store.cancel(started.uploadId)).toBe(false);
    });

    it("cancel 后会话立即不可用", async () => {
        const started = await store.start({ filename: "demo.tgz", size: 10 });
        expect(await store.cancel(started.uploadId)).toBe(true);
        await expect(
            store.append({ uploadId: started.uploadId, index: 0, data: CHUNK }),
        ).rejects.toThrow("本地插件上传已过期");
    });
});
