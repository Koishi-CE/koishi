/**
 * @file 原子写文件工具(core/utils 域):先写同目录临时文件再 rename 替换,
 * 保证任意时刻磁盘上的 JSON 都是完整的一份,进程中断不会留下半份数据。
 *
 * 被消费方:market/cache 持久化、registry/cache 统计文件、upload 会话等
 * 所有需要落盘 JSON 的 core 模块。注意:原子性依赖同目录 rename(POSIX);
 * Windows 上 rename 到已存在目标可能报 EEXIST/EPERM,故有删除后重试的兜底。
 */
import { promises as fsp } from "node:fs";
import { dirname } from "node:path";

/** 原子写 JSON 的选项。 */
export interface AtomicJsonOptions {
    /** JSON 缩进空格数(undefined 时 JSON.stringify 单行压缩) */
    indent?: number;
    /** 是否省略末尾换行(默认补 "\n",与常规文本文件约定一致) */
    newline?: boolean;
}

/** 写入同目录临时文件后替换目标，避免进程中断留下半份 JSON。 */
export async function writeJsonAtomic<T>(file: string, value: T, options: AtomicJsonOptions = {}) {
    await fsp.mkdir(dirname(file), { recursive: true });
    // 临时文件名带 pid + 时间戳:多进程/多次写入互不覆盖,rename 前可区分归属
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(value, null, options.indent);
    await fsp.writeFile(temporary, options.newline === false ? serialized : `${serialized}\n`);
    try {
        await fsp.rename(temporary, file);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code !== "EEXIST" && code !== "EPERM") throw error;
        // Windows 对已存在目标的 rename 可能拒绝(EEXIST/EPERM):
        // 先删目标再重试一次,仍失败则向上抛出
        await fsp.rm(file, { force: true });
        await fsp.rename(temporary, file);
    }
}
