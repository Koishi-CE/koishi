/**
 * @file marketData 通道与 market-next.json 数据文件的持久化存储(market 域)。
 *
 * 模块职责:MarketDataStore(DataService 子类)向 console 广播并持久化
 * override/updateIgnored/bundleRecords/collapsedGroups 四类数据到
 * baseDir/data/market-next.json;readMarketDataStore 是纯只读兜底入口;
 * migrateFromConfig 把旧版本存在 koishi.yml 里的数据一次性迁入(patch
 * 计算是纯函数,出仓 migrate.ts;内容归一化出仓 normalize.ts)。
 *
 * 关键设计:该文件是这些数据的唯一权威存储(迁出 koishi.yml 是为了改配置
 * 不再触发插件 reload);写盘合并为微任务防抖、写任务串行化并在完成时重放
 * pending 标记;读取全部经 normalize 防御,文件损坏时回退空存储而非抛错。
 *
 * 架构位置:声明为 console 服务 marketData(authority 4),被 listeners、
 * bundle.ts、commands.ts 消费。
 */
import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import { DataService } from "@koishi-ce/console";
import type { Context, Dict } from "@koishi-ce/koishi";
import { writeJsonAtomic } from "../../core/utils/atomic-write.js";
import type { PluginBundleRecord } from "../../shared/bundle.js";
import type { UpdateIgnoreRule } from "../../shared/update.js";
import { buildMigrationPatch, type MarketMigrationConfig } from "./migrate.js";
import { normalizeDict, normalizeStore } from "./normalize.js";

/** market-next.json 的完整负载形态(也是 marketData 通道的下发形态)。 */
export interface MarketDataStorePayload {
    /** 覆盖安装的版本(包名 -> 精确版本) */
    override: Dict<string>;
    /** 更新忽略规则(包名 -> 过期时间或结构化规则) */
    updateIgnored: Dict<string | UpdateIgnoreRule>;
    /** 合包安装记录(包名 -> 最近一次安装回放) */
    bundleRecords: Dict<PluginBundleRecord>;
    /** 分组折叠状态(分组键 -> 是否折叠) */
    collapsedGroups: Dict<boolean>;
}

/** 空存储工厂:保证每个 dict 都是全新对象,避免共享引用被误改。 */
const emptyStore = (): MarketDataStorePayload => ({
    override: {},
    updateIgnored: {},
    bundleRecords: {},
    collapsedGroups: {},
});

/** 只读读取 market-next 数据文件（升级命令兜底路径）。 */
export async function readMarketDataStore(ctx: Context): Promise<MarketDataStorePayload> {
    const file = resolve(ctx.baseDir, "data", "market-next.json");
    try {
        return normalizeStore(JSON.parse(await fsp.readFile(file, "utf8")));
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
            ctx.logger("market").warn(
                `failed to read market-next data store: ${error instanceof Error ? error.message : error}`,
            );
        }
        return emptyStore();
    }
}

/** marketData 通道：override / updateIgnored / bundleRecords / collapsedGroups 的持久化存储。 */
export class MarketDataStore extends DataService<MarketDataStorePayload> {
    /** 数据文件绝对路径(baseDir/data/market-next.json)。 */
    private file: string;
    /** 内存中的权威数据(所有读写都以它为准,写盘是异步投影)。 */
    private data = emptyStore();
    /** 首次加载任务:get/patch 都先 await 它,避免读到空数据。 */
    private ready: Promise<void> | undefined;
    /** 进行中的写盘任务(串行化写:同一时刻至多一个 write)。 */
    private writeTask: Promise<void> | undefined;
    /** 防抖定时器:合并同一 tick 内的多次 patch 为一次写盘。 */
    private writeTimer: NodeJS.Timeout | undefined;
    /** 写盘期间又有新数据写入的标记(写完后自动重放一次)。 */
    private writePending = false;
    /** 文件里是否出现过 collapsedGroups 键(区分"没这状态"与"空状态")。 */
    private hasCollapsedGroupsState = false;
    /** collapsedGroups 迁移版本号(见 migrate.ts 的 COLLAPSED_GROUPS_VERSION)。 */
    private collapsedGroupsVersion = 0;

    constructor(ctx: Context) {
        // immediate: 客户端一连接就能拿到数据;authority 4: 仅管理员可见
        super(ctx, "marketData", { immediate: true, authority: 4 });
        this.file = resolve(ctx.baseDir, "data", "market-next.json");
        this.ready = this.load();
        ctx.effect(() => () => {
            // 析构:取消防抖定时器,等加载完成后把内存数据最终落盘一次
            if (this.writeTimer) clearTimeout(this.writeTimer);
            void this.ready?.then(() => this.write());
        });
    }

    /** 通道取数:先等首次加载完成,再返回四类数据的浅拷贝快照。 */
    override async get() {
        await this.ready;
        return this.snapshot();
    }

