/**
 * 动作（action）与菜单服务：控制台的快捷键、右键菜单、
 * 作用域变量的统一管理。
 *
 * 插件通过 `ctx.action()` 注册动作、`ctx.menu()` 注册菜单条目、
 * `ctx.define()` 暴露作用域变量；组件通过 `useMenu()` 在元素上
 * 绑定右键菜单。作用域变量支持 "a.b" 点分键，经 Flatten 类型
 * 与运行时代理呈现为嵌套对象。
 */
import { type Dict, type Intersect, remove } from "cosmokit";
import {
	type MaybeRefOrGetter,
	markRaw,
	reactive,
	shallowReactive,
	toValue,
} from "vue";
import type { ActionContext } from "..";
import { type Context, useContext } from "../context";
import { insert, Service } from "../utils";

declare module "../context" {
	interface Context {
		$action: ActionService;
		action(id: string, options: ActionOptions): () => void;
		menu(id: string, items: MenuItem[]): () => void;
		define<K extends keyof ActionContext>(
			key: K,
			value: MaybeRefOrGetter<ActionContext[K]>,
		): () => void;
	}

	interface Internal {
		scope: Store<ActionContext>;
		menus: Dict<MenuItem[]>;
		actions: Dict<ActionOptions>;
		activeMenus: ActiveMenu[];
	}
}

/**
 * 动作（action）注册选项。
 * 动作是可被快捷键或菜单触发的操作，其执行时可读取当前上下文作用域。
 */
export interface ActionOptions {
	/** 触发快捷键，如 "Control+S"（macOS 上 ctrl 自动映射为 meta） */
	shortcut?: string;
	/** 返回 true 时在菜单中隐藏该动作 */
	hidden?: (scope: Flatten<ActionContext>) => boolean;
	/** 返回 true 时禁用该动作（快捷键与菜单均不触发） */
	disabled?: (scope: Flatten<ActionContext>) => boolean;
	/** 动作本体，传入当前作用域执行 */
	action: (scope: Flatten<ActionContext>) => any;
}

/** 旧版菜单项写法（字段与 ActionOptions 部分重叠），仅为兼容保留 */
export type LegacyMenuItem = Partial<ActionOptions> & Omit<MenuItem, "id">;

/** 菜单项：label / type / icon 均支持写成随作用域变化的 getter */
export interface MenuItem {
	id: string;
	label?: MaybeGetter<string>;
	type?: MaybeGetter<string>;
	icon?: MaybeGetter<string>;
	order?: number;
}

/** 值或（以作用域为参数的）取值函数 */
export type MaybeGetter<T> = T | ((scope: Flatten<ActionContext>) => T);

/** 作用域存储：扁平键到「值或 ref 或 getter」的映射 */
type Store<S extends {}> = { [K in keyof S]?: MaybeRefOrGetter<S[K]> };

/**
 * 把 "a.b.c" 形式的扁平键名归并为 { a: { b: { c } } } 的嵌套结构，
 * 供动作/菜单以对象路径的方式消费作用域。
 */
type Flatten<S extends {}> = Intersect<
	{
		[K in keyof S]: K extends `${infer L}.${infer R}`
			? { [P in L]: Flatten<{ [P in R]: S[K] }> }
			: { [P in K]: S[K] };
	}[keyof S]
>;

/** 当前激活的右键菜单：id 加上弹出位置（四边坐标） */
export interface ActiveMenu {
	id: string;
	relative: {
		left: number;
		top: number;
		right: number;
		bottom: number;
	};
}

/**
 * 创建右键菜单触发器：返回值直接绑到元素的 contextmenu 事件上。
 * 触发时把附加值写入作用域，并在鼠标位置弹出自定义菜单（由 global 插槽渲染）。
 * @param id 菜单标识，menu() 注册的条目将展示在该菜单中
 */
export function useMenu<K extends keyof ActionContext>(id: K) {
	const ctx = useContext();
	return (event: MouseEvent, value: MaybeRefOrGetter<ActionContext[K]>) => {
		ctx.define(id, value);
		event.preventDefault();
		const { clientX, clientY } = event;
		ctx.internal.activeMenus.splice(0, Infinity, {
			id,
			relative: {
				left: clientX,
				top: clientY,
				right: clientX,
				bottom: clientY,
			},
		});
	};
}

