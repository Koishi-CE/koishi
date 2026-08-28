/**
 * locales 插件（node 侧）：控制台的本地化文件管理。
 *
 * - 启动时扫描配置的各个根目录（root，靠后的优先级更高，倒序加载），
 *   把每个 `<locale>.yml` 以 `$<locale>` 命名空间注册进 ctx.i18n；
 * - 注册 l10n 监听器：浏览器端编辑翻译后回传数据，更新 i18n 并
 *   写回第一个根目录的 `<locale>.yml`；
 * - i18n 数据变化时防抖刷新 console entry，供前端展示全部翻译。
 */
import type { DataService } from "@koishi-ce/console";
import {
	type Context,
	type Dict,
	type I18n,
	Logger,
	Schema,
} from "@koishi-ce/koishi";
import {} from "@koishi-ce/plugin-console";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { dump, load } from "js-yaml";
import { resolve } from "path";

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			locales: DataService<Dict<I18n.Store>>;
		}
	}

	interface Events {
		l10n(data: Dict<I18n.Store>): void;
	}
}

const logger = new Logger("locales");

export const name = "locales";

/** 插件配置：本地化文件的根目录列表（字符串或字符串数组）。 */
export interface Config {
	root?: string[];
}

export const Config: Schema<Config> = Schema.object({
	root: Schema.union([
		Schema.array(
			Schema.path({
				filters: ["directory"],
				allowCreate: true,
			}),
		),
		Schema.transform(String, (root) => [root]),
	])
		.default(["data/locales", "locales"])
		.description("存放本地化文件的根目录。"),
});

/** 插件入口：加载各根目录的 yml 本地化文件，并在 console 就绪后注册编辑回写链路。 */
export async function apply(ctx: Context, config: Config) {
	// Schema default 保证 root 非空，此处兜底仅覆盖类型层面的可选性
	const roots = config.root ?? [];
	for (const root of roots.slice().reverse()) {
		const folder = resolve(ctx.baseDir, root);
		await mkdir(folder, { recursive: true });
		const files = await readdir(folder);
		for (const file of files) {
			if (!file.endsWith(".yml")) continue;
			logger.debug("loading locale %s", file);
			const content = await readFile(resolve(folder, file), "utf8");
			ctx.i18n.define("$" + file.split(".")[0], load(content) as any);
		}
	}

	ctx.inject(["console"], (ctx) => {
		const entry = ctx.console.addEntry(
			process.env["KOISHI_BASE"]
				? [
						process.env["KOISHI_BASE"] + "/dist/index.js",
						process.env["KOISHI_BASE"] + "/dist/style.css",
					]
				: process.env["KOISHI_ENV"] === "browser"
					? [import.meta.url.replace(/\/src\/[^/]+$/, "/client/index.ts")]
					: {
							dev: resolve(__dirname, "../client/index.ts"),
							prod: resolve(__dirname, "../dist"),
						},
			() => ctx.i18n._data,
		);

		// 浏览器端保存翻译:逐语言更新 i18n 并落盘为 yml;用户自定义的翻译
		// 存于 `$` 前缀命名空间,与插件自带文案区分开
		ctx.console.addListener(
			"l10n",
			async (data) => {
				// 写盘目标取第一个根目录；Schema default 保证至少一项，
				// 此守卫仅覆盖用户显式配置空数组的边缘情形（原实现会因
				// resolve 收到 undefined 而抛错，这里选择直接跳过写盘）
				const primary = roots[0];
				if (primary === undefined) return;
				for (const locale in data) {
					const store = data[locale];
					if (!store) continue;
					ctx.i18n.define("$" + locale, store);
					const content = dump(store);
					await writeFile(
						resolve(ctx.baseDir, primary, locale + ".yml"),
						content,
					);
				}
			},
			{ authority: 4 },
		);

		// i18n 任意变化(含本插件的 define)都在下一拍刷新 entry,推送最新翻译
		const update = ctx.debounce(() => entry.refresh(), 0);
		ctx.on("internal/i18n", update);
	});
}
