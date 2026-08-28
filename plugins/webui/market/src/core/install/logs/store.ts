/**
 * 安装日志的写入端：单次安装会话的日志落盘、实时广播与元数据维护。
 *
 * 设计要点：
 * - 一条会话 = 一个 `.log` 文本 + 一个 `.log.json` 结构化元数据；
 *   文本头部写入 legacy 兼容字段（startedAt/deps/forced 等），供 reader
 *   在元数据缺失时回退解析。
 * - 追加写入串行化：writeTask Promise 链保证多路 emit 顺序落盘且互不竞争，
 *   finish 前通过 waitForWrite 等待全部排空（reader 读活跃文件时依赖此语义）。
 * - 广播与落盘共用 sanitizeInstallLogText 清洗 ANSI 转义，避免控制序列
 *   污染 console 前端与日志文件。
 *
 * 协作关系：InstallExecutor 在安装开始时 start、执行中 emit、finally 中 finish；
 * reader.ts 通过 activeFile/waitForWrite 读取活跃会话。
 */
import { promises as fsp } from "node:fs";
import { basename, resolve } from "node:path";
import type { Dict } from "@koishi-ce/koishi";
import stripAnsi from "strip-ansi";
import { formatDeps } from "../pipeline/planner.js";
import type {
	InstallHistoryChange,
	InstallHistoryMetadata,
	InstallLogger,
	InstallOptions,
} from "../types.js";
import { getInstallLogDir, type InstallLogRetention } from "./retention.js";

/**
 * 清洗日志文本中的 ANSI 转义序列（strip-ansi 社区标准实现），再去掉
 * 孤立的 \r（保留 CRLF 换行）。广播与落盘前统一调用，防止控制字符
 * 进入前端与文件。
 */
export function sanitizeInstallLogText(value: string) {
	return stripAnsi(value).replace(/\r(?!\n)/g, "");
}
/** 时间戳转文件名安全格式（ISO 串中的 : 与 . 替换为 -）。 */
function formatLogTimestamp(value: number) {
	return new Date(value).toISOString().replace(/[:.]/g, "-");
}

