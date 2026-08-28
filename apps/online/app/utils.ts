/**
 * k-on! 的实例管理与持久化层。
 *
 * 浏览器内的所有"文件"都写入 @cordiverse/fs 垫片提供的内存虚拟文件
 * 系统（VFS），下方 root 常量即实例根目录；每个 Koishi 实例对应 VFS
 * 下一个子目录（koishi.yml 配置 + data/storage 数据）。本模块负责：
 * 实例索引读写（getInstances / flush）、实例切换与新建（activate）、
 * 控制台 storage 到 JSON 文件的落盘（provideStorage 接管）以及分享
 * 链接的生成与解析（shareLink / initialize）。
 */
import { type Dict, global, provideStorage } from "@koishi-ce/client";
import { type RemovableRef, useLocalStorage } from "@vueuse/core";
import { promises as fs } from "fs";
import { dump, load } from "js-yaml";
import { ref, shallowRef, watch } from "vue";
import loader from "./loader";

// 浏览器运行时经 @cordiverse/fs 等垫片挂载的全局量（下方赋值语句的目标）
declare global {
	var fs: typeof import("fs").promises;
	var loader: typeof import("./loader").default;
}

globalThis.fs = fs;
globalThis.loader = loader;

interface StorageData {
	version?: number;
	// 尚未选中任何实例时为 null（见 createStorage 的初始值）
	current: string | null;
}

// 本地存储结构版本号：与 localStorage 中不一致时整体重置（见 createStorage）
const version = 2;

/**
 * 创建带版本控制的 localStorage 状态。
 *
 * 版本号不一致则整体重置为初始值（升级 / 脏数据自愈）；一致则以初始值
 * 补齐旧数据缺失的字段后继续沿用。
 *
 * @param initial 初始状态（既是重置值也是字段模板）
 * @returns 与 localStorage 键 "koishi-play" 双向同步的响应式引用
 */
function createStorage(initial: StorageData) {
	const storage = useLocalStorage("koishi-play", {} as StorageData);
	if (storage.value.version !== version) {
		storage.value = { ...initial, version };
	} else {
		storage.value = { ...initial, ...storage.value };
	}
	return storage;
}

/** 当前会话状态：选中的实例 id（null 表示尚未选择 / 创建任何实例）。 */
export const data: RemovableRef<StorageData> = createStorage({
	current: null,
});

// 当前实例各 storage 键的内存态：provideStorage 读写的中转站，
// activate() 时从 VFS 的 JSON 文件批量载入
const storageData = shallowRef<Record<string, Record<string, unknown>>>({});

/**
 * 接管控制台的 storage API：把每个键的读写桥接到 VFS 中的
 * <实例>/data/storage/<键>.json 文件（经全局 fs 即 @cordiverse/fs 垫片
 * 落盘）。条目内的 __version__ 记录结构版本，不一致时该键重置为
 * fallback 初始值。
 */
provideStorage((key, version, fallback) => {
	if (!data.value.current) throw new Error("no instance selected");

	const result = ref();
	watch(
		storageData,
		() => {
			const initial = (fallback ? fallback() : {}) as Record<string, unknown>;
			initial["__version__"] = version;
			if (storageData.value[key]?.["__version__"] !== version) {
				storageData.value[key] = initial;
			}
			result.value = storageData.value[key];
		},
		{ immediate: true },
	);

	watch(
		result,
		() => {
			storageData.value[key] = result.value;
			fs.writeFile(
				`${root}/${data.value.current}/data/storage/${key}.json`,
				JSON.stringify(result.value),
			);
		},
		{ deep: true },
	);

	return result;
});

/** 单个 Koishi 实例的元数据（实例索引 index.json 中的条目）。 */
export interface Instance {
	name: string;
	lastVisit: number;
}

/** VFS 中所有实例的根目录 */
export const root = "/koishi/play/v1/instances";
/** 实例索引（id -> 元数据），持久化于 root/index.json */
export const instances = ref<Dict<Instance>>({});

/** 把实例索引整体写入 VFS 的 index.json。 */
export async function flush() {
	await fs.writeFile(`${root}/index.json`, JSON.stringify(instances.value));
}

/** 删除实例：移除其 VFS 目录与索引条目，并落盘索引。 */
export async function remove(key: string) {
	await fs.rm(`${root}/${key}`, { recursive: true });
	delete instances.value[key];
	await flush();
}