/**
 * 动作服务：管理全局快捷键、菜单与作用域变量。
 *
 * - `ctx.action()` 注册动作（可含快捷键，由全局 keydown 统一分发）；
 * - `ctx.menu()` 向具名菜单追加条目；
 * - `ctx.define()` 声明作用域变量，供动作/菜单项在执行时读取。
 */
export default class ActionService extends Service {
	constructor(ctx: Context) {
		super(ctx, "$action", true);
		ctx.mixin("$action", ["action", "menu", "define"]);

		ctx.internal.scope = shallowReactive({} as Store<ActionContext>);
		ctx.internal.menus = reactive({});
		ctx.internal.actions = reactive({});
		ctx.internal.activeMenus = reactive([]);

		// 全局快捷键：解析每个动作的 shortcut 描述串，
		// 与键盘事件逐项比对（ctrl 在 macOS 平台映射为 meta 键）
		ctx.addEventListener("keydown", (event) => {
			const scope = this.createScope();
			for (const action of Object.values(ctx.internal.actions)) {
				if (!action.shortcut) continue;
				const keys = action.shortcut
					.split("+")
					.map((key) => key.toLowerCase().trim());
				let ctrlKey = false,
					shiftKey = false,
					metaKey = false,
					code: string | undefined;
				for (const key of keys) {
					switch (key) {
						case "shift":
							shiftKey = true;
							continue;
						case "ctrl":
							// macOS 没有 ctrl+字母 的快捷键惯例，改用 Cmd（meta）
							if (navigator.platform.toLowerCase().includes("mac")) {
								metaKey = true;
							} else {
								ctrlKey = true;
							}
							continue;
						default:
							code = key;
					}
				}
				if (ctrlKey !== event.ctrlKey) continue;
				if (shiftKey !== event.shiftKey) continue;
				if (metaKey !== event.metaKey) continue;
				if (code !== event.key.toLowerCase()) continue;
				if (action.disabled?.(scope)) continue;
				event.preventDefault();
				action.action(scope);
			}
		});
	}

	/** 注册动作；返回取消注册函数 */
	action(id: string, options: ActionOptions) {
		markRaw(options);
		return this.ctx.effect(() => {
			this.ctx.internal.actions[id] = options;
			return () => delete this.ctx.internal.actions[id];
		});
	}

	/** 向具名菜单追加条目（按 order 插入有序列表）；返回取消注册函数 */
	menu(id: string, items: MenuItem[]) {
		return this.ctx.effect(() => {
			const list = (this.ctx.internal.menus[id] ||= []);
			items.forEach((item) => insert(list, item));
			return () => {
				items.forEach((item) => remove(list, item));
				if (!list.length) delete this.ctx.internal.menus[id];
			};
		});
	}

	/** 声明一个作用域变量（组件卸载/插件停止时自动移除）；返回取消函数 */
	define<K extends keyof ActionContext>(
		key: K,
		value: MaybeRefOrGetter<ActionContext[K]>,
	) {
		return this.ctx.effect(() => {
			this.ctx.internal.scope[key] = value as any;
			return () => delete this.ctx.internal.scope[key];
		});
	}

	/**
	 * 基于当前已注册的作用域变量构造快照对象（嵌套代理形式），
	 * 可用 override 临时覆盖若干键值。
	 */
	createScope(override = {}) {
		const scope = { ...this.ctx.internal.scope, ...override };
		return createScope(scope);
	}
}

/**
 * 把扁平键存储包装成嵌套对象的代理：
 * 读取 "a" 时若存在 "a.b" 等子键，则递归返回子级作用域代理；
 * 命中普通键则经 toValue 解析 ref/getter 后返回实际值。
 */
function createScope(
	scope: Store<ActionContext>,
	prefix = "",
): Flatten<ActionContext> {
	return new Proxy({} as Record<string, unknown>, {
		get: (target, key) => {
			if (typeof key === "symbol")
				return (target as Record<symbol, unknown>)[key];
			key = prefix + key;
			const source = scope as Record<string, MaybeRefOrGetter<unknown>>;
			if (key in scope) return toValue(source[key]);
			// 键本身不存在，但存在以其为前缀的子键：返回子级作用域代理
			const _prefix = key + ".";
			if (Object.keys(scope).some((k) => k.startsWith(_prefix))) {
				return createScope(scope, key + ".");
			}
			// 完全未命中：显式返回 undefined（noImplicitReturns）
			return undefined;
		},
	}) as Flatten<ActionContext>;
}
