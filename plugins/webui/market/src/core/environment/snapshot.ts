/**
 * @file 环境快照:持久化存储(core/environment 域)。
 *
 * 环境快照记录某一时刻宿主全部依赖的请求/已装版本/来源分类,是回滚的
 * 依据:EnvironmentSnapshotStore 负责防抖落盘(上限 60 条,按 lastSeenAt
 * 淘汰),快照在安装前后(startup/operation/external 三种来源)各记一次。
 *
 * 架构位置:被 install/orchestrator(capture/record)与 install/environment
 * (回滚预览)消费;diff/apply 逻辑在邻文件,类型与纯函数(归一化、
 * 构建、摘要)拆至 snapshot-model.ts,本文件只管存取。
 */
import { promises as fsp } from "node:fs";
import { writeJsonAtomic } from "../utils/atomic-write.js";
import {
    type EnvironmentSnapshot,
    MAX_SNAPSHOTS,
    type PersistedEnvironmentSnapshotStore,
} from "./snapshot-model.js";

export type {
    EnvironmentDependencySnapshot,
    EnvironmentSnapshot,
    EnvironmentSnapshotSource,
    EnvironmentSnapshotSummary,
} from "./snapshot-model.js";
export { createEnvironmentSnapshot, summarizeEnvironmentSnapshot } from "./snapshot-model.js";

/** 环境快照的防抖落盘存储（上限 MAX_SNAPSHOTS）。 */
export class EnvironmentSnapshotStore {
    private readonly filename: string;
    private readonly onError: (message: string) => void;
    /** 惰性且单飞的文件加载 */
    private loaded?: Promise<void>;
    /** 写任务链:所有写操作串行排队,读侧等待 */
    private writeTask = Promise.resolve();
    private value: PersistedEnvironmentSnapshotStore = { version: 1, snapshots: [] };

    constructor(filename: string, onError: (message: string) => void) {
        this.filename = filename;
        this.onError = onError;
    }

    /** 惰性加载快照文件:损坏/不存在时回退空库(ENOENT 不算错误)。 */
    private async load() {
        if (!this.loaded) {
            this.loaded = (async () => {
                try {
                    const parsed = JSON.parse(
                        await fsp.readFile(this.filename, "utf8"),
                    ) as PersistedEnvironmentSnapshotStore;
                    if (parsed?.version !== 1 || !Array.isArray(parsed.snapshots))
                        throw new Error("invalid snapshot store");
                    // 逐条过滤缺 id/依赖表的坏条目,避免单条损坏拖垮整库
                    this.value = {
                        version: 1,
                        snapshots: parsed.snapshots.filter(
                            (snapshot) => snapshot?.id && snapshot?.dependencies,
                        ),
                    };
                } catch (error) {
                    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
                        this.onError(
                            `failed to read environment snapshots: ${error instanceof Error ? error.message : error}`,
                        );
                    }
                    this.value = { version: 1, snapshots: [] };
                }
            })();
        }
        await this.loaded;
    }

    /** 等待加载与全部排队中的写任务(保证读到最新落盘内容)。 */
    private async waitForWrites() {
        await this.load();
        await this.writeTask;
    }

    /** 原子写整库(临时文件 + rename)。 */
    private async persist() {
        await writeJsonAtomic(this.filename, this.value, { indent: 2 });
    }

    /**
     * 记录快照:同 id(同内容)已存在则只刷新 lastSeenAt(operation 来源
     * 还会补记来源与日志 id),否则插到队首;随后按 lastSeenAt 排序、
     * 截断到上限并落盘。写操作串行排在 writeTask 链上,互不交错。
     */
    async record(snapshot: EnvironmentSnapshot) {
        await this.load();
        let result!: EnvironmentSnapshot;
        const task = this.writeTask.then(async () => {
            const existing = this.value.snapshots.find((item) => item.id === snapshot.id);
            if (existing) {
                existing.lastSeenAt = snapshot.lastSeenAt || Date.now();
                if (snapshot.source === "operation") {
                    existing.source = snapshot.source;
                    existing.operationId = snapshot.operationId;
                }
                result = existing;
            } else {
                this.value.snapshots.unshift(snapshot);
                result = snapshot;
            }
            this.value.snapshots.sort(
                (a, b) => (b.lastSeenAt ?? b.createdAt) - (a.lastSeenAt ?? a.createdAt),
            );
            this.value.snapshots.splice(MAX_SNAPSHOTS);
            await this.persist();
        });
        // 链尾吞掉错误只上报,不阻断后续写任务
        this.writeTask = task.catch((error) => {
            this.onError(
                `failed to write environment snapshots: ${error instanceof Error ? error.message : error}`,
            );
        });
        await task;
        return result;
    }

    /** 列出全部快照(副本,按 lastSeenAt 降序)。 */
    async list() {
        await this.waitForWrites();
        return [...this.value.snapshots];
    }

    /** 按 id 取单个快照(找不到为 undefined)。 */
    async get(id: string) {
        await this.waitForWrites();
        return this.value.snapshots.find((snapshot) => snapshot.id === id);
    }
}
