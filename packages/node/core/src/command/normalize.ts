/** 指令名归一化（小写 + 下划线转连字符），供 Command 静态方法与内部注册逻辑共享 */
export function normalizeCommand(name: string) {
	return name.toLowerCase().replace(/_/g, "-");
}
