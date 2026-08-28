import { DataService } from "@koishi-ce/console";
import {
	Context,
	type Dict,
	Logger,
	type MainScope,
	type Plugin,
	type Schema,
	type ScopeStatus,
} from "@koishi-ce/koishi";
import type { LoaderScope } from "@koishi-ce/loader";
import {} from "@koishi-ce/plugin-hmr";
import type {
	PackageJson,
	SearchObject,
	SearchResult,
} from "@koishi-ce/registry";

declare module "@koishi-ce/loader" {
	interface Loader {
		market: SearchResult;
	}
}

declare module "@koishi-ce/console" {
	interface Events {
		"config/request-runtime"(name: string): void;
	}
}

const logger = new Logger("config");

export abstract class PackageProvider extends DataService<
	Dict<PackageProvider.Data>
> {
	cache: Dict<PackageProvider.RuntimeData> = {};
	debouncedRefresh: () => void;

	override ctx: Context;

	constructor(ctx: Context) {
		super(ctx, "packages", { authority: 4 });
		this.ctx = ctx;

		this.debouncedRefresh = ctx.debounce(() => this.refresh(false), 0);
		ctx.on("internal/runtime", (scope) => this.update(scope.runtime.plugin));
		ctx.on("internal/fork", (scope) => this.update(scope.runtime.plugin));
		ctx.on("internal/status", (scope) => this.update(scope.runtime.plugin));
		ctx.on("hmr/reload", (reloads) => {
			for (const [plugin] of reloads) {
				this.update(plugin);
			}
		});

		ctx.console.addListener(
			"config/request-runtime",
			async (name) => {
				name = name.replace(/(koishi-|^@koishijs\/)plugin-/, "");
				this.cache[name] = await this.parseExports(name);
				this.refresh(false);
			},
			{ authority: 4 },
		);
	}

	abstract collect(forced: boolean): Promise<PackageProvider.Data[]>;

	async update(plugin: Plugin) {
		const name = this.ctx.loader.keyFor(plugin);
		if (!name || !this.cache[name]) return;
		this.cache[name] = await this.parseExports(name);
		this.debouncedRefresh();
	}

	parseRuntime(state: MainScope, result: PackageProvider.RuntimeData) {
		// 已销毁的 runtime(uid 为 null)不展示 id
		if (state.runtime.uid !== null) {
			result.id = state.runtime.uid;
		}
		result.forkable = state.runtime.isForkable;
		// fork 的 key 由 loader 写入(cordis 的 ForkScope 类型上没有该属性)
		const forks: Dict<{ status?: ScopeStatus }> = {};
		for (const fork of state.children) {
			const key = (fork as LoaderScope).key;
			if (!key) continue;
			forks[key] = { status: fork.status };
		}
		result.forks = forks;
	}

	override async get(forced = false) {
		const objects = (await this.collect(forced)).slice();
		for (const object of objects) {
			object.name = object.package?.name || "";
			const cached = this.cache[object.shortname];
			if (!cached) continue;
			object.runtime = cached;
		}

		// add app config
		objects.unshift({
			name: "",
			runtime: {
				schema: Context.Config,
			},
			package: { name: "" },
		} as any as PackageProvider.Data);
		return Object.fromEntries(objects.map((data) => [data.name, data]));
	}

	async parseExports(name: string) {
		try {
			const exports = await this.ctx.loader.resolve(name);
			const result: PackageProvider.RuntimeData = {};
			result.schema = exports?.Config || exports?.schema;
			result.usage = exports?.usage;
			result.filter = exports?.filter;
			const inject = exports?.using || exports?.inject || [];
			if (Array.isArray(inject)) {
				result.required = inject;
				result.optional = [];
			} else {
				result.required = inject.required || [];
				result.optional = inject.optional || [];
			}

			// make sure that result can be serialized into json
			JSON.stringify(result);

			const runtime = this.ctx.registry.get(exports);
			if (runtime) this.parseRuntime(runtime, result);
			return result;
		} catch (error) {
			logger.warn("failed to load %c", name);
			logger.warn(error);
			return { failed: true };
		}
	}
}

export namespace PackageProvider {
	export interface Data
		extends Pick<
			SearchObject,
			"shortname" | "workspace" | "manifest" | "portable"
		> {
		name?: string;
		runtime?: RuntimeData;
		package: Pick<
			PackageJson,
			"name" | "version" | "peerDependencies" | "peerDependenciesMeta"
		>;
	}

	export interface RuntimeData {
		id?: number;
		filter?: boolean;
		forkable?: boolean;
		schema?: Schema;
		usage?: string;
		required?: string[];
		optional?: string[];
		failed?: boolean;
		forks?: Dict<{
			status?: ScopeStatus;
		}>;
	}
}