    /**
     * 通道/market-update-data 的落点:按键整体替换(非深合并),替换后
     * 立即向 console 广播新快照并调度防抖写盘。patch 不含任何已知键时
     * 是幂等 no-op。
     */
    override async patch(patch: Partial<MarketDataStorePayload>) {
        await this.ready;
        let changed = false;
        const keys = ["override", "updateIgnored", "bundleRecords", "collapsedGroups"] as const;
        for (const key of keys) {
            if (!Object.hasOwn(patch, key)) continue;
            this.data[key] = normalizeDict(patch[key]);
            if (key === "collapsedGroups") this.hasCollapsedGroupsState = true;
            changed = true;
        }
        if (!changed) return this.snapshot();
        this.scheduleWrite();
        super.patch(this.snapshot());
        return this.snapshot();
    }

    /**
     * 写入/覆盖单个合包安装记录并立即落盘(不走防抖):安装是低频关键操作,
     * 记录丢失会导致卸载/管理对话框无法回放,值得一次同步写。
     */
    async setBundleRecord(record: PluginBundleRecord) {
        await this.ready;
        this.data.bundleRecords ||= {};
        this.data.bundleRecords[record.package] = record;
        const snapshot = this.snapshot();
        super.patch(snapshot);
        await this.flushWriteNow();
        return snapshot;
    }

    /**
     * 从 koishi.yml 旧配置一次性迁入数据:patch 计算是纯函数(buildMigrationPatch,
     * 见 migrate.ts);版本号清理执行后先回写再应用 patch,最后立即落盘防止
     * 重复执行。
     */
    async migrateFromConfig(config: MarketMigrationConfig) {
        await this.ready;
        const { patch, migratedVersion } = buildMigrationPatch(
            {
                updateIgnored: this.data.updateIgnored,
                bundleRecords: this.data.bundleRecords,
                collapsedGroups: this.data.collapsedGroups,
                hasCollapsedGroupsState: this.hasCollapsedGroupsState,
                collapsedGroupsVersion: this.collapsedGroupsVersion,
            },
            config,
        );
        if (migratedVersion !== undefined) this.collapsedGroupsVersion = migratedVersion;
        if (Object.keys(patch).length) await this.patch(patch);
        if (migratedVersion !== undefined) await this.flushWriteNow();
    }

    /** 深浅拷贝快照:每个 dict 单独浅拷贝,广播出去的对象与内部状态隔离。 */
    private snapshot(): MarketDataStorePayload {
        return {
            override: { ...this.data.override },
            updateIgnored: { ...this.data.updateIgnored },
            bundleRecords: { ...this.data.bundleRecords },
            collapsedGroups: { ...this.data.collapsedGroups },
        };
    }

    /**
     * 首次加载:读文件、记录 collapsedGroups 的存在性与迁移版本号。
     * 文件缺失(首次运行)静默回退空存储;损坏只 warn,不让插件起不来。
     */
    private async load() {
        try {
            const content = await fsp.readFile(this.file, "utf8");
            const value = JSON.parse(content);
            this.hasCollapsedGroupsState = Object.hasOwn(value, "collapsedGroups");
            this.collapsedGroupsVersion = Number.isInteger(value?.collapsedGroupsVersion)
                ? Math.max(0, value.collapsedGroupsVersion)
                : 0;
            this.data = normalizeStore(value);
        } catch (error) {
            if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
                this.ctx
                    .logger("market")
                    .warn(
                        `failed to read market-next data store: ${error instanceof Error ? error.message : error}`,
                    );
            }
            this.hasCollapsedGroupsState = false;
            this.collapsedGroupsVersion = 0;
            this.data = emptyStore();
        }
    }

    /** 防抖写盘:合并同一 tick 内的多次变更,下一个宏任务统一落盘。 */
    private scheduleWrite() {
        if (this.writeTimer) clearTimeout(this.writeTimer);
        this.writeTimer = setTimeout(() => {
            this.writeTimer = undefined;
            this.flushWrite();
        }, 0);
    }

    /**
     * 串行化写盘:已有写任务在跑时只置 writePending,任务收尾时检测到
     * pending 再补一次写,保证"最后一次变更一定落盘"且写不交错。
     */
    private flushWrite() {
        if (this.writeTask) {
            this.writePending = true;
            return;
        }
        this.writeTask = this.write().finally(() => {
            this.writeTask = undefined;
            if (!this.writePending) return;
            this.writePending = false;
            this.flushWrite();
        });
    }

    /** 立即写盘:取消防抖、等在途写任务结束后再写一次(关键路径用)。 */
    private async flushWriteNow() {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
            this.writeTimer = undefined;
        }
        if (this.writeTask) await this.writeTask;
        this.writePending = false;
        await this.write();
    }

    /** 实际写盘(原子写,附 collapsedGroupsVersion);失败只 warn 不抛。 */
    private async write() {
        try {
            await writeJsonAtomic(
                this.file,
                {
                    ...this.data,
                    collapsedGroupsVersion: this.collapsedGroupsVersion,
                },
                { indent: 2, newline: false },
            );
        } catch (error) {
            this.ctx
                .logger("market")
                .warn(
                    `failed to write market-next data store: ${error instanceof Error ? error.message : error}`,
                );
        }
    }
}
