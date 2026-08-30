/**
 * SharedCache（引用计数共享缓存）单元测试。
 *
 * 验证多引用方共享同一 key 时的语义：
 * 读取登记引用、写入覆盖保留引用集、单个引用解除不影响他人、
 * 引用清零后条目真正移除、以及未知 key 的读取安全性。
 */
import { describe, expect, it } from "bun:test";
import { SharedCache } from "@koishi-ce/koishi";

describe("SharedCache", () => {
	it("get 未登记的 key 返回 undefined", () => {
		const cache = new SharedCache<string>();
		expect(cache.get(1, "foo")).toBeUndefined();
		// 未写入过的 key 不存在条目，也不会因 get 而创建
		cache.get(1, "foo");
		expect(cache.get(2, "foo")).toBeUndefined();
	});

	it("set 新建条目并登记引用", () => {
		const cache = new SharedCache<string>();
		cache.set(1, "foo", "bar");
		expect(cache.get(1, "foo")).toBe("bar");
		// 第二个引用方读取同一 key 也能拿到值
		expect(cache.get(2, "foo")).toBe("bar");
	});

	it("set 覆盖已有条目时保留引用集", () => {
		const cache = new SharedCache<string>();
		cache.set(1, "foo", "bar");
		cache.set(2, "foo", "baz");
		// 覆盖后两个引用方都能读到新值
		expect(cache.get(1, "foo")).toBe("baz");
		expect(cache.get(2, "foo")).toBe("baz");
	});

	it("delete 只解除单个引用，引用清零才移除", () => {
		const cache = new SharedCache<string>();
		cache.set(1, "foo", "bar");
		cache.set(2, "foo", "bar");
		cache.delete(1);
		// 引用 1 已解除，但引用 2 仍在：条目存活
		expect(cache.get(2, "foo")).toBe("bar");
		cache.delete(2);
		// 全部引用解除后条目被移除
		expect(cache.get(3, "foo")).toBeUndefined();
	});

	it("delete 遍历全部条目且对空缓存安全", () => {
		const cache = new SharedCache<string>();
		expect(() => cache.delete(1)).not.toThrow();
		cache.set(1, "a", "1");
		cache.set(1, "b", "2");
		cache.delete(1);
		expect(cache.get(2, "a")).toBeUndefined();
		expect(cache.get(2, "b")).toBeUndefined();
	});

	it("不同 key 的引用互不影响", () => {
		const cache = new SharedCache<number>();
		cache.set(1, "a", 1);
		cache.set(2, "a", 2);
		cache.set(1, "b", 3);
		cache.delete(1);
		// "a" 仍有引用 2；"b" 的引用已清零被移除
		expect(cache.get(3, "a")).toBe(2);
		expect(cache.get(3, "b")).toBeUndefined();
	});
});
