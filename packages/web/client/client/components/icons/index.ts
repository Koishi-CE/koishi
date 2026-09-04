// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 图标中心：所有内置图标的注册表与 <k-icon> 组件。
 *
 * 图标分两类来源：本目录下的 svg / activity 组件，以及
 * @koishi-ce/components 中现成的 Icon* 组件；统一以字符串名注册到
 * registry，业务侧通过 <k-icon name="..."/> 按名渲染。
 * 新图标可随时经 register() 补充注册。
 */
import {
	type App,
	type Component,
	defineComponent,
	h,
	markRaw,
	reactive,
} from "vue";
import * as components from "../../../../components/client/index.ts";
import Default from "./activity/default.vue";
import Ellipsis from "./activity/ellipsis.vue";
import Home from "./activity/home.vue";
import Moon from "./activity/moon.vue";
import Settings from "./activity/settings.vue";
import Sun from "./activity/sun.vue";
import ArrowLeft from "./svg/arrow-left.vue";
import ArrowRight from "./svg/arrow-right.vue";
import BoxOpen from "./svg/box-open.vue";
import CheckFull from "./svg/check-full.vue";
import ChevronDown from "./svg/chevron-down.vue";
import ChevronLeft from "./svg/chevron-left.vue";
import ChevronRight from "./svg/chevron-right.vue";
import ChevronUp from "./svg/chevron-up.vue";
import ClipboardList from "./svg/clipboard-list.vue";
import Edit from "./svg/edit.vue";
import ExclamationFull from "./svg/exclamation-full.vue";
import Expand from "./svg/expand.vue";
import FileArchive from "./svg/file-archive.vue";
import Filter from "./svg/filter.vue";
import GitHub from "./svg/github.vue";
import GitLab from "./svg/gitlab.vue";
import InfoFull from "./svg/info-full.vue";
import Koishi from "./svg/koishi.vue";
import Link from "./svg/link.vue";
import PaperPlane from "./svg/paper-plane.vue";
import QuestionEmpty from "./svg/question-empty.vue";
import Redo from "./svg/redo.vue";
import Search from "./svg/search.vue";
import SearchMinus from "./svg/search-minus.vue";
import SearchPlus from "./svg/search-plus.vue";
import StarEmpty from "./svg/star-empty.vue";
import StarFull from "./svg/star-full.vue";
import Start from "./svg/start.vue";
import Tag from "./svg/tag.vue";
import TimesFull from "./svg/times-full.vue";
import Tools from "./svg/tools.vue";
import Undo from "./svg/undo.vue";
import User from "./svg/user.vue";

import "./style.scss";

// 图标名 → 组件的注册表（响应式以支持运行时动态注册）
const registry: Record<string, Component> = reactive({});

// —— 内置图标注册：activity:* 用于侧栏页面，其余为通用小图标 ——
register("activity:default", Default);
register("activity:ellipsis", Ellipsis);
register("activity:home", Home);
register("activity:moon", Moon);
register("activity:settings", Settings);
register("activity:sun", Sun);

register("arrow-up", components.IconArrowUp);
register("arrow-down", components.IconArrowDown);
register("arrow-left", ArrowLeft);
register("arrow-right", ArrowRight);
register("box-open", BoxOpen);
register("check-full", CheckFull);
register("chevron-down", ChevronDown);
register("chevron-left", ChevronLeft);
register("chevron-right", ChevronRight);
register("chevron-up", ChevronUp);
register("clipboard-list", ClipboardList);
register("close", components.IconClose);
register("delete", components.IconDelete);
register("edit", Edit);
register("ellipsis", components.IconEllipsis);
register("exclamation-full", ExclamationFull);
register("expand", Expand);
register("external", components.IconExternal);
register("eye-slash", components.IconEyeSlash);
register("eye", components.IconEye);
register("file-archive", FileArchive);
register("filter", Filter);
register("github", GitHub);
register("gitlab", GitLab);
register("info-full", InfoFull);
register("koishi", Koishi);
register("link", Link);
register("paper-plane", PaperPlane);
register("add", components.IconAdd);
register("question-empty", QuestionEmpty);
register("redo", Redo);
register("search", Search);
register("search-minus", SearchMinus);
register("search-plus", SearchPlus);
register("star-empty", StarEmpty);
register("star-full", StarFull);
register("start", Start);
register("tag", Tag);
register("times-full", TimesFull);
register("tools", Tools);
register("undo", Undo);
register("user", User);

/** 向注册表登记一个图标（markRaw 避免组件被响应式代理） */
export function register(
	name: string,
	component: Component,
) {
	registry[name] = markRaw(component);
}

/** 注册 <k-icon> 全局组件：按 name 从注册表查找并渲染对应图标 */
export function install(app: App) {
	app.component(
		"k-icon",
		defineComponent({
			props: {
				name: String,
			},
			render(props: { name?: string }) {
				const component = props.name
					? registry[props.name]
					: undefined;
				return component && h(component);
			},
		}),
	);
}
