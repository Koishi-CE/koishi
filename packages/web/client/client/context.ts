import * as cordis from "cordis";
import {
	type App,
	type Component,
	createApp,
	defineComponent,
	h,
	inject,
	markRaw,
	onBeforeUnmount,
	provide,
	type Ref,
	resolveComponent,
} from "vue";
import ActionService from "./plugins/action";
import I18nService from "./plugins/i18n";
import LoaderService from "./plugins/loader";
import RouterService from "./plugins/router";
import SettingService from "./plugins/setting";
import ThemeService from "./plugins/theme";

// —— 布局相关的 Context 类型扩展 ——

/** 前端侧事件表：在 cordis 事件的基础上扩展本库自定义事件 */
export interface Events<C extends Context = Context> extends cordis.Events<C> {}

/**
 * 前端 Context 接口：各服务插件通过 `declare module "../context"`
 * 向本接口合并自身的方法与属性（如 `$router`、`page()` 等）。
 */
export interface Context {
	[Context.events]: Events<this>;
	internal: Internal;
}

/**
 * 在组件 setup 中获取与当前组件生命周期绑定的 Context。
 *
 * 实现：从父级注入根 Context，创建一个空的插件 fork，使得返回的
 * 子上下文在组件卸载时（onBeforeUnmount）自动 dispose，从而组件内
 * 通过它注册的副作用（effect / 事件监听等）会随组件销毁被清理。
 */
export function useContext() {
	const parent = inject("cordis") as Context;
	const fork = parent.plugin(() => {});
	onBeforeUnmount(() => fork.dispose());
	return fork.ctx;
}

/**
 * 获取当前扩展（extension）通过 RPC 携带的只读数据。
 * 仅在由 loader 动态加载的扩展组件内可用。
 */
export function useRpc<T>(): Ref<T> {
	const parent = inject("cordis") as Context;
	return parent.extension?.data as Ref<T>;
}

// 各服务通过 `declare module "../context"` 对 Internal 做接口合并,
// 因此这里必须是 interface 而非类型别名(空 interface 不能被 biome 自动
// 改写为 type alias,否则合并会变成 TS2300 重复标识符)
// biome-ignore lint/suspicious/noEmptyInterface: 需要保持 interface 以支持声明合并
export interface Internal {}

/**
 * 前端根 Context：持有 Vue 根应用 `app`，构造时安装六个核心服务插件，
 * 并在 `ready` 阶段（扩展入口加载完毕后）挂载到 `#app` 节点。
 */
export class Context extends cordis.Context {
	app: App;

	constructor() {
		super();
		// cordis.Context 上对应字段不含 null(exactOptionalPropertyTypes),
		// 运行时以 null 表示「尚未加载」,类型层面按已知模式收窄
		this.extension = null as never;
		this.internal = {} as Internal;
		// Vue 根应用：渲染两个顶级插槽位——root（单选，承载 activity 页面）
		// 与 global（多选，承载全局浮层如右键菜单、图片查看器）
		this.app = createApp(
			defineComponent({
				setup: () => () => [
					h(resolveComponent("k-slot"), { name: "root", single: true }),
					h(resolveComponent("k-slot"), { name: "global" }),
				],
			}),
		);
		// 向整棵组件树提供根 Context，供 useContext() 注入
		this.app.provide("cordis", this);

		this.plugin(ActionService);
		this.plugin(I18nService);
		this.plugin(LoaderService);
		this.plugin(RouterService);
		this.plugin(SettingService);
		this.plugin(ThemeService);

		this.on("ready", async () => {
			// 先等待全部扩展入口就绪（i18n / router 依赖扩展注册的资源），
			// 再依次挂载国际化与路由，最后把 Vue 应用渲染到页面上
			await this.$loader.initTask;
			this.app.use(this.$i18n.i18n);
			this.app.use(this.$router.router);
			this.app.mount("#app");
		});
	}

	/**
	 * 注册 window 级事件监听，并纳入 cordis effect 管理：
	 * 当前作用域销毁时自动移除监听。
	 */
	addEventListener<K extends keyof WindowEventMap>(
		type: K,
		listener: (this: Window, ev: WindowEventMap[K]) => any,
		options?: boolean | AddEventListenerOptions,
	) {
		return this.effect(() => {
			window.addEventListener(type, listener, options);
			return () => window.removeEventListener(type, listener, options);
		});
	}

	/**
	 * 包装组件：为动态加载的组件提供独立的 cordis 注入源。
	 *
	 * 未加载任何扩展（extension 为 null）时原样返回；
	 * 否则包一层 wrapper 组件，将当前 ctx provide 为 "cordis"，
	 * 使组件树内部通过 useContext() 拿到的是注册它时的上下文。
	 */
	wrapComponent(component: Component | undefined) {
		if (!component) return;
		if (!this.extension) return component;
		return defineComponent((props, { slots }) => {
			provide("cordis", this);
			return () => h(component, props, slots);
		});
	}
}

// cordis 的原型对象不参与 Vue 响应式代理，避免被 reactive 包裹后
// 触发不必要的依赖收集与性能开销
markRaw(cordis.Context.prototype);
markRaw(cordis.EffectScope.prototype);
