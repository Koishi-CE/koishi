/**
 * 杂项工具函数：类型判断、枚举处理、对象合并、错误格式化等
 * 不便归类的小工具。全部为纯函数，无副作用。
 */

/**
 * 判断给定值是否为整数（不区分正负，不含无穷与 NaN）。
 */
export function isInteger(source: unknown) {
	return typeof source === "number" && Math.floor(source) === source;
}

/**
 * 等待指定毫秒数后 resolve 的 Promise，用于测试与流程延时。
 *
 * @param ms 等待时长（毫秒）
 */
export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 提取字符串枚举（或常量对象）中的全部键。
 * 枚举反向映射会产生值侧的字符串，故只保留字符串成员。
 */
export function enumKeys<T extends string>(data: Record<T, string | number>) {
	return Object.values(data).filter(
		(value) => typeof value === "string",
	) as T[];
}

/**
 * 在对象上定义枚举属性并同时建立值到键的反向映射，
 * 即 object[key] = value 且 object[value] = key。
 */
export function defineEnumProperty<T extends object>(
	object: T,
	key: keyof T,
	value: T[keyof T],
) {
	object[key] = value;
	(object as Record<string | number, unknown>)[value as string | number] = key;
}

/**
 * 以 head 为目标，将 base 的属性深度合并进去（就地修改 head）。
 *
 * 合并规则：head 已有值的键保留（嵌套对象递归合并）；
 * base 独有的键补充。链上的原型属性不会被引入。
 *
 * @param head 合并目标（会被修改）
 * @param base 提供缺省值的来源
 * @returns 合并后的 head
 */
export function merge<T extends object>(head: T, base: T): T {
	const target = head as Record<string, unknown>;
	Object.entries(base).forEach(([key, value]) => {
		if (typeof target[key] === "undefined") return (target[key] = value);
		// 键存在于原型链上但并非自有属性时跳过，防止原型污染攻击
		if (!Object.hasOwn(target, key)) return;
		if (typeof value === "object" && typeof target[key] === "object") {
			target[key] = merge(target[key] as object, value as object);
		} else {
			target[key] = value;
		}
	});
	return head;
}

/**
 * 断言配置对象中存在指定的必需属性，缺失则抛出错误。
 *
 * @param config 配置对象
 * @param key 必需属性键名
 * @returns 该属性的值
 */
export function assertProperty<O, K extends keyof O & string>(
	config: O,
	key: K,
) {
	if (!config[key]) throw new Error(`missing configuration "${key}"`);
	return config[key];
}

/**
 * 将任意抛出值（Error 对象或字面量）格式化为带调用堆栈的文本。
 * 从堆栈中截取以错误消息结尾的首行起，去掉与抛出点无关的外层帧。
 */
export function coerce(val: unknown) {
	// 堆栈可能缺失（如携带 401 状态码的 axios 错误），此时包装为 Error 再取；
	// 非 Error 抛出值经 String() 转为消息文本（等价于 Error 构造器内部的 ToString）
	const { message, stack } =
		val instanceof Error && val.stack ? val : new Error(String(val));
	const lines = stack?.split("\n") ?? [message];
	const index = lines.findIndex((line) => line.endsWith(message));
	return lines.slice(index).join("\n");
}

/**
 * 读取配置对象中旧键的值并搬到新键上（用于配置项重命名迁移）。
 */
export function renameProperty<
	O extends object,
	K extends keyof O,
	T extends string,
>(config: O, key: K, oldKey: T) {
	config[key] = Reflect.get(config, oldKey) as O[K];
	Reflect.deleteProperty(config, oldKey);
}

/**
 * 提取类型所有方法成员的可选映射（保持 this 类型与签名），
 * 供 extend() 以属性描述符方式批量挂载方法。
 */
type Methods<T> = {
	[K in keyof T]?: T[K] extends (...args: infer A) => infer R
		? (this: T, ...args: A) => R
		: T[K];
};

/**
 * 将 methods 的全部属性（连同名下可枚举性与 getter/setter）定义到 prototype 上。
 * 用于向既有对象（如 Date.prototype）混入方法。
 */
export function extend<T>(prototype: T, methods: Methods<T>) {
	Object.defineProperties(prototype, Object.getOwnPropertyDescriptors(methods));
}
