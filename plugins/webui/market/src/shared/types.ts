import type { Dict } from "@koishi-ce/koishi";
import type { SearchObject } from "@koishi-ce/registry";

/**
 * shared 层的协议类型集合：市场通道 payload、性能快照、路由评分、lookup/snapshot 请求响应等。
 *
 * 设计定位：这里只放 node 与 client 之间"线上传输"的数据结构（DataService 通道、
 * RPC listener、HTTP 快照传输），不含任何运行逻辑；字段大量使用可选 + `| undefined`
 * 的精确 optional 标注，配合 exactOptionalPropertyTypes 让赋值端显式区分
 * "字段缺失"与"值为 undefined"。被 src/node（生产方）、client/（消费方）与
 * provider.ts（ DataService 基类的载荷类型）共同引用。
 */

/** 单个 npm 端点的近期状态（registry/registryStatus 通道与路由评分的共享语言）。 */
export interface RegistryStatus {
	/** 是否处于请求进行中（用于 client 端展示 loading 态） */
	loading?: boolean | undefined;
	/** 失败归因类别（与 core/registry/errors.ts 的归因枚举一一对应） */
	reason?:
		| "timeout"
		| "not-found"
		| "network"
		| "invalid"
		| "http"
		| "unknown"
		| undefined;
	/** 人类可读的错误摘要 */
	error?: string | undefined;
	/** 最近一次尝试使用的端点 URL */
	endpoint?: string | undefined;
	/** 本轮重试已尝试的端点次数 */
	attempts?: number | undefined;
	/** 最近一次尝试耗时（毫秒） */
	elapsed?: number | undefined;
	/** 状态更新时间戳（Date.now()） */
	updatedAt?: number | undefined;
}

/** 安装失败后的备用 npm 源推荐（node 端点选择与 client 进度弹窗共用）。 */
export interface InstallFallbackCandidate {
	/** 备用端点 URL */
	endpoint: string;
	/** 展示用的端点名（如镜像站名） */
	label: string;
	/** 推荐该备用源的原因说明 */
	reason: string;
}

/** 静默过滤：状态类规则（node market 配置与 client 前端配置共用，原分别定义于 config/index.ts 与 market-config.ts）。 */
export interface MarketSilentStatusRule {
	/** 要静默的插件状态类别 */
	target?: "preview" | "insecure" | "bundle";
	/** 规则备注（仅供用户自己辨认） */
	note?: string;
	/** 是否启用该规则 */
	enabled?: boolean;
}

/** 静默过滤：日期类规则。 */
export interface MarketSilentDateRule {
	/** 依据的字段 */
	field?: "created" | "updated";
	/** 早于/晚于指定日期 */
	relation?: "before" | "after";
	/** 比较基准日期字符串 */
	date?: string;
	/** 规则备注（仅供用户自己辨认） */
	note?: string;
	/** 是否启用该规则 */
	enabled?: boolean;
}

/** 静默过滤：最近 N 天规则。 */
export interface MarketSilentRecentRule {
	/** 依据的字段 */
	field?: "created" | "updated";
	/** 时间窗口天数 */
	days?: number;
	/** 规则备注（仅供用户自己辨认） */
	note?: string;
	/** 是否启用该规则 */
	enabled?: boolean;
}

/** 静默过滤：自定义查询规则。 */
export interface MarketSilentCustomRule {
	/** 匹配市场搜索查询的关键字 */
	query?: string;
	/** 规则备注（仅供用户自己辨认） */
	note?: string;
	/** 是否启用该规则 */
	enabled?: boolean;
}

/** 静默过滤：归一化后的通用规则（marketSilentRules）。 */
export interface MarketSilentRule {
	/** 归一化后的规则类型（把上面四类原始规则拍平成单一判别字段） */
	type?:
		| "custom"
		| "preview"
		| "insecure"
		| "bundle"
		| "created-before"
		| "created-after"
		| "updated-before"
		| "updated-after"
		| "created-within"
		| "updated-within";
	/** 状态类规则的取值 */
	value?: string;
	/** 日期类规则的基准日期 */
	date?: string;
	/** 最近 N 天规则的天数 */
	days?: number;
	/** 自定义查询规则的关键字 */
	query?: string;
	/** 规则备注（仅供用户自己辨认） */
	note?: string;
	/** 是否启用该规则 */
	enabled?: boolean;
}

/** 一次索引/元数据请求的性能快照（市场页 debug 卡的数据来源）。 */
export interface MarketPerformanceSnapshot {
	/** 数据实际来源：网络 / 磁盘缓存 / 304 协商复用 / 内容哈希复用 / 旧版布局缓存 */
	source?:
		| "network"
		| "disk-cache"
		| "http-304"
		| "hash-cache"
		| "legacy"
		| undefined;
	/** 实际命中的端点 URL */
	endpoint?: string | undefined;
	/** 用户偏好的主端点（与 endpoint 不同说明走了 fallback） */
	preferredEndpoint?: string | undefined;
	/** 启用 fallback 的原因（主端点失败 / 主端点过慢 / 冷却端点救援） */
	fallbackReason?: "primary-failed" | "primary-slow" | "rescue" | undefined;
	/** 本轮竞速的候选端点数 */
	candidates?: number | undefined;
	/** 解码后的索引体积（字节） */
	size?: number | undefined;
	/** 传输体积（压缩后，字节） */
	wireSize?: number | undefined;
	/** 响应的内容编码（gzip/br 等） */
	contentEncoding?: string | undefined;
	/** 索引中的条目数量 */
	objects?: number | undefined;
	/** 索引内容哈希（用于 hash-cache 比对复用） */
	hash?: string | undefined;
	/** 协商缓存 ETag */
	etag?: string | undefined;
	/** 协商缓存 Last-Modified */
	lastModified?: string | undefined;
	/** 缓存写入时间戳 */
	cachedAt?: number | undefined;
	/** 缓存最近一次校验（304/哈希确认）时间戳 */
	validatedAt?: number | undefined;
	/** 各阶段耗时表（键为阶段名，值为毫秒） */
	timings?: Dict<number> | undefined;
}

