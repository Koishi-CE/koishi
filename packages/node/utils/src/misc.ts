export function isInteger(source: any) {
	return typeof source === "number" && Math.floor(source) === source;
}

export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function enumKeys<T extends string>(data: Record<T, string | number>) {
	return Object.values(data).filter(
		(value) => typeof value === "string",
	) as T[];
}

export function defineEnumProperty<T extends object>(
	object: T,
	key: keyof T,
	value: T[keyof T],
) {
	object[key] = value;
	(object as Record<string | number, unknown>)[value as string | number] = key;
}

export function merge<T extends object>(head: T, base: T): T {
	const target = head as Record<string, any>;
	Object.entries(base).forEach(([key, value]) => {
		if (typeof target[key] === "undefined") return (target[key] = value);
		// prevent prototype attack
		if (!Object.hasOwn(target, key)) return;
		if (typeof value === "object" && typeof target[key] === "object") {
			target[key] = merge(target[key], value);
		} else {
			target[key] = value;
		}
	});
	return head;
}

export function assertProperty<O, K extends keyof O & string>(
	config: O,
	key: K,
) {
	if (!config[key]) throw new Error(`missing configuration "${key}"`);
	return config[key];
}

export function coerce(val: any) {
	// resolve error when stack is undefined, e.g. axios error with status code 401
	const { message, stack } =
		val instanceof Error && val.stack ? val : new Error(val as any);
	const lines = stack?.split("\n") ?? [message];
	const index = lines.findIndex((line) => line.endsWith(message));
	return lines.slice(index).join("\n");
}

export function renameProperty<
	O extends object,
	K extends keyof O,
	T extends string,
>(config: O, key: K, oldKey: T) {
	config[key] = Reflect.get(config, oldKey) as any;
	Reflect.deleteProperty(config, oldKey);
}

type Methods<T> = {
	[K in keyof T]?: T[K] extends (...args: infer A) => infer R
		? (this: T, ...args: A) => R
		: T[K];
};

export function extend<T>(prototype: T, methods: Methods<T>) {
	Object.defineProperties(prototype, Object.getOwnPropertyDescriptors(methods));
}
