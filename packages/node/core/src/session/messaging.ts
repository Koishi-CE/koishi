import { type Fragment, h, Logger, type Universal } from "@satorijs/core";
import { isNullable } from "cosmokit";
import { SessionCore } from "./core";

const logger = new Logger("session");

interface Task {
	delay: number;
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

	override cancelQueued(delay = this.app.koishi.config.delay?.cancel ?? 0) {
		clearTimeout(this._queuedTimeout ?? undefined);
		this._queuedTasks = [];
		this._queuedTimeout = setTimeout(() => this._next(), delay);
	}

	_next() {
		const task = this._queuedTasks?.shift();
		if (!task) {
			this._queuedTimeout = null;
			return;
		}
		this.send(task.content).then((ids) => task.resolve(ids ?? []), task.reject);
		this._queuedTimeout = setTimeout(() => this._next(), task.delay);
	}

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
