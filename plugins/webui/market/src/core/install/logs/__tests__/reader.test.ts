import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getInstallHistory, getInstallLogDetail } from "../reader.js";
import { getInstallLogDir } from "../retention.js";

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(
        tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })),
    );
});

async function createReaderFixture(content: string, id = "2026-01-01T00-00-00-demo.log") {
    const cwd = await fsp.mkdtemp(resolve(tmpdir(), "marketn-reader-"));
    tempDirs.push(cwd);
    const dir = getInstallLogDir(cwd);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(resolve(dir, id), content);
    return {
        cwd,
        id,
        deps: {
            cwd,
            log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            activeFile: () => undefined,
            waitForWrite: async () => {},
            cleanup: async () => {},
        },
    };
}

describe("install log reader", () => {
    it("读取 legacy 成功日志并计算时长", async () => {
        const fixture = await createReaderFixture(
            [
                "startedAt: 2026-01-01T00:00:00.000Z",
                "deps: koishi@4.0.0",
                "forced: true",
                "installEndpoint: https://registry.example",
                "[2026-01-01T00:00:02.000Z] [stdout] dependency operation finished with code 0",
            ].join("\n"),
        );

        const [entry] = await getInstallHistory(20, fixture.deps);

        expect(entry).toMatchObject({
            id: fixture.id,
            status: "success",
            startedAt: Date.parse("2026-01-01T00:00:00.000Z"),
            finishedAt: Date.parse("2026-01-01T00:00:02.000Z"),
            duration: 2000,
            deps: "koishi@4.0.0",
            forced: true,
            installEndpoint: "https://registry.example",
        });
    });

    it("识别 legacy 错误日志并返回详情", async () => {
        const fixture = await createReaderFixture(
            [
                "startedAt: 2026-01-01T00:00:00.000Z",
                "deps: (none)",
                "forced: false",
                "installEndpoint: (default)",
                "[2026-01-01T00:00:01.000Z] [stderr] package manager failed to start",
            ].join("\n"),
        );

        const detail = await getInstallLogDetail(fixture.id, fixture.deps);

        expect(detail?.status).toBe("error");
        expect(detail?.content).toContain("package manager failed to start");
        expect(detail?.installEndpoint).toBeUndefined();
    });

    it("优先读取有效 metadata", async () => {
        const fixture = await createReaderFixture("legacy content");
        await fsp.writeFile(
            `${resolve(getInstallLogDir(fixture.cwd), fixture.id)}.json`,
            JSON.stringify({
                version: 1,
                id: fixture.id,
                startedAt: 100,
                status: "success",
                deps: "metadata-deps",
                forced: false,
                changes: [],
            }),
        );

        const [entry] = await getInstallHistory(20, fixture.deps);

        expect(entry).toMatchObject({ status: "success", deps: "metadata-deps", startedAt: 100 });
    });
});
