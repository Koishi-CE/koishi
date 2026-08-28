// 本文件必须是模块（export {}）才能让下面的 declare module 成为模块扩充而非
// 环境模块声明——后者会整体遮蔽真实的 vue 类型。
export {};

// vue 3.5.41 起 shallowReactive 带 ShallowReactiveBrand 品牌类型，而以源码发布的
// @koishi-ce/client 5.30.11 仍按裸 T 声明（extensions: Dict<LoadResult> = shallowReactive({})），
// 编译其源码时会报 index signature 缺失。这里补一条无品牌的重载做类型兼容垫片。
declare module "vue" {
	export function shallowReactive<T extends object>(target: T): T;
}
