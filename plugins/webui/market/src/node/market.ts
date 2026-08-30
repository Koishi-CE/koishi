import {
	type Context,
	type Dict,
	type HTTP,
	Logger,
	Schema,
	sleep,
	Time,
} from "@koishi-ce/koishi";
import Scanner, {
	type RequestConfig,
	type SearchObject,
	type SearchResult,
} from "@koishi-ce/registry";
import { MarketProvider as BaseMarketProvider } from "../shared/index.ts";

const logger = new Logger("market");

// registry 接口对无认证请求有速率限制：搜索接口（/-/v1/search）超频时
// 返回 429，collect 首页搜索一旦失败会中断整个市场数据刷新（prepare
// 置 _error，页面清空）。对限流与 5xx 瞬态错误做指数退避重试。
/** 首次请求失败后的最大重试次数 */
const maxRetries = 2;
/** 重试的基础退避时长，按尝试次数指数放大 */
const retryBaseDelay = Time.second;

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

	/** 限流（429）与请求超时、服务端瞬态错误（408 / 5xx）可安全重试 */
	private isRetryable(error: unknown): error is HTTP.Error {
		if (!this.ctx.http.isError(error)) return false;
		const { status } = error.response ?? {};
		return (
			status === 429 ||
			status === 408 ||
			(status !== undefined && status >= 500)
		);
	}

	/**
	 * 带退避重试的 registry 请求。优先遵循服务端的 Retry-After 响应头
	 * （秒数），缺省时按基础时长指数退避。
	 */
	private async request<T>(
		http: HTTP,
		url: string,
		config?: RequestConfig,
	): Promise<T> {
		for (let attempt = 0; ; attempt++) {
			try {
				// registry.get 是原型方法，裸取会丢失 this（其内部以 this(url, …) 调用
				// 可调用的 HTTP 实例本身），须包一层保持绑定
				return await http.get<T>(url, config);
			} catch (error) {
				if (attempt >= maxRetries || !this.isRetryable(error)) throw error;
				const retryAfter = Number(
					error.response?.headers.get("retry-after") ?? "",
				);
				const delay =
					Number.isFinite(retryAfter) && retryAfter > 0
						? retryAfter * Time.second
						: retryBaseDelay * 2 ** attempt;
				logger.debug(
					"请求 %s 失败（%s），%d 秒后重试（第 %d 次）",
					url,
					error.message,
					delay / Time.second,
					attempt + 1,
				);
				await sleep(delay);
			}
		}
	}

	override async collect() {
		const { timeout } = this.config;
		const registry = this.ctx.installer.http;

		this.failed = [];
		this.scanner = new Scanner(<T>(url: string, config?: RequestConfig) =>
			this.request<T>(registry, url, config),
		);
		if (this.http) {
			const result = await this.request<SearchResult>(this.http, "");
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
