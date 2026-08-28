/**
 * @file yarn --json 日志解析(core/install/pipeline 域)。
 *
 * 职责:定义 yarn berry 流式 JSON 日志行的结构(YarnLog)并把其 type
 * 字段映射为 logger 级别,供 runner.ts 在转发子进程输出时分级。
 */
/** yarn berry --json 输出的单行日志结构。 */
export interface YarnLog {
    /** 日志类型(info/warning/error 或 yarn 的其他步骤名) */
    type: "warning" | "info" | "error" | string;
    /** 关联步骤编号(无则为 null) */
    name: number | null;
    /** 步骤展示名 */
    displayName: string;
    /** 层级缩进 */
    indent?: string | undefined;
    /** 日志正文 */
    data: string;
}

/** type → 级别的映射:warning 降为 debug(太啰嗦),error 升为 warn。 */
const levelMap: Record<string, "info" | "debug" | "warn"> = {
    info: "info",
    warning: "debug",
    error: "warn",
};

/** yarn berry --json 日志类型 → logger 级别。 */
export function yarnLogLevel(type: string): "info" | "debug" | "warn" {
    // 未知类型(各种步骤名)默认 info,保证新版本的步骤日志不丢失
    return levelMap[type] ?? "info";
}
