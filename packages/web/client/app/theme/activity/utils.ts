/**
 * 活动栏（activity bar）相关的类型扩充：
 * - 为 ActionContext 补充 "theme.activity" 菜单的求值上下文类型；
 * - 为控制台 Config 声明 activities 覆盖配置（隐藏 / 归组 / 排序 / 上下位置）。
 */

import type { Activity, Dict } from "@koishi-ce/client";

declare module "@koishi-ce/client" {
	interface ActionContext {
		"theme.activity": Activity;
	}

	interface Config {
		// 运行时的默认配置(initial fallback)并不包含该字段,
		// 故声明为可选(exactOptionalPropertyTypes 下不显式赋 undefined)
		activities?: Dict<ActivityOverride>;
	}
}

// 单个活动项的覆盖配置：不声明的字段沿用页面注册时的默认值
interface ActivityOverride {
	hidden?: boolean;
	parent?: string;
	order?: number;
	position?: "top" | "bottom";
}
