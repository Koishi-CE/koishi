import { promises as fsp } from "node:fs";
import { dirname } from "node:path";

export interface JsonStoreOptions {
    /** 防抖写入间隔，默认 2000ms */
    delay?: number;
    /** 写入前的存活检查（如 koishi scope.isActive），返回 false 跳过本次写入 */
    isActive?: () => boolean;
    onError?: (error: unknown) => void;
}

/**
 * 带防抖的 JSON 文件持久化。
 * 数据在写入时刻才通过 getData 求值，因此调用 schedule 后的内存更新总会被落盘。
 */
export class JsonStore<T> {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private readonly file: string;
    private readonly options: JsonStoreOptions;

    constructor(file: string, options: JsonStoreOptions = {}) {
        this.file = file;
        this.options = options;
    }

    /** 读取失败（不存在/解析错误）返回 undefined；非 ENOENT 错误上报 onError。 */
    async read(): Promise<T | undefined> {
        try {
            const content = await fsp.readFile(this.file, "utf8");
            return JSON.parse(content) as T;
        } catch (error) {
            if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
                this.options.onError?.(error);
            }
            return undefined;
        }
    }

    schedule(getData: () => T) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            if (!this.options.isActive?.()) return;
            void this.write(getData());
        }, this.options.delay ?? 2000);
    }

    async write(data: T) {
        try {
            await fsp.mkdir(dirname(this.file), { recursive: true });
            await fsp.writeFile(this.file, JSON.stringify(data));
        } catch (error) {
            this.options.onError?.(error);
        }
    }
}
