// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 图标中心：所有内置图标的注册表与 <k-icon> 组件。
 *
 * 图标分两类来源：包根 assets/icons/ 下的 .svg 资产（经 ~icons/k/* 虚拟
 * 模块在编译期转为 Vue 组件，构建接线见 console-builder 的 icons.ts），
 * 以及 schemastery-vue 体系（./form 透出）现成的 Icon* 组件；统一以字符串名注册到
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
import Default from "~icons/k/activity-default";
import Ellipsis from "~icons/k/activity-ellipsis";
import Home from "~icons/k/activity-home";
import Moon from "~icons/k/activity-moon";
import Settings from "~icons/k/activity-settings";
import Sun from "~icons/k/activity-sun";
import ArrowLeft from "~icons/k/arrow-left";
import ArrowRight from "~icons/k/arrow-right";
import BoxOpen from "~icons/k/box-open";
import CheckFull from "~icons/k/check-full";
import ChevronDown from "~icons/k/chevron-down";
import ChevronLeft from "~icons/k/chevron-left";
import ChevronRight from "~icons/k/chevron-right";
import ChevronUp from "~icons/k/chevron-up";
import ClipboardList from "~icons/k/clipboard-list";
import Edit from "~icons/k/edit";
import ExclamationFull from "~icons/k/exclamation-full";
import Expand from "~icons/k/expand";
import FileArchive from "~icons/k/file-archive";
import Filter from "~icons/k/filter";
import GitHub from "~icons/k/github";
import GitLab from "~icons/k/gitlab";
import InfoFull from "~icons/k/info-full";
import Koishi from "~icons/k/koishi";
import Link from "~icons/k/link";
import PaperPlane from "~icons/k/paper-plane";
import QuestionEmpty from "~icons/k/question-empty";
import Redo from "~icons/k/redo";
import Search from "~icons/k/search";
import SearchMinus from "~icons/k/search-minus";
import SearchPlus from "~icons/k/search-plus";
import StarEmpty from "~icons/k/star-empty";
import StarFull from "~icons/k/star-full";
import Start from "~icons/k/start";
import Tag from "~icons/k/tag";
import TimesFull from "~icons/k/times-full";
import Tools from "~icons/k/tools";
import Undo from "~icons/k/undo";
import User from "~icons/k/user";
import * as schema from "../form";

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

register("arrow-up", schema.IconArrowUp);
register("arrow-down", schema.IconArrowDown);
register("arrow-left", ArrowLeft);
register("arrow-right", ArrowRight);
register("box-open", BoxOpen);
register("check-full", CheckFull);
register("chevron-down", ChevronDown);
register("chevron-left", ChevronLeft);
register("chevron-right", ChevronRight);
register("chevron-up", ChevronUp);
register("clipboard-list", ClipboardList);
register("close", schema.IconClose);
register("delete", schema.IconDelete);
register("edit", Edit);
register("ellipsis", schema.IconEllipsis);
register("exclamation-full", ExclamationFull);
register("expand", Expand);
register("external", schema.IconExternal);
register("eye-slash", schema.IconEyeSlash);
register("eye", schema.IconEye);
register("file-archive", FileArchive);
register("filter", Filter);
register("github", GitHub);
register("gitlab", GitLab);
register("info-full", InfoFull);
register("koishi", Koishi);
register("link", Link);
register("paper-plane", PaperPlane);
register("add", schema.IconAdd);
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
