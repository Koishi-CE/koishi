/**
 * 会话消息发送层：直接发送与排队发送。
 *
 * send 直接调用 bot 发出；sendQueued 进入限速队列按 delay 依次发送，
 * 用于拟人化输出节奏、规避平台风控。cancelQueued 可清空队列并延迟恢复。
 */
import { type Fragment, h, Logger, type Universal } from "@satorijs/core";
import { isNullable } from "cosmokit";
import { SessionCore } from "./core";

const logger = new Logger("session");

/** 排队发送队列中的单个任务。 */
interface Task {
	/** 发送本条消息后距下一条的间隔毫秒数 */
	delay: number;
	/** 消息内容 */
	content: Fragment;
	resolve(ids: string[]): void;
	reject(reason: any): void;
}

/** 会话消息发送层：直接发送与排队发送（限速队列） */
export interface SessionMessaging extends SessionCore {
	_queuedTasks: Task[];
	_queuedTimeout: NodeJS.Timeout | null;
}

export class SessionMessaging extends SessionCore {
	/** 向当前频道发送消息；内容为空直接跳过，失败只记警告不抛错。 */
	override async send(
		fragment: Fragment,
		options: Universal.SendOptions = {},
	): Promise<string[]> {
		const elements = h.normalize(fragment);
		if (!elements.length) return [];
		options.session = this;
		return this.bot
			.sendMessage(this.channelId ?? "", elements, this.event.referrer, options)
			.catch<string[]>((error) => {
				logger.warn(error);
				return [];
			});
	}

	/** 取消全部排队中的消息，并在 delay 毫秒后恢复队列发送。 */
	override cancelQueued(delay = this.app.koishi.config.delay?.cancel ?? 0) {
		clearTimeout(this._queuedTimeout ?? undefined);
		this._queuedTasks = [];
		this._queuedTimeout = setTimeout(() => this._next(), delay);
	}

	/** 队列驱动：发送队首任务并安排下一条的定时器。 */
	_next() {
		const task = this._queuedTasks?.shift();
		if (!task) {
			this._queuedTimeout = null;
			return;
		}
		this.send(task.content).then((ids) => task.resolve(ids ?? []), task.reject);
		this._queuedTimeout = setTimeout(() => this._next(), task.delay);
	}

	/**
	 * 排队发送一条消息。
	 *
	 * 未显式指定 delay 时按配置估算：`max(delay.message, delay.character * 字数)`，
	 * 即消息越长等待越久。
	 */
	override async sendQueued(content: Fragment, delay?: number) {
		const text = h.normalize(content).join("");
		if (!text) return;
		if (isNullable(delay)) {
			const { message = 0, character = 0 } = this.app.koishi.config.delay ?? {};
			delay = Math.max(message, character * text.length);
		}
		return new Promise<string[]>((resolve, reject) => {
			(this._queuedTasks ??= []).push({ content, delay, resolve, reject });
			if (!this._queuedTimeout) this._next();
		});
	}
}
