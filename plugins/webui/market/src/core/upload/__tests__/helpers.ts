/**
 * @file core/upload 域测试的共用工具:手工构造最小合法 ustar 归档
 * (可指定坏校验和/截断/非文件类型/超大声明),gzip 压缩后写入临时目录。
 *
 * 仅测试使用;不引入 koishi 运行时,只依赖 node 内置模块。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** tar 条目描述:name + 内容(或 typeflag 指定的特殊类型)。 */
export interface TarEntrySpec {
    /** 条目路径(tar 头 name 字段) */
    name: string;
    /** 文件内容(typeflag 为目录/链接时可空) */
    content?: string;
    /** ustar typeflag:"0" 文件、"5" 目录、"2" 符号链接等 */
    typeflag?: string;
    /** 覆盖头部的声明大小(用于构造"声明超大"的炸弹形态) */
    declaredSize?: number;
    /** 为 true 时故意破坏 checksum 字段(构造坏校验和) */
    corruptChecksum?: boolean;
    /** 符号链接指向(typeflag "2" 时 tar 头 linkname 字段) */
    linkname?: string;
}

/** 写一个 512 字节 ustar 头(strict 模式可解析,checksum 按规范计算)。 */
function buildHeader(spec: TarEntrySpec) {
    const buffer = Buffer.alloc(512);
    buffer.write(spec.name.slice(0, 100), 0, "utf8");
    buffer.write("0000644\0", 100, "utf8");
    buffer.write("0000000\0", 108, "utf8");
    buffer.write("0000000\0", 116, "utf8");
    const size = spec.declaredSize ?? Buffer.byteLength(spec.content ?? "", "utf8");
    buffer.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "utf8");
    buffer.write("13000000000\0", 136, "utf8");
    buffer.write("        ", 148, "utf8");
    buffer.write(spec.typeflag ?? "0", 156, "utf8");
    if (spec.linkname) buffer.write(spec.linkname.slice(0, 100), 157, "utf8");
    buffer.write("ustar\0", 257, "utf8");
    buffer.write("00", 263, "utf8");
    if (!spec.corruptChecksum) {
        const sum = buffer.reduce((acc, byte) => acc + byte, 0);
        buffer.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "utf8");
    } else {
        // 写一个必然错误的校验和(与实际和不匹配)
        buffer.write("777777\0 ", 148, "utf8");
    }
    return buffer;
}

/** 打包一组条目为未压缩 tar Buffer(含 1024 字节结束块)。 */
export function buildTarBuffer(specs: TarEntrySpec[], options?: { omitEndBlocks?: boolean }) {
    const parts: Buffer[] = [];
    for (const spec of specs) {
        const data = Buffer.from(spec.content ?? "", "utf8");
        parts.push(buildHeader(spec));
        if ((spec.typeflag ?? "0") === "0" && !spec.declaredSize) {
            parts.push(data);
            parts.push(Buffer.alloc((512 - (data.length % 512)) % 512));
        } else if (spec.declaredSize) {
            // 声明大小与实际数据解耦(用于构造超限/截断形态)
            parts.push(Buffer.alloc((512 - (data.length % 512)) % 512));
        }
    }
    if (!options?.omitEndBlocks) parts.push(Buffer.alloc(1024));
    return Buffer.concat(parts);
}

/** 把 tar 内容 gzip 压缩后写入临时目录,返回 .tgz 文件绝对路径。 */
export async function writeTgz(dir: string, filename: string, tarBuffer: Buffer) {
    const path = join(dir, filename);
    await writeFile(path, gzipSync(tarBuffer));
    return path;
}

/** 创建带前缀的临时目录;返回清理函数。 */
export async function makeTempDir(prefix: string) {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    return {
        dir,
        cleanup: () => rm(dir, { recursive: true, force: true }),
    };
}

/** 默认的最小合法插件 manifest(npm pack 根约定:package/package.json)。 */
export const DEMO_MANIFEST = JSON.stringify({
    name: "koishi-plugin-demo",
    version: "1.0.0",
    description: "demo plugin",
});
