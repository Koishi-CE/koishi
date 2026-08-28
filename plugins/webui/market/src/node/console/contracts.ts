import { z } from "zod";

/**
 * P3 可执行契约：24 个 RPC 事件的入参 zod schema（另有 market/refresh 无参，
 * 注册在 shared/provider.ts）。
 * listener 边界统一校验，契约即代码、即文档。
 * 事件参数均为位置参数（client send(event, ...args)），因此用 tuple 描述整组入参。
 * 与 shared/bundle、shared/types 及 core 各 types 模块中的 TS 接口一一对应。
 */

/** Dict<string>（依赖请求表）。 */
const dictString = z.record(z.string(), z.string());
/** 任意 Dict（配置/数据补丁）。 */
const dictAny = z.record(z.string(), z.any());

/** 安装选项（installer.service 的 InstallOptions）。 */
const installOptions = z
    .object({
        installEndpoint: z.string().optional(),
    })
    .passthrough();

/** 本地包上传：开始。 */
const localUploadStart = z.object({
    filename: z.string(),
    size: z.number().int().nonnegative(),
});
/** 本地包上传：分片。 */
const localUploadChunk = z.object({
    uploadId: z.string(),
    index: z.number().int().nonnegative(),
    data: z.string(),
});
/** 本地包上传：完成。 */
const localUploadFinish = z.object({ uploadId: z.string() });

/** bundle 成员安装选项。 */
const bundleInstallMember = z.object({
    package: z.string(),
    plugin: z.string(),
    version: z.string(),
    required: z.boolean().optional(),
    config: dictAny.optional(),
    selected: z.boolean(),
    createConfig: z.boolean(),
    usePreset: z.boolean(),
    conflict: z.enum(["same-group", "other-config", "package-mismatch"]).optional(),
    move: z.boolean().optional(),
});
/** bundle 清单（members 结构）。 */
const bundleManifest = z.object({
    label: z.string().optional(),
    description: z.string().optional(),
    members: z.array(
        z.object({
            package: z.string(),
            plugin: z.string(),
            version: z.string(),
            required: z.boolean().optional(),
            config: dictAny.optional(),
        }),
    ),
});
/** market/install-bundle 请求。 */
const bundleInstallRequest = z.object({
    package: z.string(),
    version: z.string(),
    bundle: bundleManifest,
    members: z.array(bundleInstallMember),
});
/** market/remove-bundle-configs 请求。 */
const bundleConfigRemoveRequest = z.object({
    package: z.string(),
    members: z.array(z.object({ package: z.string(), plugin: z.string() })).optional(),
    removeEmptyGroup: z.boolean().optional(),
});

/** market/lookup 请求。 */
const marketLookupRequest = z.object({
    names: z.array(z.string()).optional(),
    services: z.array(z.string()).optional(),
});
/** market/index 请求（transport 枚举）。 */
const marketSnapshotRequest = z.object({
    transport: z.enum(["inline", "http-gzip"]).optional(),
});

/** market/update-data 补丁（MarketDataStorePayload）。 */
const marketDataPatch = z.object({
    override: dictString.optional(),
    updateIgnored: z.record(z.string(), z.any()).optional(),
    bundleRecords: z.record(z.string(), z.any()).optional(),
    collapsedGroups: z.record(z.string(), z.boolean()).optional(),
});

/**
 * 顶层 tuple 的"可选"一律用 nullish 而非 optional：
 * 客户端 send() 走 WebSocket JSON 序列化，数组元素里的 undefined 会被
 * 转成 null；zod 的 .optional() 只放行 undefined、不放行 null。若用
 * .optional()，任何"省略可选参数"的调用都会在这里误报契约失败
 * （zod v4 的 ZodError message 是多行 JSON，coerce 还只会回传最后一行
 * 堆栈，排障完全无从下手）。对象内部字段不受影响（JSON 会直接丢弃
 * undefined 属性），维持 .optional() 即可。
 */
const contracts = {
    "market/install": z.tuple([dictString, z.boolean().nullish(), installOptions.nullish()]),
    "market/install-bundle": z.tuple([
        bundleInstallRequest,
        z.boolean().nullish(),
        installOptions.nullish(),
    ]),
    "market/install-fallback-candidate": z.tuple([z.string().nullish()]),
    "market/install-history": z.tuple([z.number().int().nullish()]),
    "market/install-history-detail": z.tuple([z.string()]),
    "market/local-package-upload-start": z.tuple([localUploadStart]),
    "market/local-package-upload-chunk": z.tuple([localUploadChunk]),
    "market/local-package-upload-finish": z.tuple([localUploadFinish]),
    "market/local-package-upload-commit": z.tuple([z.string()]),
    "market/local-package-upload-cancel": z.tuple([z.string()]),
    "market/prepare-local-binding": z.tuple([z.string()]),
    "market/environment-snapshots": z.tuple([]),
    "market/environment-snapshot-preview": z.tuple([z.string()]),
    "market/environment-snapshot-apply": z.tuple([z.string(), installOptions.nullish()]),
    "market/remove-bundle-configs": z.tuple([bundleConfigRemoveRequest]),
    "market/update-config": z.tuple([dictAny]),
    "market/update-data": z.tuple([marketDataPatch]),
    "market/refresh-dependencies": z.tuple([]),
    "market/package": z.tuple([z.string()]),
    "market/index": z.tuple([marketSnapshotRequest.nullish()]),
    "market/lookup": z.tuple([marketLookupRequest.nullish()]),
    "market/registry": z.tuple([z.array(z.string())]),
    "market/ensure-config": z.tuple([z.string()]),
    "market/avatar": z.tuple([z.string(), z.string().nullish()]),
} as const;

export type ContractName = keyof typeof contracts;

/**
 * listener 边界统一校验：入参不符合 zod schema 即抛错。
 *
 * zod v4 的 ZodError message 是多行 JSON，而 koishi 的 coerce() 用
 * `line.endsWith(message)` 从堆栈里找 message 起始行——多行 message
 * 永远匹配不上，只能回传堆栈最后一行（如 "at process.processTicksAnd
 * Rejections"），前端完全看不到真实原因。这里把 ZodError 重抛为单行
 * message 的普通 Error，保证校验失败时可排障。
 */
export function assertContract(name: ContractName, ...args: unknown[]) {
    try {
        (contracts[name] as z.ZodType).parse(args);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const detail = error.issues
                .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
                .join("; ");
            throw new Error(`invalid arguments for ${name}: ${detail}`);
        }
        throw error;
    }
}