/**
 * 激活（切换到 / 新建）一个实例，并启动其中的 Koishi 应用。
 *
 * 流程：停掉现有应用 -> 沿用或新生成实例 id -> 尝试按既有配置初始化；
 * 失败（通常是全新实例，VFS 中还没有 koishi.yml）则写入一套默认插件
 * 配置（沙盒 / 市场 / 控制台等，并合并传入 config 中的附加插件与分享
 * 元数据）后重新初始化。随后批量载入该实例的 storage 文件，最后交给
 * loader 创建并启动 Koishi 应用。
 *
 * @param id 目标实例 id；省略时随机生成新 id（即"新建实例"）
 * @param event 触发本次激活的 DOM 事件（仅用于让触发按钮失焦）
 * @param config 分享链接带来的初始配置（含 plugins 与 share 元数据）
 */
export async function activate(id?: string, event?: Event, config?: any) {
	(event?.target as HTMLElement)?.blur();
	await loader.app?.stop();
	id ||= Math.random().toString(36).slice(2, 10);
	data.value.current = id;
	const filename = `${root}/${id}/koishi.yml`;
	await fs.mkdir(`${root}/${id}/data/storage`, { recursive: true });
	try {
		await loader.init(`${root}/${id}`);
		await loader.readConfig();
		const instance = instances.value[id];
		if (instance) instance.lastVisit = Date.now();
		await flush();
	} catch {
		loader.config = {
			...config,
			plugins: {
				browser: {},
				config: {},
				console: {},
				"database-sqlite": {},
				dataview: {},
				explorer: {
					ignored: ["data"],
				},
				help: {},
				insight: {},
				locales: {},
				logger: {},
				market: {},
				sandbox: {},
				"theme-vanilla": {},
			},
		};
		for (const key in config?.plugins || {}) {
			if (!key.startsWith("~") || !loader.config.plugins[key.slice(1)]) {
				loader.config.plugins[key] = config.plugins[key];
			}
		}
		delete loader.config.shared;
		await fs.writeFile(filename, dump(loader.config));
		instances.value[id] = { name: id, ...config?.share, lastVisit: Date.now() };
		await flush();
		await loader.init(`${root}/${id}`);
	}
	const files = await fs.readdir(`${root}/${id}/data/storage`);
	const storage: Record<string, Record<string, unknown>> = {};
	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		const key = file.slice(0, -5);
		storage[key] = await fs
			.readFile(`${root}/${id}/data/storage/${file}`, "utf8")
			.then(JSON.parse);
	}
	storageData.value = storage;
	const app = await loader.createApp();
	await app.start();
}

/** 判断是否为普通对象（排除 null 与数组）。 */
function isObject(value: any): value is Dict {
	return value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 读取实例索引：优先解析 root/index.json；文件不存在（首次使用或旧版
 * 数据）则扫描 root 下的子目录重建索引，并补齐缺失字段。内容非法时
 * 抛出异常，由调用方（initialize）决定是否重建。
 */
async function getInstances() {
	const handle = await fs.open(`${root}/index.json`, "w+");
	const content = await handle.readFile("utf8");
	const result: Dict<Instance> = content
		? JSON.parse(content)
		: Object.fromEntries(
				(await fs.readdir(root, { withFileTypes: true }))
					.filter((dirent) => dirent.isDirectory())
					.map((dirent) => [dirent.name, {}]),
			);
	if (!isObject(result)) {
		throw new Error("invalid instance index");
	}
	for (const id in result) {
		const instance = result[id];
		if (!instance) continue;
		instance.name ??= id;
		instance.lastVisit ??= 0;
	}
	return result;
}

/**
 * 生成实例分享链接：读取该实例的 koishi.yml 配置，附上元数据后整体
 * base64 编码进 ?share= 查询参数。他人打开链接即以这份配置新建一个
 * 实例（解析逻辑见 initialize）。
 */
export async function shareLink(id: string) {
	const config: any = load(
		await fs.readFile(`${root}/${id}/koishi.yml`, "utf8"),
	);
	config.share = instances.value[id];
	return (
		location.origin + global.uiPath + "?share=" + btoa(JSON.stringify(config))
	);
}

/**
 * 站点启动初始化（由 socket.ts 的 ServerWebSocket 在连接建立后调用）：
 * 准备 VFS 根目录并加载实例索引（索引损坏时清空重建），然后处理两种
 * 进入方式——URL 带 ?share= 参数则用分享配置新建实例并清掉参数，
 * 否则恢复上次选中的实例（没有则新建）。
 */
export async function initialize() {
	await fs.mkdir(root, { recursive: true });
	try {
		instances.value = await getInstances();
	} catch (e) {
		console.warn(e);
		instances.value = {};
		await fs.rm(root, { recursive: true });
		await fs.mkdir(root, { recursive: true });
	}
	const share = new URLSearchParams(location.search).get("share");
	if (share) {
		const config = JSON.parse(atob(share));
		location.replace(location.origin + location.pathname);
		await activate(undefined, undefined, config);
	} else {
		await activate(data.value.current ?? undefined);
	}
}
