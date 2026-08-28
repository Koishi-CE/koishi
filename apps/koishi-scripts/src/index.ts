/**
 * @koishi-ce/scripts 的共享工具模块：提供宿主项目 package.json 的最小
 * 类型、当前工作目录与宿主依赖清单（meta），以及交互式确认工具。
 * setup / clone 子命令从这里取宿主信息（如各依赖的版本号，用于给新插件
 * 的 devDependencies / peerDependencies 赋值）。
 */
import prompts from "prompts";

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

/** 宿主项目的 package.json 内容，读取各依赖版本时使用 */
export const meta: PackageJson = require(`${cwd}/package.json`);

/** 交互式确认框：返回用户是否选择了「是」 */
export async function confirm(message: string) {
	const { value } = await prompts({
		name: "value",
		type: "confirm",
		message,
	});
	return value;
}
