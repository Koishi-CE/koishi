/**
 * snapshot-transport.ts 单测:gzip 编码可回解、内容寻址复用、同 id 并发单飞、
 * get/clear、LRU 上限(6 份)淘汰最旧。
 *
 * gzip 是真实压缩(异步无 I/O 副作用),直接用真实 timers;压缩次数经
 * ctx.logger("market").debug 的调用次数观测(encode 每次压缩打一条)。
 */
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { MarketPayload } from "../../../shared/types.js";
import { MarketSnapshotTransport } from "../snapshot-transport.js";
import { createMockContext, type MockContext } from "./helpers.js";

const gunzipAsync = promisify(gunzip);

const ROUTE = "/market-next/snapshot";

/** sha256(json) 内容寻址 id,与被测模块的派生方式对齐。 */
function expectedId(data: unknown) {
    return createHash("sha256")
        .update(JSON.stringify(data ?? {}))
        .digest("hex");
}

function payloadOf(data: unknown): MarketPayload {
    // fixture data 是任意 JSON 对象(测试不关心 SearchObject 内部结构)
    return { total: 1, failed: 0, progress: 1, data: data as MarketPayload["data"] };
}

function setup() {
    const ctx: MockContext = createMockContext();
    return { ctx, transport: new MarketSnapshotTransport(ctx.asContext(), ROUTE) };
}

describe("MarketSnapshotTransport", () => {
    it("create:gzip 编码可回解,url 按内容寻址,尺寸与描述正确", async () => {
        const { ctx, transport } = setup();
        const data = { "koishi-plugin-foo": { name: "koishi-plugin-foo" } };
        const json = JSON.stringify(data);

        const transfer = await transport.create(payloadOf(data));

        const id = expectedId(data);
        expect(transfer.transport).toBe("http-gzip");
        expect(transfer.url).toBe(`${ROUTE}/${id}`);
        expect(transfer.decodedSize).toBe(Buffer.byteLength(json));
        // payload 剥掉 data 本体,其余字段原样保留
        expect(transfer.payload).toEqual({ total: 1, failed: 0, progress: 1 });
        expect(Object.hasOwn(transfer.payload, "data" as never)).toBe(false);

        // get 按 id 取条目并 gunzip 回解出原文
        const entry = transport.get(id);
        expect(entry).toBeDefined();
        expect(entry?.encodedSize).toBe(entry?.body.length);
        expect((await gunzipAsync(entry!.body)).toString("utf8")).toBe(json);
        expect(ctx.log.debug).toHaveBeenCalledTimes(1);
        expect(vi.mocked(ctx.log.debug).mock.calls[0]?.[0]).toContain(`id=${id}`);
    });

    it("data 缺省时按空对象编码", async () => {
        const { transport } = setup();

        const transfer = await transport.create(payloadOf(undefined));

        expect(transfer.decodedSize).toBe(2); // "{}"
        expect((await gunzipAsync(transport.get(expectedId(undefined))!.body)).toString()).toBe(
            "{}",
        );
    });

    it("同内容重复 create 复用已编码条目,不再压缩", async () => {
        const { ctx, transport } = setup();
        const data = { a: 1 };

        const first = await transport.create(payloadOf(data));
        const second = await transport.create(payloadOf(data));

        expect(second.url).toBe(first.url);
        expect(second.decodedSize).toBe(first.decodedSize);
        expect(ctx.log.debug).toHaveBeenCalledTimes(1);
    });

    it("同 id 并发请求单飞:共享同一编码任务只压缩一次", async () => {
        const { ctx, transport } = setup();
        const data = { b: 2 };

        const [first, second] = await Promise.all([
            transport.create(payloadOf(data)),
            transport.create(payloadOf(data)),
        ]);

        expect(second.url).toBe(first.url);
        expect(ctx.log.debug).toHaveBeenCalledTimes(1);
    });

    it("get 未命中返回 undefined", () => {
        const { transport } = setup();
        expect(transport.get("nonexistent")).toBeUndefined();
    });

    it("clear 清掉条目后同内容会重新压缩", async () => {
        const { ctx, transport } = setup();
        const data = { c: 3 };

        await transport.create(payloadOf(data));
        expect(ctx.log.debug).toHaveBeenCalledTimes(1);

        transport.clear();
        expect(transport.get(expectedId(data))).toBeUndefined();

        await transport.create(payloadOf(data));
        expect(ctx.log.debug).toHaveBeenCalledTimes(2);
    });

    it("LRU:超过 6 份编码时按插入顺序淘汰最旧", async () => {
        const { transport } = setup();
        const ids: string[] = [];
        for (let i = 0; i < 7; i++) {
            const data = { seq: i };
            await transport.create(payloadOf(data));
            ids.push(expectedId(data));
        }

        // 最旧的第 1 份被淘汰,其余仍在
        expect(transport.get(ids[0]!)).toBeUndefined();
        for (const id of ids.slice(1)) {
            expect(transport.get(id)).toBeDefined();
        }
        // 再压一份,淘汰第 2 份
        const eighth = { seq: 7 };
        await transport.create(payloadOf(eighth));
        expect(transport.get(ids[1]!)).toBeUndefined();
        expect(transport.get(expectedId(eighth))).toBeDefined();
    });
});
