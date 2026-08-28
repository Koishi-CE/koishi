/**
 * @file 市场快照的 gzip 编码与暂存(market 域)。
 *
 * 模块职责:
 * - MarketSnapshotTransport:把 market 快照的 data 部分 JSON 序列化 +
 *   gzip(level 6),按内容 sha256 作为 id 暂存,供 HTTP 路由按 id 下发;
 * - create 产出 MarketSnapshotTransfer 描述(http-gzip transport 的 URL 与
 *   尺寸信息),同内容请求复用已编码条目。
 *
 * 关键设计:
 * - id = sha256(json):内容寻址,天然去重,配合 ETag/immutable 缓存头
 *   可让前端永久缓存同一份快照;
 * - 编码任务按 id 单飞:并发请求同一快照时只压缩一次;
 * - LRU 式保留最近 MAX_MARKET_SNAPSHOTS(6)份编码结果,更旧的直接淘汰,
 *   内存占用可控(每份是完整市场索引的 gzip)。
 *
 * 架构位置:node 适配层 market 模块,由 console listener market/index 在
 * client 请求 http-gzip transport 时调用;HTTP 路由(market/index)按 id
 * 取条目下发。
 */
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import type { Context } from "@koishi-ce/koishi";
import type { MarketPayload, MarketSnapshotTransfer } from "../../shared/types.js";

const gzip = promisify(gzipCallback);
/** 最多暂存的编码快照份数:超出按插入顺序淘汰最旧。 */
const MAX_MARKET_SNAPSHOTS = 6;

/** 一份已编码的快照:id(内容 hash)、gzip body 与编解码两侧尺寸。 */
interface EncodedMarketSnapshot {
    id: string;
    body: Buffer;
    decodedSize: number;
    encodedSize: number;
}

/**
 * gzip 市场快照传输：market/index 的 http-gzip transport 走 HTTP 路由下发，
 * ETag = 内容 hash，Cache-Control immutable。
 */
export class MarketSnapshotTransport {
    /** 进行中的编码任务(按 id 单飞:并发同内容请求只压缩一次)。 */
    private tasks = new Map<string, Promise<EncodedMarketSnapshot>>();
    /** 已完成的编码条目(id -> 条目,插入序即新旧序)。 */
    private entries = new Map<string, EncodedMarketSnapshot>();

    private readonly ctx: Context;
    private readonly route: string;

    constructor(ctx: Context, route: string) {
        this.ctx = ctx;
        this.route = route;
    }

    /**
     * 为快照产出传输描述:按 data 内容 sha256 寻址,命中暂存直接复用,
     * 否则压缩一次(同 id 并发请求共享同一任务)。返回给 client 的
     * payload 剥掉 data 本体,只带 URL 与尺寸,由 client 再走 HTTP 拉取。
     */
    async create(snapshot: MarketPayload): Promise<MarketSnapshotTransfer> {
        const data = snapshot.data ?? {};
        const json = JSON.stringify(data);
        const id = createHash("sha256").update(json).digest("hex");
        let entry = this.entries.get(id);
        if (!entry) {
            let task = this.tasks.get(id);
            if (!task) {
                task = this.encode(id, json).finally(() => this.tasks.delete(id));
                this.tasks.set(id, task);
            }
            entry = await task;
        }
        const { data: _, ...payload } = snapshot;
        return {
            transport: "http-gzip",
            url: `${this.route}/${entry.id}`,
            payload,
            decodedSize: entry.decodedSize,
            encodedSize: entry.encodedSize,
        };
    }

    /** 按 id 取已编码条目(HTTP 路由下发用);不存在返回 undefined。 */
    get(id: string) {
        return this.entries.get(id);
    }

    /** 清空全部编码条目与进行中任务(市场数据全量重置时调用)。 */
    clear() {
        this.tasks.clear();
        this.entries.clear();
    }

    /** 实际压缩并暂存:gzip level 6(速度/压缩率折中),超出上限淘汰最旧条目。 */
    private async encode(id: string, json: string) {
        const start = Date.now();
        const decodedSize = Buffer.byteLength(json);
        const body = (await gzip(Buffer.from(json), { level: 6 })) as Buffer;
        const entry = { id, body, decodedSize, encodedSize: body.length };
        this.entries.set(id, entry);
        while (this.entries.size > MAX_MARKET_SNAPSHOTS) {
            const oldest = this.entries.keys().next().value;
            if (!oldest) break;
            this.entries.delete(oldest);
        }
        this.ctx
            .logger("market")
            .debug(
                `prepared console market snapshot: id=${id}, decoded=${decodedSize}, gzip=${body.length}, elapsed=${Date.now() - start}ms`,
            );
        return entry;
    }
}
