// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 设置服务：控制台本地配置（localStorage）与设置面板的管理。
 *
 * 配置分两层：original（用户显式修改的原始字段）与 resolved
 * （经所有插件 schema 补全后的完整配置），二者双向同步（见文末类注释）。
 * 插件通过 `ctx.settings()` 注册设置分区、`ctx.schema()` 注册自定义控件。
 */
import {
	type RemovableRef,
	useLocalStorage,
} from "@vueuse/core";
import { type Dict, remove } from "cosmokit";
import {
	type Component,
	computed,
	markRaw,
	reactive,
	ref,
	watch,
} from "vue";
import {
	Schema,
	SchemaBase,
} from "../../../components/client/index.ts";
import type { Config } from "..";
import type { Context } from "../context";
import { insert, type Ordered, Service } from "../utils";

declare module "../context" {
	interface Context {
		$setting: SettingService;
		schema(extension: SchemaBase.Extension): () => void;
		settings(options: SettingOptions): () => void;
	}

	interface Internal {
		settings: Dict<SettingOptions[]>;
	}
}

/** 设置面板条目：按 id 分组展示于"设置"页面各分区 */
interface SettingOptions extends Ordered {
	/** 所属设置分区 id（空串为通用设置） */
	id: string;
	/** 分区标题 */
	title?: string;
	disabled?: () => boolean;
	/** 该分区的配置 schema（渲染为表单） */
	schema?: Schema;
	/** 自定义渲染组件（替代 schema 表单） */
	component?: Component;
}

/**
 * 带版本号的 localStorage 存储。
 * 版本号变化（或首次写入）时整体重置为初始值，避免旧结构残留。
 * 以 "koishi.console." 为键前缀隔离。
 */
export let useStorage = <T extends object>(
	key: string,
	version?: number,
	fallback?: () => T,
): RemovableRef<T> => {
	const initial = (fallback ? fallback() : {}) as T & {
		__version__?: number | undefined;
	};
	initial.__version__ = version;
	const storage = useLocalStorage(
		`koishi.console.${key}`,
		initial,
	);
	if (storage.value.__version__ !== version) {
		storage.value = initial;
	}
	return storage;
};

/** 替换默认的 useStorage 实现（宿主 app 用于接管持久化方式） */
export function provideStorage(factory: typeof useStorage) {
	useStorage = factory;
}

interface StorageData<T> {
	version: number;
	data: T;
}

/** @deprecated 已废弃，请改用 `useConfig` */
export function createStorage<T extends object>(
	key: string,
	version: number,
	fallback?: () => T,
) {
	const storage = useLocalStorage(
		`koishi.console.${key}`,
		{} as StorageData<T>,
	);
	const initial = fallback ? fallback() : ({} as T);
	if (storage.value.version !== version) {
		storage.value = { version, data: initial };
	} else if (!Array.isArray(storage.value.data)) {
		storage.value.data = {
			...initial,
			...storage.value.data,
		};
	}
	return reactive<T>(storage.value["data"]);
}

// 默认配置本来就是「部分」配置:各插件向 Config 合并的必填字段
// (如 status)在此处并不存在,故做一次收窄断言以兼容任意增强
/** 用户实际保存的原始配置（localStorage，仅含用户改过的字段） */
export const original = useStorage<Config>(
	"config",
	undefined,
	() =>
		({
			theme: {
				mode: "auto",
				dark: "default-dark",
				light: "default-light",
			},
			locale: "zh-CN",
		}) as unknown as Config,
);

/** 经全部插件 schema 校验/补全后的完整配置（组件默认读取这一份） */
export const resolved = ref({} as Config);

/**
 * 获取客户端配置。
 * @param useOriginal 为 true 时返回用户原始存储（默认返回补全后的 resolved）
 */
export const useConfig = (useOriginal = false) =>
	useOriginal ? original : resolved;

/**
 * 设置服务：管理控制台的本地配置与设置面板。
 *
 * 核心是 original 与 resolved 的双向同步：
 * 用户改 resolved → simplify 后写回 original（只保留用户改过的字段）；
 * original 或 schema 变化 → 重新用 schema 解释得到完整 resolved。
 */
export default class SettingService extends Service {
	constructor(ctx: Context) {
		super(ctx, "$setting", true);
		ctx.mixin("$setting", {
			settings: "settings",
			extendSchema: "schema",
		});

		ctx.internal.settings = reactive({});

		this.settings({
			id: "",
			title: "通用设置",
			order: 1000,
			schema: Schema.object({
				locale: Schema.union([
					"zh-CN",
					"en-US",
				]).description("语言设置。"),
			}).description("通用设置"),
		});

		// 汇总所有分区 schema 为一个相交对象，作为 resolved 的解释器
		const schema = computed(() => {
			const list: Schema[] = [];
			for (const settings of Object.values(
				ctx.internal.settings,
			)) {
				for (const options of settings) {
					if (options.schema) {
						list.push(options.schema);
					}
				}
			}
			return Schema.intersect(list);
		});

		// 监听用户在表单上的修改：化简（只留显式设置的字段）后写回原始存储
		const doWatch = () =>
			watch(
				resolved,
				(value) => {
					console.debug("config", JSON.stringify(value));
					original.value = schema.value.simplify(value);
				},
				{ deep: true },
			);

		let stop = doWatch();

		// 重放同步：先停掉 resolved 监听，用 schema 重新解释 original，
		// 再重启监听——避免解释过程触发的写回造成回环
		const update = () => {
			stop?.();
			try {
				resolved.value = schema.value(original.value);
			} catch (error) {
				console.error(error);
			}
			stop = doWatch();
		};

		ctx.effect(() => () => stop?.());

		// 原始存储或 schema 集合任一变化，都重新生成 resolved
		ctx.effect(() =>
			watch(original, update, { deep: true }),
		);
		ctx.effect(() => watch(schema, update));
	}

	/**
	 * 注册一个 schema 扩展（自定义控件类型/角色），供设置表单渲染使用。
	 * 返回取消注册函数。
	 */
	extendSchema(extension: SchemaBase.Extension) {
		const component = this.ctx.wrapComponent(
			extension.component,
		);
		if (component) extension.component = component;
		return this.ctx.effect(() => {
			SchemaBase.extensions.add(extension);
			return () => SchemaBase.extensions.delete(extension);
		});
	}

	/** 向设置面板追加一个分区条目；返回取消注册函数 */
	settings(options: SettingOptions) {
		markRaw(options);
		options.order ??= 0;
		const component = this.ctx.wrapComponent(
			options.component,
		);
		if (component) options.component = component;
		return this.ctx.effect(() => {
			const list = (this.ctx.internal.settings[
				options.id
			] ||= []);
			insert(list, options);
			return () => {
				remove(list, options);
				if (!list.length)
					delete this.ctx.internal.settings[options.id];
			};
		});
	}
}
