import { defineProperty, is, noop } from "cosmokit";

const immutable = [
	"number",
	"string",
	"bigint",
	"boolean",
	"symbol",
	"function",
];
const builtin = ["Date", "RegExp", "Set", "Map", "WeakSet", "WeakMap", "Array"];

function observeProperty(value: any, update: any) {
	if (is("Date", value)) {
		return observeDate(value, update);
	} else if (Array.isArray(value)) {
		return observeArray(value, update);
	} else {
		return observeObject(value, update);
	}
}

function untracked(key: string | symbol) {
	return typeof key === "symbol" || key.startsWith("$");
}

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
			return observeProperty(value, update || (() => notify(key)));
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

const arrayProxyMethods: Record<string, (...args: any[]) => any> = {
	pop: Array.prototype.pop,
	shift: Array.prototype.shift,
	splice: Array.prototype.splice,
	sort: Array.prototype.sort,
};

function observeArray<T>(target: T[], update: () => void) {
	const proxy: Record<string | symbol, unknown> = {};

	for (const [method, methodFn] of Object.entries(arrayProxyMethods)) {
		defineProperty(target, method, function (this: T[], ...args: any[]) {
			update();
			return methodFn.apply(this, args);
		});
	}

	return new Proxy(target, {
		get(target, key) {
			if (key in proxy) return proxy[key];
			const value = Reflect.get(target, key);
			if (
				!value ||
				immutable.includes(typeof value) ||
				typeof key === "symbol" ||
				isNaN(key as any)
			)
				return value;
			return observeProperty(value, update);
		},
		set(target, key, value) {
			if (
				typeof key !== "symbol" &&
				!isNaN(key as any) &&
				Reflect.get(target, key) !== value
			)
				update();
			return Reflect.set(target, key, value);
		},
	});
}

function observeDate(target: Date, update: () => void) {
	for (const method of Object.getOwnPropertyNames(Date.prototype)) {
		if (method === "valueOf") continue;
		const methodFn = (
			Date.prototype as unknown as Record<string, (...args: any[]) => any>
		)[method];
		if (typeof methodFn !== "function") continue;
		defineProperty(target, method, function (this: Date, ...args: any[]) {
			const oldValue = target.valueOf();
			const result = methodFn.apply(this, args);
			if (target.valueOf() !== oldValue) update();
			return result;
		});
	}
	return target;
}

export type Observed<T, R = any> = T & {
	$diff: Partial<T>;
	$update: () => R;
	$merge: (value: Partial<T>) => Observed<T, R>;
};

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
export function observe<T extends object, R>(
	target: T,
	updateOrLabel?: UpdateFunction<T, R> | string | number,
	_label?: string | number,
): Observed<T, any> {
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

	defineProperty(
		observer,
		"$update",
		function $update(this: Observed<T, R>): R | undefined {
			const diff = { ...this.$diff };
			const fields = Object.keys(diff);
			if (!fields.length) return undefined;
			for (const key in this.$diff) {
				delete this.$diff[key];
			}
			return update(diff);
		},
	);

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
