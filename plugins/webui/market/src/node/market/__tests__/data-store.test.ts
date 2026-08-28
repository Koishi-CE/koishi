/**
 * data-store.ts 单测:readMarketDataStore 只读入口 + MarketDataStore
 * (DataService 真实基类)的加载/patch 防抖/串行化写盘/迁移/析构落盘。
 *
 * 策略:writeJsonAtomic 全程 mock(计数与断内容),文件读取用真实 fsp +
 * 真实 timers + 短 sleep(避免 fake timers 推不动 libuv I/O 的坑)。
 */
import { promises as fsp } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeJsonAtomic } from "../../../core/utils/atomic-write.js";
import { MarketDataStore, readMarketDataStore } from "../data-store.js";
import { createMockContext, createTempDir, dataFilePath, type MockContext } from "./helpers.js";

vi.mock("../../../core/utils/atomic-write.js", () => ({ writeJsonAtomic: vi.fn() }));

const writeMock = vi.mocked(writeJsonAtomic);

/** 等真实 fsp I/O 与防抖定时器(setTimeout 0)完成的最小等待。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

let dir = "";
let cleanup: () => Promise<void> = async () => {};
let ctx: MockContext;

beforeEach(async () => {
    const temp = await createTempDir();
    dir = temp.dir;
    cleanup = temp.cleanup;
    ctx = createMockContext({ baseDir: dir });
    writeMock.mockReset();
});

afterEach(async () => {
    // 析构所有 store:清掉未触发的防抖定时器,避免上个用例的写盘
    // 延迟落进下个用例的 writeMock 计数里(偶发污染源)
    ctx.close();
    await settle();
    await cleanup();
});

/** 直接在 data 目录写一份原始 JSON 文件(load/readMarketDataStore 的输入)。 */
async function writeStoreFile(content: string) {
    const file = dataFilePath(dir, "market-next.json");
    await mkdir(dirname(file), { recursive: true });
    await fsp.writeFile(file, content, "utf8");
}

describe("readMarketDataStore", () => {
    it("正常读取并归一化文件内容", async () => {
        await writeStoreFile(
            JSON.stringify({
                override: { "koishi-plugin-foo": "1.0.0" },
                updateIgnored: { "koishi-plugin-bar": 123 },
                bundleRecords: { "koishi-plugin-pa-demo": { package: "koishi-plugin-pa-demo" } },
                collapsedGroups: { "group:pa-demo": true },
            }),
        );

        const store = await readMarketDataStore(ctx.asContext());

        expect(store).toEqual({
            override: { "koishi-plugin-foo": "1.0.0" },
            updateIgnored: { "koishi-plugin-bar": 123 },
            bundleRecords: { "koishi-plugin-pa-demo": { package: "koishi-plugin-pa-demo" } },
            collapsedGroups: { "group:pa-demo": true },
        });
        expect(ctx.log.warn).not.toHaveBeenCalled();
    });

    it("文件缺失(ENOENT)回退空存储且不告警", async () => {
        const store = await readMarketDataStore(ctx.asContext());

        expect(store).toEqual({
            override: {},
            updateIgnored: {},
            bundleRecords: {},
            collapsedGroups: {},
        });
        expect(ctx.log.warn).not.toHaveBeenCalled();
    });

    it("损坏 JSON 回退空存储并 warn", async () => {
        await writeStoreFile("{ not valid json");

        const store = await readMarketDataStore(ctx.asContext());

        expect(store.override).toEqual({});
        expect(ctx.log.warn).toHaveBeenCalledTimes(1);
        expect(vi.mocked(ctx.log.warn).mock.calls[0]?.[0]).toContain(
            "failed to read market-next data store",
        );
    });

    it("normalizeStore 防御:非对象内容与坏字段类型都回退空", async () => {
        await writeStoreFile(JSON.stringify({ override: [], updateIgnored: null }));
        const store = await readMarketDataStore(ctx.asContext());
        expect(store).toEqual({
            override: {},
            updateIgnored: {},
            bundleRecords: {},
            collapsedGroups: {},
        });

        ctx = createMockContext({ baseDir: dir });
        await writeStoreFile("null");
        expect(await readMarketDataStore(ctx.asContext())).toEqual({
            override: {},
            updateIgnored: {},
            bundleRecords: {},
            collapsedGroups: {},
        });
    });
});