/** 把依赖摘要压成文件名片段：非法字符折叠为 -，去首尾 -，截断 80 字符。 */
function sanitizeLogSegment(value: string) {
	return (
		value
			.replace(/[^a-z0-9@._+-]+/gi, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "operation"
	);
}

/** 写入端依赖面：目录、清理器、前端广播通道与成功后回填 resolved 的取值器。 */
export interface InstallLogStoreDeps {
	cwd: string;
	log: InstallLogger;
	retention: InstallLogRetention;
	/** 广播到 console 前端（market/install-log 通道） */
	broadcast: (type: "stdout" | "stderr", line: string) => void;
	/** 成功后回填 afterResolved（依赖缓存的最新值） */
	resolveAfter: (name: string) => string | undefined;
}

/** finish 的收尾结果（由 InstallExecutor 的 runInstallLocked 在 finally 传入）。 */
interface InstallLogFinishResult {
	code?: number | null;
	failed?: boolean;
	reason?: string;
}

/** 单次安装会话的日志写盘 + 广播 + 元数据维护。 */
export class InstallLogStore {
	/** 当前会话的日志文件路径；undefined 表示无进行中的会话。 */
	private file: string | undefined;
	/** 当前会话的元数据文件路径（`${file}.json`）。 */
	private metadataFile: string | undefined;
	/** 当前会话的元数据（start 时创建、finish 时定稿）。 */
	private metadata: InstallHistoryMetadata | undefined;
	/** 追加写串行链：所有 write/emit 按序落盘，出错仅记 debug 不断链。 */
	private writeTask = Promise.resolve();
	private readonly deps: InstallLogStoreDeps;

	constructor(deps: InstallLogStoreDeps) {
		this.deps = deps;
	}

	/** 当前活跃日志文件（reader 与 retention 据此跳过/等待）。 */
	get activeFile() {
		return this.file;
	}

	/** 当前活跃元数据文件（清理时跳过）。 */
	get activeMetadataFile() {
		return this.metadataFile;
	}

	/** 当前会话元数据（只读视图；finalizeInstall 用其 id 关联环境快照）。 */
	get activeMetadata() {
		return this.metadata;
	}

	/** 等待所有已排队的日志写入落盘（reader 读活跃文件前调用）。 */
	async waitForWrite() {
		await this.writeTask;
	}

	/**
	 * 开始一次安装会话：清理过期日志 → 建目录 → 写入带 legacy 头字段的
	 * `.log` 与初始 `.log.json`（status=running）。元数据写失败只记 debug，
	 * 不阻断安装（日志是尽力而为的旁路功能）。
	 */
	async start(
		deps: Dict<string>,
		forced?: boolean,
		options: InstallOptions = {},
		changes: InstallHistoryChange[] = [],
	) {
		await this.deps.retention.cleanup();
		const dir = getInstallLogDir(this.deps.cwd);
		await fsp.mkdir(dir, { recursive: true });
		const now = Date.now();
		const suffix = sanitizeLogSegment(formatDeps(deps) || "noop");
		// 文件名 = 时间戳 + 依赖摘要（无依赖时记为 noop）
		const file = resolve(dir, `${formatLogTimestamp(now)}-${suffix}.log`);
		const id = basename(file);
		await fsp.writeFile(
			file,
			// 头部字段供 reader 的 legacy 解析路径使用，需与元数据保持一致
			[
				"market-next dependency operation log",
				`startedAt: ${new Date(now).toISOString()}`,
				`cwd: ${this.deps.cwd}`,
				`deps: ${formatDeps(deps) || "(none)"}`,
				`forced: ${!!forced}`,
				`installEndpoint: ${options.installEndpoint || "(default)"}`,
				"",
			].join("\n"),
		);
		this.file = file;
		this.metadataFile = `${file}.json`;
		this.metadata = {
			version: 1,
			id,
			startedAt: now,
			status: "running",
			deps: formatDeps(deps) || "(none)",
			forced: !!forced,
			installEndpoint: options.installEndpoint || undefined,
			changes,
		};
		this.writeTask = Promise.resolve();
		await this.writeMetadata().catch((error) => {
			this.deps.log.debug(
				`failed to write install log metadata ${this.metadataFile}: ${error instanceof Error ? error.message : error}`,
			);
		});
		this.deps.log.info(`dependency install log started: ${file}`);
	}

	/** 广播一行并落盘（先 ANSI 清洗，广播与文件内容保持一致）。 */
	emit(type: "stdout" | "stderr", line: string) {
		const cleanLine = sanitizeInstallLogText(line);
		this.deps.broadcast(type, cleanLine);
		this.write(type, cleanLine);
	}

	/** 以 `[时间] [stdout|stderr] 行` 格式排队追加写入；无活跃会话时静默丢弃。 */
	write(type: string, line: string) {
		const file = this.file;
		if (!file) return;
		const text = `[${new Date().toISOString()}] [${type}] ${line}\n`;
		this.writeTask = this.writeTask
			.then(() => fsp.appendFile(file, text))
			.catch((error) => {
				this.deps.log.debug(
					`failed to write install log ${file}: ${error instanceof Error ? error.message : error}`,
				);
			});
	}

	/**
	 * 收尾当前会话：补写结束标记（退出码缺失/非零/成功三态）、等待写入排空、
	 * 定稿元数据（status/finishedAt，成功时回填各依赖的 afterResolved）、
	 * 最后清空会话状态。失败详情由调用方的 catch 路径提前 emit，此处不重复。
	 */
	async finish(result?: InstallLogFinishResult) {
		if (!this.file) return;
		this.writeFinishMarker(result);
		await this.writeTask;
		await this.finalizeMetadata(result);
		this.deps.log.info(`dependency install log saved: ${this.file}`);
		this.resetSession();
	}

	/** 补写结束标记（失败详情已由 catch 路径 emit，仅区分三态收尾）。 */
	private writeFinishMarker(result: InstallLogFinishResult | undefined) {
		if (result?.failed) {
			// 失败详情已由 catch 路径 emit，这里仅收尾。
		} else if (result?.code == null) {
			// 无退出码：进程被信号杀死或启动失败，视作异常结束
			this.write(
				"stderr",
				"dependency operation ended without a package manager exit code",
			);
		} else if (result.code) {
			this.write(
				"stderr",
				`dependency operation finished with code ${result.code}`,
			);
		} else {
			this.write("stdout", "dependency operation finished with code 0");
		}
	}

	/** 定稿元数据：status/finishedAt，成功时回填各依赖的 afterResolved；写失败只记 debug。 */
	private async finalizeMetadata(result: InstallLogFinishResult | undefined) {
		if (!this.metadata) return;
		const success = !result?.failed && result?.code === 0;
		this.metadata.status = success ? "success" : "error";
		this.metadata.finishedAt = Date.now();
		if (success) {
			// 安装成功后从依赖缓存取最新 resolved，补齐历史「变更」的 after 一侧
			this.metadata.changes = this.metadata.changes.map((change) => ({
				...change,
				afterResolved: this.deps.resolveAfter(change.name) ?? null,
			}));
		}
		await this.writeMetadata().catch((error) => {
			this.deps.log.debug(
				`failed to finish install log metadata ${this.metadataFile}: ${error instanceof Error ? error.message : error}`,
			);
		});
	}

	/** 清空会话状态（finish 的最后一步）。 */
	private resetSession() {
		this.file = undefined;
		this.metadataFile = undefined;
		this.metadata = undefined;
		this.writeTask = Promise.resolve();
	}

	private async writeMetadata() {
		if (!this.metadataFile || !this.metadata) return;
		await fsp.writeFile(
			this.metadataFile,
			`${JSON.stringify(this.metadata, null, 2)}\n`,
		);
	}
}
