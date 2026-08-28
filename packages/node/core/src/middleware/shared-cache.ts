export namespace SharedCache {
	export interface Entry<T> {
		value: T;
		key: string;
		refs: Set<number>;
	}
}

export class SharedCache<T> {
	#keyMap = new Map<string, SharedCache.Entry<T>>();

	get(ref: number, key: string) {
		const entry = this.#keyMap.get(key);
		if (!entry) return;
		entry.refs.add(ref);
		return entry.value;
	}

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