describe("MarketDataStore", () => {
    it("构造走真实 DataService 基类:immediate 服务名为 console.services.marketData", () => {
        const store = new MarketDataStore(ctx.asContext());
        expect(ctx.provide).toHaveBeenCalledWith("console.services.marketData");
        expect((store as unknown as { name: string }).name).toBe("console.services.marketData");
    });

    it("文件缺失时首次 get() 返回空 payload 且不写盘", async () => {
        const store = new MarketDataStore(ctx.asContext());

        expect(await store.get()).toEqual({
            override: {},
            updateIgnored: {},
            bundleRecords: {},
            collapsedGroups: {},
        });
        await settle();
        expect(writeMock).not.toHaveBeenCalled();
        expect(ctx.log.warn).not.toHaveBeenCalled();
    });

    it("首次加载读到文件内容(get 阻塞到 ready 之后)", async () => {
        await writeStoreFile(
            JSON.stringify({ override: { foo: "1.0.0" }, collapsedGroups: { g1: true } }),
        );
        const store = new MarketDataStore(ctx.asContext());

        expect(await store.get()).toMatchObject({
            override: { foo: "1.0.0" },
            collapsedGroups: { g1: true },
        });
    });

    it("构造期文件损坏只 warn 不抛,get 返回空存储", async () => {
        await writeStoreFile("broken");
        new MarketDataStore(ctx.asContext());
        await settle();

        expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    });

    it("patch 合并四类 dict 并广播+防抖写盘", async () => {
        const store = new MarketDataStore(ctx.asContext());
        await store.get();

        const snapshot = await store.patch({
            override: { foo: "1.0.0" },
            updateIgnored: { bar: { until: 123 } },
            bundleRecords: {},
            collapsedGroups: { g1: true },
        });
        expect(snapshot.override).toEqual({ foo: "1.0.0" });
        expect(snapshot.collapsedGroups).toEqual({ g1: true });

        // 广播 marketData 通道快照
        expect(ctx.console.broadcast).toHaveBeenCalledWith(
            "patch",
            expect.objectContaining({ key: "marketData" }),
            expect.objectContaining({ authority: 4 }),
        );

        await settle();
        expect(writeMock).toHaveBeenCalledTimes(1);
        expect(writeMock.mock.calls[0]?.[0]).toBe(dataFilePath(dir, "market-next.json"));
        expect(writeMock.mock.calls[0]?.[1]).toEqual({
            override: { foo: "1.0.0" },
            updateIgnored: { bar: { until: 123 } },
            bundleRecords: {},
            collapsedGroups: { g1: true },
            collapsedGroupsVersion: 0,
        });
        expect(writeMock.mock.calls[0]?.[2]).toEqual({ indent: 2, newline: false });
    });

    it("patch 中 normalizeDict:坏类型字段回退空 dict", async () => {
        const store = new MarketDataStore(ctx.asContext());
        await store.get();

        // 故意传坏类型(数组/null)验证 normalizeDict 防御
        const snapshot = await store.patch({ override: null, updateIgnored: [] } as never);
        expect(snapshot.override).toEqual({});
        expect(snapshot.updateIgnored).toEqual({});
    });

    it("patch 空对象是幂等 no-op:不广播不写盘", async () => {
        const store = new MarketDataStore(ctx.asContext());
        await store.get();

        await store.patch({});

        expect(ctx.console.broadcast).not.toHaveBeenCalled();
        await settle();
        expect(writeMock).not.toHaveBeenCalled();
    });

    it("防抖合并:同一 tick 连续两次 patch 只写一次盘", async () => {
        const store = new MarketDataStore(ctx.asContext());
        await store.get();

        await store.patch({ override: { a: "1" } });
        await store.patch({ override: { b: "2" } });
        await settle();

        expect(writeMock).toHaveBeenCalledTimes(1);
        expect(writeMock.mock.calls[0]?.[1]).toMatchObject({ override: { b: "2" } });
    });

    it("写盘失败不抛只 warn", async () => {
        writeMock.mockRejectedValueOnce(new Error("disk full"));
        const store = new MarketDataStore(ctx.asContext());
        await store.get();

        await expect(store.patch({ override: { a: "1" } })).resolves.toBeDefined();
        await settle();

        expect(ctx.log.warn).toHaveBeenCalledWith(
            expect.stringContaining("failed to write market-next data store"),
        );
    });

    it("写盘串行化:在途写未完成时的变更先置 pending,完成后重放一次", async () => {
        let releaseFirstWrite: (() => void) | undefined;
        writeMock.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseFirstWrite = resolve;
                }),
        );
        const store = new MarketDataStore(ctx.asContext());
        await store.get();

        // 第一次 patch 触发防抖定时器 → flushWrite → write 挂起
        await store.patch({ override: { a: "1" } });
        await settle();
        expect(writeMock).toHaveBeenCalledTimes(1);

        // 写盘期间再次 patch:新定时器到点后只置 pending,不叠加写
        await store.patch({ override: { a: "2" } });
        await settle();
        expect(writeMock).toHaveBeenCalledTimes(1);

        // 释放第一个写任务:finally 检测 pending 重放,第二个写带最新数据
        releaseFirstWrite?.();
        await settle();
        expect(writeMock).toHaveBeenCalledTimes(2);
        expect(writeMock.mock.calls[1]?.[1]).toMatchObject({ override: { a: "2" } });
    });

    it("setBundleRecord 立即落盘(不经防抖)并广播", async () => {
        const store = new MarketDataStore(ctx.asContext());
        await store.get();

        const snapshot = await store.setBundleRecord({
            package: "koishi-plugin-pa-demo",
            version: "1.0.0",
            installedAt: 1,
            members: [],
        });

        expect(snapshot.bundleRecords["koishi-plugin-pa-demo"]).toMatchObject({
            package: "koishi-plugin-pa-demo",
        });
        expect(writeMock).toHaveBeenCalledTimes(1);
        expect(ctx.console.broadcast).toHaveBeenCalled();
        await settle();
        // 立即落盘已取消防抖定时器,不会再补写
        expect(writeMock).toHaveBeenCalledTimes(1);
    });

    it("flushWriteNow 会先等在途写任务结束再补写最新数据", async () => {
        let releaseFirstWrite: (() => void) | undefined;
        writeMock.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseFirstWrite = resolve;
                }),
        );
        const store = new MarketDataStore(ctx.asContext());
        await store.get();

        // 第一笔:防抖到期后写盘挂起
        await store.patch({ override: { a: "1" } });
        await settle();
        expect(writeMock).toHaveBeenCalledTimes(1);

        // 第二笔:setBundleRecord 的立即落盘需先等在途写任务
        const pending = store.setBundleRecord({
            package: "koishi-plugin-pa-demo",
            version: "1.0.0",
            installedAt: 1,
            members: [],
        });
        releaseFirstWrite?.();
        await pending;

        expect(writeMock).toHaveBeenCalledTimes(2);
        expect(writeMock.mock.calls[1]?.[1]).toMatchObject({
            override: { a: "1" },
            bundleRecords: { "koishi-plugin-pa-demo": { package: "koishi-plugin-pa-demo" } },
        });
    });

    it("析构时取消防抖定时器并强制落盘一次", async () => {
        const store = new MarketDataStore(ctx.asContext());
        await store.get();

        await store.patch({ override: { a: "1" } });
        ctx.close();
        await settle();

        expect(writeMock).toHaveBeenCalledTimes(1);
        expect(writeMock.mock.calls[0]?.[1]).toMatchObject({ override: { a: "1" } });
    });

    describe("migrateFromConfig", () => {
        it("各键只在文件没有时迁入,并清理废弃 installed 键+持久化版本号", async () => {
            const store = new MarketDataStore(ctx.asContext());
            await store.get();

            await store.migrateFromConfig({
                updateIgnored: { foo: { until: 100 } },
                bundleRecords: {
                    "koishi-plugin-pa-demo": {
                        package: "x",
                        version: "1",
                        installedAt: 1,
                        members: [],
                    },
                },
                collapsedGroups: { installed: true, g1: false },
            });

            // patch 走防抖但 migrate 尾部 flushWriteNow 会取消定时器直接写,共一次
            expect(writeMock).toHaveBeenCalledTimes(1);
            const payload = writeMock.mock.calls[0]?.[1] as Record<string, unknown>;
            expect(payload["updateIgnored"]).toEqual({ foo: { until: 100 } });
            expect(payload["bundleRecords"]).toEqual({
                "koishi-plugin-pa-demo": {
                    package: "x",
                    version: "1",
                    installedAt: 1,
                    members: [],
                },
            });
            expect(payload["collapsedGroups"]).toEqual({ g1: false });
            expect(payload["collapsedGroupsVersion"]).toBe(1);
        });

        it("文件已有对应数据时不迁入覆盖", async () => {
            await writeStoreFile(JSON.stringify({ updateIgnored: { existing: 1 } }));
            const store = new MarketDataStore(ctx.asContext());
            await store.get();

            await store.migrateFromConfig({ updateIgnored: { fresh: { until: 2 } } });

            expect(await store.get()).toMatchObject({ updateIgnored: { existing: 1 } });
            // collapsedGroups 版本清理仍执行(版本 0 → 1),仍然落盘一次
            expect(writeMock).toHaveBeenCalledTimes(1);
        });

        it("文件已有 collapsedGroups 键时不迁移配置侧值,版本达标后不再执行清理", async () => {
            await writeStoreFile(
                JSON.stringify({
                    collapsedGroups: { installed: true, keep: true },
                    collapsedGroupsVersion: 1,
                }),
            );
            const store = new MarketDataStore(ctx.asContext());
            await store.get();

            await store.migrateFromConfig({ collapsedGroups: { installed: false, other: true } });

            // 已有状态不覆盖 + 版本已达标:patch 为空、无需落盘
            expect(await store.get()).toMatchObject({
                collapsedGroups: { installed: true, keep: true },
            });
            expect(writeMock).not.toHaveBeenCalled();
        });

        it("config 全空且版本达标时不产生任何写盘", async () => {
            await writeStoreFile(JSON.stringify({ collapsedGroupsVersion: 1 }));
            const store = new MarketDataStore(ctx.asContext());
            await store.get();

            await store.migrateFromConfig({});

            expect(writeMock).not.toHaveBeenCalled();
        });
    });
});
