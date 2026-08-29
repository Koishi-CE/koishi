/**
 * @koishi-ce/scripts 的共享工具模块：宿主项目 package.json 的最小类型、
 * 当前工作目录与宿主清单的懒加载读取。setup / clone / release 各子命令
 * 从这里取宿主信息（如 koishi 的版本号，用于给新插件的 peerDependencies
 * 赋值）；仓库内 workspace 包的 bundler 解析则走 exports 的 source 条件。
 */

/** 宿主 package.json 的最小结构（仅声明本工具会用到的字段） */
export interface PackageJson {
	name?: string;
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

/** 命令执行时所在的工作目录（约定为宿主项目根） */
export const cwd = process.cwd();

/**
 * 读取宿主项目的 package.json（Bun.file 懒加载，取代旧版的 CJS require）。
 * 读取失败（无清单 / 非 JSON）返回 null，调用方以常量兜底版本号。
 */
export async function loadHostManifest(): Promise<PackageJson | null> {
	try {
		return (await Bun.file(`${cwd}/package.json`).json()) as PackageJson;
	} catch {
		return null;
	}
}
