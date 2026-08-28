/**
 * 引用计数的共享缓存。
 *
 * 同一 key 的数据可被多个引用方（ref，通常为会话/上下文 id）共享：
 * 读取或写入都会登记 ref；当某个 ref 调用 delete 时只解除它自己的
 * 引用，条目的引用清零后才真正移除。适用于"多会话共享同一份缓存、
 * 各自退出时不应影响他人"的场景（如批量指令解析的中间结果）。
 */
export namespace SharedCache {
	/** 缓存条目：值 + 键 + 引用方集合 */
	export interface Entry<T> {
		value: T;
		key: string;
		refs: Set<number>;
	}
}

export class SharedCache<T> {
	#keyMap = new Map<string, SharedCache.Entry<T>>();

	/** 读取 key 对应的值并登记 ref；不存在则返回 undefined。 */
	get(ref: number, key: string) {
		const entry = this.#keyMap.get(key);
		if (!entry) return;
		entry.refs.add(ref);
		return entry.value;
	}

	/** 写入（或覆盖）key 的值并登记 ref；已有条目只更新值，保留引用集。 */
	set(ref: number, key: string, value: T) {
		let entry = this.#keyMap.get(key);
		if (entry) {
			entry.value = value;
		} else {
			entry = { value, key, refs: new Set() };
			this.#keyMap.set(key, entry);
		}
		entry.refs.add(ref);
	}

	/** 解除 ref 对全部条目的引用；引用清零的条目随之移除。 */
	delete(ref: number) {
		for (const key of [...this.#keyMap.keys()]) {
			const entry = this.#keyMap.get(key);
			if (!entry) continue;
			entry.refs.delete(ref);
			if (!entry.refs.size) {
				this.#keyMap.delete(key);
			}
		}
	}
}
