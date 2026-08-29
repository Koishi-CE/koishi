import {
	type Context,
	type Dict,
	type HTTP,
	Schema,
	Time,
} from "@koishi-ce/koishi";
import Scanner, {
	type SearchObject,
	type SearchResult,
} from "@koishi-ce/registry";
import { MarketProvider as BaseMarketProvider } from "../shared";

class MarketProvider extends BaseMarketProvider {
	private http?: HTTP;
	private failed: string[] = [];
	private scanner!: Scanner;
	private fullCache: Dict<SearchObject> = {};
	private tempCache: Dict<SearchObject> = {};
	private flushData: () => void;

	override config: MarketProvider.Config;

	constructor(ctx: Context, config: MarketProvider.Config) {
		super(ctx);
		this.config = config;
		if (config.endpoint) this.http = ctx.http.extend(config);
		this.flushData = ctx.throttle(() => {
			ctx.console.broadcast("market/patch", {
				data: this.tempCache,
				failed: this.failed.length,
				total: this.scanner.total,
				progress: this.scanner.progress,
			});
			this.tempCache = {};
		}, 500);
	}

	override async start(refresh = false) {
		this.failed = [];
		this.fullCache = {};
		this.tempCache = {};
		if (refresh) this.ctx.installer.refresh(true);
		await this.prepare();
		super.start();
	}

	override async collect() {
		const { timeout } = this.config;
		const registry = this.ctx.installer.http;

		this.failed = [];
		this.scanner = new Scanner(registry.get);
		if (this.http) {
			const result = await this.http.get<SearchResult>("");
			this.scanner.objects = result.objects.filter((object) => !object.ignored);
			this.scanner.total = this.scanner.objects.length;
			if (result.version !== undefined) this.scanner.version = result.version;
		} else {
			await this.scanner.collect(timeout !== undefined ? { timeout } : {});
		}

		if (!this.scanner.version) {
			// npmmirror 的 404 需要静默忽略；origin 精确比对防止
			// "https://registry.npmmirror.com.evil.io" 之类前缀伪造绕过
			let isNpmmirror = false;
			try {
				isNpmmirror =
					new URL(registry.config.endpoint ?? "").origin ===
					"https://registry.npmmirror.com";
			} catch {
				// endpoint 缺失或非合法 URL：按非 npmmirror 处理
			}
			this.scanner.analyze({
				version: "4",
				onFailure: (name, reason) => {
					this.failed.push(name);
					if (isNpmmirror) {
						if (
							this.ctx.http.isError(reason) &&
							reason.response?.status === 404
						) {
							// ignore 404 error for npmmirror
						}
					}
				},
				onRegistry: (registry, versions) => {
					this.ctx.installer.setPackage(registry.name, versions);
				},
				onSuccess: (object, _versions) => {
					// npmmirror lacks `links` field
					object.package.links ||= {
						npm: `${registry.config.endpoint?.replace("registry.", "www.") ?? ""}/package/${object.package.name}`,
					};
					this.fullCache[object.package.name] = this.tempCache[
						object.package.name
					] = object;
				},
				after: () => this.flushData(),
			});
		}

		return undefined;
	}

	override async get() {
		await this.prepare();
		if (this._error) return { data: {}, failed: 0, total: 0, progress: 0 };
		const gravatar = process.env["GRAVATAR_MIRROR"];
		return this.scanner.version
			? {
					registry: this.ctx.installer.endpoint,
					data: Object.fromEntries(
						this.scanner.objects.map((item) => [item.package.name, item]),
					),
					failed: 0,
					total: this.scanner.total,
					progress: this.scanner.total,
					gravatar,
				}
			: {
					registry: this.ctx.installer.endpoint,
					data: this.fullCache,
					failed: this.failed.length,
					total: this.scanner.total,
					progress: this.scanner.progress,
					gravatar,
				};
	}

	// erasableSyntaxOnly 禁止含运行时值的 namespace，
	// 原 namespace 内的 Config 常量移到此处的静态字段，对外形状不变
	static Config: Schema<MarketProvider.Config> = Schema.object({
		endpoint: Schema.string().role("link"),
		timeout: Schema.number()
			.role("time")
			.default(Time.second * 30),
		proxyAgent: Schema.string().role("link"),
	});
}

declare namespace MarketProvider {
	export interface Config {
		endpoint?: string;
		timeout?: number;
	}
}

export default MarketProvider;
