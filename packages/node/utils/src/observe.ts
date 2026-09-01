// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 观察器（observe）：对普通对象做深度变更追踪的 Proxy 实现。
 *
 * observe() 返回原对象的代理（Observed），任何赋值/删除/数组变异/Date 变更
 * 都会被记录到 $diff 中；调用 $update() 可取出变更并交由回调消费（如写回
 * 数据库）。Koishi 的 ORM（minato）据此实现"取出实体 -> 修改 -> 落盘"的差量更新。
 *
 * 注意：Date / RegExp / Set / Map 等内建类型只能作为被观察的属性值，
 * 不能作为 observe() 的直接目标（会抛错，见 builtin 列表）。
 */

import { defineProperty, is, noop } from "cosmokit";

/** 不可作为观察属性的原语类型（值不可变，无需代理） */
const immutable = [
	"number",
	"string",
	"bigint",
	"boolean",
	"symbol",
	"function",
];
/** 不允许直接观察的内建类型（Object.prototype.toString 的类型标签） */
const builtin = ["Date", "RegExp", "Set", "Map", "WeakSet", "WeakMap", "Array"];

/**
 * 按值的实际类型选择对应的观察包装：Date / 数组 / 普通对象各走一路。
 *
 * @param value 被读取到的属性值
 * @param update 上层传入的变更通知回调
 */
function observeProperty(value: unknown, update: () => void) {
	if (is("Date", value)) {
		return observeDate(value, update);
	} else if (Array.isArray(value)) {
		return observeArray(value, update);
	} else {
		return observeObject(value as object, update);
	}
}

/**
 * 判断键是否不参与变更追踪：symbol 键与 `$` 前缀键（内部保留属性）。
 */
function untracked(key: string | symbol) {
	return typeof key === "symbol" || key.startsWith("$");
}

/**
 * 观察普通对象：返回记录属性级变更的 Proxy。
 *
 * @param target 目标对象
 * @param notify 变更通知回调；未提供时（根观察）改为把变更写入 target.$diff
 *
 * 读取时对可观察的属性值惰性递归包装（嵌套对象/数组/Date），
 * 写入/删除时值未变化则不通知。
 */
function observeObject<T extends object>(
	target: T,
	notify?: (key: string | symbol) => void,
): T {
	const update = notify;
	if (!notify) {
		const diff: Record<string | symbol, unknown> = Object.create(null);
		defineProperty(target, "$diff", diff);
		notify = (key) => {
			if (untracked(key)) return;
			diff[key] = (target as Record<string | symbol, unknown>)[key];
		};
	}

	const proxy = new Proxy(target as Observed<T>, {
		get(target, key) {
			const value = Reflect.get(target, key);
			if (!value || immutable.includes(typeof value) || untracked(key))
				return value;
			// 深层包装：子对象的变更需冒泡通知到上层键（update 优先，缺省时记入本层键）
			return observeProperty(value, () => (update || notify)(key));
		},
		set(target, key, value) {
			const unchanged = Reflect.get(target, key) === value;
			const result = Reflect.set(target, key, value);
			if (unchanged || !result) return result;
			notify(key);
			return true;
		},
		deleteProperty(target, key) {
			const unchanged = !(key in target);
			const result = Reflect.deleteProperty(target, key);
			if (unchanged || !result) return result;
			notify(key);
			return true;
		},
	});

	return proxy;
}

/** 会修改数组本身、需要包装上报的变异方法（值保留原生签名，仅按键名迭代） */
const arrayProxyMethods = {
	pop: Array.prototype.pop,
	shift: Array.prototype.shift,
	splice: Array.prototype.splice,
	sort: Array.prototype.sort,
};

/** 包装用的一致签名：运行时按各方法的原生语义调用，入参出参不做静态约束 */
type ArrayMutator = (...args: unknown[]) => unknown;

/**
 * 观察数组：包装四个变异方法为"先上报再执行"，并通过 Proxy
 * 拦截数字下标的写入，检测到元素变化时上报。
 */
