import { type App, defineComponent, h } from "vue";
import { RouterLink } from "vue-router";
import { useContext } from "../context";

/**
 * activity 页面链接组件（k-activity-link）：
 * 传入页面 id，渲染一个指向该页面的 RouterLink。
 * 目标路径优先取该页面上次访问的完整路径（缓存），
 * 无缓存则回退到页面路由路径（去掉动态参数段）；默认插槽为空时
 * 以页面名称作为链接文案。
 */
const KActivityLink = defineComponent({
	props: {
		/** 目标 activity 的 id */
		id: String,
	},
	setup(props, { slots }) {
		const ctx = useContext();
		return () => {
			const activity = props.id ? ctx.$router.pages[props.id] : undefined;
			return h(
				RouterLink,
				{
					// /:.+/ 去掉路径中的动态参数段，得到可直接访问的静态前缀
					to: (ctx.$router.cache[activity?.id ?? ""] ||
						activity?.path.replace(/:.+/, "")) as string,
				},
				{
					default: () => slots["default"]?.() ?? activity?.name,
				},
			);
		};
	},
});

/** 注册全局组件 k-activity-link */
export default function (app: App) {
	app.component("k-activity-link", KActivityLink);
}
