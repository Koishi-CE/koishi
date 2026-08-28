import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteStatsBook } from "../../../racing/stats.js";
import { MarketDiskCache } from "../index.js";

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(
        tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })),
    );
});

async function createCache(content?: unknown) {
    const cwd = await fsp.mkdtemp(resolve(tmpdir(), "market-cache-"));
    tempDirs.push(cwd);
    const cacheFile = resolve(cwd, "market.json");
    if (content !== undefined) await fsp.writeFile(cacheFile, JSON.stringify(content));
    const cache = new MarketDiskCache({
        cacheFile,
        cacheDir: cwd,
        stats: new RouteStatsBook({
            fastThreshold: 500,
            successClamp: [-4, 3],
            failureClamp: [-4, 3],
            failurePenalty: () => 1,
            cooldown: () => 0,
            roundAverage: false,
            trackFailureMeta: false,
        }),
        scoreContext: () => ({ config: { endpoint: "https://primary.example" } }) as never,
        endpointCandidates: () => ["https://primary.example", "https://backup.example"],
        log: { debug: vi.fn(), warn: vi.fn() },
        isAlive: () => true,
    });
    return { cache, cwd };
}

describe("MarketDiskCache.load", () => {
    it("缺少缓存文件时返回空 store", async () => {
        const { cache } = await createCache();

        await expect(cache.load()).resolves.toEqual({
            store: { version: 3, entries: {} },
            applied: undefined,
            shouldMigrate: false,
        });
    });

    it("加载主端点内联缓存并标记迁移", async () => {
        const { cache } = await createCache({
            endpoint: "https://primary.example",
            fetchedAt: 100,
            result: { objects: [{ name: "demo" }] },
        });

        const loaded = await cache.load();

        expect(loaded.shouldMigrate).toBe(true);
        expect(loaded.applied?.endpoint).toBe("https://primary.example");
        expect(loaded.applied?.result.objects).toHaveLength(1);
        expect(cache.result?.objects[0]).toMatchObject({ name: "demo" });
    });

    it("恢复 split cache 条目和近期路由统计", async () => {
        const { cache, cwd } = await createCache({
            version: 3,
            entries: {
                "https://primary.example": {
                    endpoint: "https://primary.example",
                    fetchedAt: Date.now(),
                    file: "primary.json",
                },
            },
            routeStats: {
                "https://primary.example": {
                    score: 9,
                    averageElapsed: 120,
                    lastSuccess: Date.now(),
                    consecutiveFailures: 2,
                },
            },
        });
        await fsp.writeFile(
            resolve(cwd, "primary.json"),
            JSON.stringify({ objects: [{ name: "primary" }] }),
        );

        const loaded = await cache.load();

        expect(loaded.shouldMigrate).toBe(false);
        expect(loaded.applied?.result.objects[0]).toMatchObject({ name: "primary" });
    });
});
