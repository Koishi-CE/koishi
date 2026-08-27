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

interface ActivityOverride {
	hidden?: boolean;
	parent?: string;
	order?: number;
	position?: "top" | "bottom";
}
