/**
 * .yml / .yaml locale 文件的模块类型声明。
 *
 * 源码侧把 locale 文件当 ES 模块导入（构建期由 tsdown 的 copy loader
 * 把 .yml 原样拷入产物并改写引用路径，运行时由 koishi 内置的
 * yml-register 加载；Bun 运行时 / 测试靠 Bun 原生 yml 支持）。
 * 文件内容是嵌套的字符串字典，结构与 `I18n.Store` 兼容。
 *
 * 本文件由 tsconfig.base.json 的 `files` 注入所有 node 侧工程；
 * web 侧（client）的对应声明在 packages/web/client/global.d.ts。
 */
declare module "*.yml" {
	type YamlNode = string | YamlObject;

	interface YamlObject {
		[key: string]: YamlNode;
	}

	const content: YamlObject;

	export default content;
}

declare module "*.yaml" {
	type YamlNode = string | YamlObject;

	interface YamlObject {
		[key: string]: YamlNode;
	}

	const content: YamlObject;

	export default content;
}
