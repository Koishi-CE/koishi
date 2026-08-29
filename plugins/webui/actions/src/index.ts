/**
 * actions 插件（应用指令面板）的 Node 端入口。
 *
 * 本插件的功能全部位于浏览器端（控制台前端资源），Node 侧不承载
 * 任何逻辑，apply 为空实现；此处仅保留插件骨架以满足 console 插件
 * 的包结构约定（声明 console 服务依赖与空配置 schema）。
 */
import { type Context, Schema } from "@koishi-ce/koishi";

export type Config = Record<never, never>;

export const Config: Schema<Config> = Schema.object({});

export function apply(_ctx: Context, _config: Config) {}