function observeArray<T>(target: T[], update: () => void) {
	const proxy: Record<string | symbol, unknown> = {};

	for (const method of Object.keys(arrayProxyMethods)) {
		// 原生方法与统一包装签名之间参数逆变不兼容，此处按运行时语义收窄
		const methodFn = arrayProxyMethods[
			method as keyof typeof arrayProxyMethods
		] as ArrayMutator;
		defineProperty(target, method, function (this: T[], ...args: unknown[]) {
			update();
			return methodFn.apply(this, args);
		});
	}

	return new Proxy(target, {
		get(target, key) {
			if (key in proxy) return proxy[key];
			const value = Reflect.get(target, key);
			// 非数字下标（length、方法名等）与不可变值直接透传
			if (
				!value ||
				immutable.includes(typeof value) ||
				typeof key === "symbol" ||
				Number.isNaN(Number(key))
			)
				return value;
			return observeProperty(value, update);
		},
		set(target, key, value) {
			if (
				typeof key !== "symbol" &&
				!Number.isNaN(Number(key)) &&
				Reflect.get(target, key) !== value
			)
				update();
			return Reflect.set(target, key, value);
		},
	});
}

/**
 * 观察日期：劫持 Date 原型上除 valueOf 外的全部方法，
 * 以时间戳是否变化为准——变更才上报，纯读取（如 getFullYear）不上报。
 */
function observeDate(target: Date, update: () => void) {
	for (const method of Object.getOwnPropertyNames(Date.prototype)) {
		if (method === "valueOf") continue;
		const methodFn = (
			Date.prototype as unknown as Record<
				string,
				(...args: unknown[]) => unknown
			>
		)[method];
		if (typeof methodFn !== "function") continue;
		defineProperty(target, method, function (this: Date, ...args: unknown[]) {
			const oldValue = target.valueOf();
			const result = methodFn.apply(this, args);
			if (target.valueOf() !== oldValue) update();
			return result;
		});
	}
	return target;
}

/**
 * 观察对象的类型：在原类型基础上附加差量与操作接口。
 *
 * @typeparam T 原对象类型
 * @typeparam R $update 回调的返回类型
 */
export type Observed<T, R = unknown> = T & {
	/** 已记录但尚未消费的变更 */
	$diff: Partial<T>;
	/** 消费变更：有 diff 时调用回调并清空，无变更则返回 undefined */
	$update: () => R;
	/** 直接合并外部数据（要求与现有 diff 无重叠键） */
	$merge: (value: Partial<T>) => Observed<T, R>;
};

/** $update 的回调形态：接收本次变更差量 */
type UpdateFunction<T, R> = (diff: Partial<T>) => R;

export function observe<T extends object>(
	target: T,
	label?: string | number,
): Observed<T, void>;
export function observe<T extends object, R>(
	target: T,
	update: UpdateFunction<T, R>,
	label?: string | number,
): Observed<T, R>;
/**
 * 创建目标对象的深度观察代理（重载实现）。
 *
 * @param target 要观察的普通对象（不可为 null、原语或内建类型实例）
 * @param updateOrLabel 变更消费回调（传入函数时）或调试标签
 * @returns 带有 $diff / $update / $merge 的代理对象
 */
export function observe<T extends object, R>(
	target: T,
	updateOrLabel?: UpdateFunction<T, R> | string | number,
	_label?: string | number,
): Observed<T, R> {
	if (immutable.includes(typeof target)) {
		throw new Error(`cannot observe immutable type "${typeof target}"`);
	} else if (!target) {
		throw new Error("cannot observe null or undefined");
	}

	const type = Object.prototype.toString.call(target).slice(8, -1);
	if (builtin.includes(type)) {
		throw new Error(`cannot observe instance of type "${type}"`);
	}

	let update: UpdateFunction<T, R> = noop;
	if (typeof updateOrLabel === "function") update = updateOrLabel;

	const observer = observeObject(target) as Observed<T, R>;

	/**
	 * 取出并清空 $diff，交由 update 回调消费。
	 * 无变更时不触发回调。
	 */
	defineProperty(observer, "$update", function $update(this: Observed<T, R>):
		| R
		| undefined {
		const diff = { ...this.$diff };
		const fields = Object.keys(diff);
		if (!fields.length) return undefined;
		for (const key in this.$diff) {
			delete this.$diff[key];
		}
		return update(diff);
	});

	/**
	 * 合并外部数据到目标对象（绕过 diff 记录）。
	 * 与现有 diff 键重叠时抛错，防止外部数据静默覆盖未落盘的变更。
	 */
	defineProperty(
		observer,
		"$merge",
		function $merge(this: Observed<T>, value: Partial<T>) {
			for (const key in this.$diff) {
				if (key in value) {
					throw new Error(`unresolved diff key "${key}"`);
				}
			}
			Object.assign(target, value);
			return this;
		},
	);

	return observer;
}
