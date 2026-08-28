/**
 * 配置文件的格式层数据：扩展名 → MIME 映射与定位结果类型。
 *
 * 只保留纯数据（浏览器侧同样可用）；文件定位 / 读取解析 / 序列化写回
 * 是平台相关能力，见 base/index.ts 的抽象缝隙与 node/config-file.ts
 * 的 Bun 实现（浏览器侧由 @koishi-ce/loader 的消费者自行实现）。
 */

import type { Dict } from "@koishi-ce/core";

/** 支持写入的配置文件扩展名与对应 MIME 类型 */
export const writable: Dict<string> = {
	".json": "application/json",
	".yaml": "application/yaml",
	".yml": "application/yaml",
};

/** 支持的配置文件扩展名集合 */
export const extensions = new Set(Object.keys(writable));

/** 解析出的配置文件位置 */
export interface ResolvedConfigFile {
	/** 配置文件绝对路径 */
	filename: string;
	/** 配置文件 MIME 类型（浏览器实现可省略，按扩展名判断格式） */
	mime?: string | undefined;
	/** 配置文件所在目录（显式传入目录时为该目录本身） */
	baseDir: string;
	/** 配置文件是否可写（不可写则运行期不会回盘） */
	writable: boolean;
}
