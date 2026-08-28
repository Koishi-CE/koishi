import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    createEnvironmentSnapshot,
    EnvironmentSnapshotStore,
    summarizeEnvironmentSnapshot,
} from "../snapshot.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");

describe("createEnvironmentSnapshot", () => {
    it("相同依赖产生稳定 id，不同依赖产生不同 id", () => {
        const deps = { foo: { request: "^1.0.0", resolved: "1.2.0" } };
        const first = createEnvironmentSnapshot(deps, "startup", undefined, NOW);
        const second = createEnvironmentSnapshot(deps, "startup", undefined, NOW);
        expect(first.id).toBe(second.id);
        expect(first.id).toMatch(/^env-[0-9a-f]{20}$/);
        const different = createEnvironmentSnapshot(
            { foo: { request: "^1.0.0", resolved: "1.3.0" } },
            "startup",
            undefined,
            NOW,
        );
        expect(different.id).not.toBe(first.id);
    });

    it("归一化：键排序、source 补全、可选字段去空", () => {
        const snapshot = createEnvironmentSnapshot(
            {
                z: { request: "koishi-plugin-z", resolved: "" },
                a: { request: "file:../a", source: "file", local: true },
                b: { request: "^1.0.0" },
            },
            "startup",
            "op-1",
            NOW,
        );
        expect(Object.keys(snapshot.dependencies)).toEqual(["a", "b", "z"]);
        expect(snapshot.dependencies["a"]).toMatchObject({
            request: "file:../a",
            source: "file",
            local: true,
        });
        expect(snapshot.dependencies["b"]).toMatchObject({
            request: "^1.0.0",
            source: "registry",
        });
        expect(snapshot.dependencies["z"]).toMatchObject({
            request: "koishi-plugin-z",
            resolved: undefined,
        });
        expect(snapshot.source).toBe("startup");
        expect(snapshot.operationId).toBe("op-1");
        expect(snapshot.createdAt).toBe(NOW);
    });
});

describe("summarizeEnvironmentSnapshot", () => {
    it("统计依赖数并标记 current", () => {
        const snapshot = createEnvironmentSnapshot(
            { a: { request: "1.0.0" }, b: { request: "2.0.0" } },
            "startup",
            undefined,
            NOW,
        );
        expect(summarizeEnvironmentSnapshot(snapshot, snapshot.id)).toMatchObject({
            id: snapshot.id,
            dependencyCount: 2,
            current: true,
        });
        expect(summarizeEnvironmentSnapshot(snapshot, "env-other").current).toBe(false);
    });
});

describe("EnvironmentSnapshotStore", () => {
    let dir: string;

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    async function makeStore() {
        dir = await mkdtemp(join(tmpdir(), "env-snapshot-"));
        return new EnvironmentSnapshotStore(join(dir, "snapshots.json"), () => {});
    }

    it("record 持久化并可 list/get", async () => {
        const store = await makeStore();
        const snapshot = createEnvironmentSnapshot({ a: { request: "1.0.0" } }, "startup");
        await store.record(snapshot);
        expect(await store.list()).toHaveLength(1);
        expect((await store.get(snapshot.id))?.id).toBe(snapshot.id);
    });

    it("相同 id 去重并合并 operation 元数据", async () => {
        const store = await makeStore();
        await store.record(
            createEnvironmentSnapshot({ a: { request: "1.0.0" } }, "startup", undefined, 1000),
        );
        await store.record(
            createEnvironmentSnapshot({ a: { request: "1.0.0" } }, "operation", "op-1", 2000),
        );
        const list = await store.list();
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ source: "operation", operationId: "op-1" });
        expect(list[0]!.lastSeenAt).toBe(2000);
    });

    it("超过上限时只保留最近 60 条", async () => {
        const store = await makeStore();
        for (let i = 0; i < 65; i++) {
            await store.record(
                createEnvironmentSnapshot({ [`pkg${i}`]: { request: "1.0.0" } }, "startup"),
            );
        }
        const list = await store.list();
        expect(list).toHaveLength(60);
    });
});
