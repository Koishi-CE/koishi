/**
 * @file console 通道刷新的统一入口(console 域)。
 *
 * 模块职责:把"哪些数据面被改了,要通知前端重新拉取"收敛到一个函数,
 * 避免 listener 各自散落 ctx.get("console")?.refresh(...) 调用。
 *
 * 架构位置:node 适配层 console 模块,被安装/配置/依赖刷新等几乎全部
 * 写路径消费;通道名与 DataService/宿主 plugin-config 的服务键对应。
 */
import type { Context } from "@koishi-ce/koishi";

/** 可刷新的 console 通道名(对应各 DataService 键与宿主服务)。 */
export type ConsoleRefreshChannel =
	| "dependencies"
	| "registry"
	| "registryStatus"
	| "packages"
	| "config"
	| "market";

/** 安装类操作的固定刷新集:依赖、registry 缓存、插件列表、koishi.yml 配置。 */
export const INSTALL_REFRESH_CHANNELS = [
	"dependencies",
	"registry",
	"packages",
	"config",
] as const;

/** 并行刷新指定通道(console 服务不存在时静默跳过,如宿主未装控制台)。 */
export function refreshConsole(
	ctx: Context,
	channels: readonly ConsoleRefreshChannel[],
) {
	return Promise.all(
		channels.map((channel) => ctx.get("console")?.refresh(channel)),
	);
}