/** 单个市场端点的路由评分视图（学习统计 + 瞬时缓存状态的合并展示）。 */
export interface MarketRouteScore {
	/** 端点 URL */
	endpoint: string;
	/** 综合评分（越高越优，详见 core/market 的评分加权） */
	score: number;
	/** 历史成功次数 */
	successes?: number | undefined;
	/** 历史失败次数 */
	failures?: number | undefined;
	/** 连续失败次数（触发冷却的依据） */
	consecutiveFailures?: number | undefined;
	/** 冷却截止时间戳（期内端点不参与竞速） */
	cooldownUntil?: number | undefined;
	/** 当前是否处于冷却中 */
	coolingDown?: boolean | undefined;
	/** EWMA 平均耗时（毫秒） */
	averageElapsed?: number | undefined;
	/** 最近一次成功时间戳 */
	lastSuccess?: number | undefined;
	/** 端点最近响应的内容编码（gzip/br 等可获加分） */
	contentEncoding?: string | undefined;
	/** 磁盘上是否存有该端点的缓存条目 */
	cached?: boolean | undefined;
	/** 缓存条目的写入时间戳 */
	cachedAt?: number | undefined;
}

/** 市场页 debug 卡的完整性能数据（initial 加载与 refresh 刷新各一份快照 + 全端点评分）。 */
export interface MarketPerformance extends MarketPerformanceSnapshot {
	/** 首次加载的快照 */
	initial?: MarketPerformanceSnapshot | undefined;
	/** 最近一次手动/后台刷新的快照 */
	refresh?: MarketPerformanceSnapshot | undefined;
	/** 全部候选端点的路由评分 */
	routeScores?: MarketRouteScore[] | undefined;
}

/** market/lookup RPC 请求：按包名或服务名检索市场插件。 */
export interface MarketLookupRequest {
	/** 包名列表 */
	names?: string[] | undefined;
	/** 服务名列表（插件 service.implements 声明） */
	services?: string[] | undefined;
}

/** market/lookup RPC 响应。 */
export interface MarketLookupResult {
	/** 包名 → 市场条目（仅在请求了 names 时填充） */
	data: Dict<SearchObject>;
	/** 服务名 → 实现该服务的包名列表（仅在请求了 services 时填充） */
	services: Dict<string[]>;
	/** 快照修订号（用于 client 缓存失效判断） */
	revision?: number | undefined;
	/** 数据版本号（数据内容变化时递增） */
	dataVersion?: number | undefined;
}

/** market/index RPC 请求：声明期望的快照传输方式。 */
export interface MarketSnapshotRequest {
	/** inline 直接内联返回；http-gzip 返回下载 URL（大快照走 HTTP 通道） */
	transport?: "inline" | "http-gzip" | undefined;
}

/** market 通道的完整 payload（MarketProvider.Payload 的结构性定义）。 */
export interface MarketPayload {
	/** 当前默认 npm registry 端点 */
	registry?: string | undefined;
	/** 市场索引：包名 → 条目（inline 传输时才有，http-gzip 时由 URL 下载） */
	data?: Dict<SearchObject> | undefined;
	/** 快照修订号（每次结构变化递增） */
	revision?: number | undefined;
	/** 数据版本号（数据内容变化时递增） */
	dataVersion?: number | undefined;
	/** 索引条目总数 */
	total: number;
	/** 拉取失败的条目数 */
	failed: number;
	/** 刷新进度（0-1） */
	progress: number;
	/** gravatar 镜像地址（client 生成头像 URL 用，受 GRAVATAR_MIRROR 环境变量控制） */
	gravatar?: string | undefined;
	/** 索引是否为陈旧数据（拉取失败时回退磁盘缓存并标记） */
	stale?: boolean | undefined;
	/** 拉取错误摘要 */
	error?: string | undefined;
	/** 是否命中磁盘缓存 */
	cached?: boolean | undefined;
	/** 缓存写入时间戳 */
	cachedAt?: number | undefined;
	/** 缓存最近一次校验时间戳 */
	validatedAt?: number | undefined;
	/** 服务器当前时间戳（client 校正时钟偏差用） */
	serverNow?: number | undefined;
	/** 是否正在后台刷新 */
	refreshing?: boolean | undefined;
	/** 是否处于首次加载中 */
	loading?: boolean | undefined;
	/** debug 性能数据（市场页 debug 卡） */
	debug?: MarketPerformance | undefined;
}

/** market/index 的 http-gzip 传输形态：data 不内联，改为返回下载地址与体积信息。 */
export interface MarketSnapshotTransfer {
	/** 固定为 http-gzip（判别字段） */
	transport: "http-gzip";
	/** gzip 快照下载 URL（GET {uiPath}/market-next/snapshot/:id） */
	url: string;
	/** 除 data 外的完整 payload（进度、debug、时间戳等） */
	payload: Omit<MarketPayload, "data">;
	/** 解码后体积（字节） */
	decodedSize: number;
	/** gzip 压缩后体积（字节） */
	encodedSize: number;
}

/** market/index 响应：内联 payload 或 http-gzip 传输描述二选一，按 transport 字段判别。 */
export type MarketSnapshotResponse = MarketPayload | MarketSnapshotTransfer;
