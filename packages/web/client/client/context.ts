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

// layout api

export interface Events<C extends Context = Context> extends cordis.Events<C> {}

export interface Context {
	[Context.events]: Events<this>;
	internal: Internal;
}

export function useContext() {
	const parent = inject("cordis") as Context;
	const fork = parent.plugin(() => {});
	onBeforeUnmount(() => fork.dispose());
	return fork.ctx;
}

export function useRpc<T>(): Ref<T> {
	const parent = inject("cordis") as Context;
	return parent.extension?.data as Ref<T>;
}

// 各服务通过 `declare module "../context"` 对 Internal 做接口合并,
// 因此这里必须是 interface 而非类型别名(空 interface 不能被 biome 自动
// 改写为 type alias,否则合并会变成 TS2300 重复标识符)
// biome-ignore lint/suspicious/noEmptyInterface: 需要保持 interface 以支持声明合并
export interface Internal {}

export class Context extends cordis.Context {
	app: App;

	constructor() {
		super();
		// cordis.Context 上对应字段不含 null(exactOptionalPropertyTypes),
		// 运行时以 null 表示「尚未加载」,类型层面按已知模式收窄
		this.extension = null as never;
		this.internal = {} as Internal;
		this.app = createApp(
			defineComponent({
				setup: () => () => [
					h(resolveComponent("k-slot"), { name: "root", single: true }),
					h(resolveComponent("k-slot"), { name: "global" }),
				],
			}),
		);
		this.app.provide("cordis", this);

		this.plugin(ActionService);
		this.plugin(I18nService);
		this.plugin(LoaderService);
		this.plugin(RouterService);
		this.plugin(SettingService);
		this.plugin(ThemeService);

		this.on("ready", async () => {
			await this.$loader.initTask;
			this.app.use(this.$i18n.i18n);
			this.app.use(this.$router.router);
			this.app.mount("#app");
		});
	}

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

	wrapComponent(component: Component | undefined) {
		if (!component) return;
		if (!this.extension) return component;
		return defineComponent((props, { slots }) => {
			provide("cordis", this);
			return () => h(component, props, slots);
		});
	}
}

markRaw(cordis.Context.prototype);
markRaw(cordis.EffectScope.prototype);
