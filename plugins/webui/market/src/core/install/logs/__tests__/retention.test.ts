import { promises as fsp } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR } from "../../../utils/time.js";
import type { InstallLogger } from "../../types.js";
import {
    getInstallLogDir,
    getInstallLogPath,
    getInstallLogRetention,
    InstallLogRetention,
} from "../retention.js";

function makeLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies InstallLogger;
}

describe("getInstallLogPath", () => {
    it("拼接 data 目录下的 .log 文件", () => {
        expect(getInstallLogPath("cwd", "foo.log")).toBe(
            resolve("cwd", "data", "market-next-install-logs", "foo.log"),
        );
    });

    it("拒绝非法 id（无 .log 后缀 / 路径穿越）", () => {
        expect(getInstallLogPath("cwd", "foo")).toBeUndefined();
        expect(getInstallLogPath("cwd", "../evil.log")).toBeUndefined();
        expect(getInstallLogPath("cwd", "a/b.log")).toBeUndefined();
        expect(getInstallLogPath("cwd", "")).toBeUndefined();
    });
});

describe("getInstallLogRetention", () => {
    it("默认 3 天", () => {
        expect(getInstallLogRetention({})).toBe(3 * 24 * HOUR);
    });

    it("installLogRetentionHours 优先且至少 1 小时", () => {
        expect(getInstallLogRetention({ installLogRetentionHours: 2 })).toBe(2 * HOUR);
        expect(getInstallLogRetention({ installLogRetentionHours: 0.5 })).toBe(HOUR);
    });

    it("legacy installLogRetention 至少 1 小时", () => {
        expect(getInstallLogRetention({ installLogRetention: 3600_000 })).toBe(HOUR);
        expect(getInstallLogRetention({ installLogRetention: 5000 })).toBe(HOUR);
        expect(getInstallLogRetention({ installLogRetention: 5 * HOUR })).toBe(5 * HOUR);
    });

    it("非法值回退默认", () => {
        expect(getInstallLogRetention({ installLogRetentionHours: -1 })).toBe(3 * 24 * HOUR);
        expect(getInstallLogRetention({ installLogRetention: -1 })).toBe(3 * 24 * HOUR);
    });
});

describe("InstallLogRetention.cleanup", () => {
    let dir: string;
    let logDir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "install-log-retention-"));
        logDir = getInstallLogDir(dir);
        await fsp.mkdir(logDir, { recursive: true });
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("删除超过保留时长的日志，保留活跃会话与新鲜日志", async () => {
        const now = Date.now();
        const oldFile = join(logDir, "old.log");
        const oldMeta = join(logDir, "old.log.json");
        const freshFile = join(logDir, "fresh.log");
        const activeFile = join(logDir, "active.log");
        for (const file of [oldFile, oldMeta, freshFile, activeFile]) {
            await fsp.writeFile(file, "content");
        }
        const oldTime = new Date(now - 2 * HOUR);
        await fsp.utimes(oldFile, oldTime, oldTime);
        await fsp.utimes(oldMeta, oldTime, oldTime);
        await fsp.utimes(activeFile, oldTime, oldTime); // 旧但活跃

        const retention = new InstallLogRetention(dir, () => HOUR, makeLogger());
        await retention.cleanup(activeFile);

        expect(await fsp.readdir(logDir)).toEqual(["active.log", "fresh.log"]);
    });

    it("目录不存在时静默返回", async () => {
        await rm(logDir, { recursive: true, force: true });
        const retention = new InstallLogRetention(dir, () => HOUR, makeLogger());
        await expect(retention.cleanup()).resolves.toBeUndefined();
    });
});
