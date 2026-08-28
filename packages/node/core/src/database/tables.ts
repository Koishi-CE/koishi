import type * as utils from "@koishi-ce/utils";
import type * as minato from "minato";

export interface Types extends minato.Types {}

export interface Tables extends minato.Tables {
	user: User;
	binding: Binding;
	channel: Channel;
}

export interface User {
	id: number;
	name: string;
	/** @deprecated */
	flag: number;
	authority: number;
	locales: string[];
	permissions: string[];
	createdAt: Date;
}

export namespace User {
	export type Flag = 1;

	export type Field = keyof User;
	export type Observed<K extends Field = Field> = utils.Observed<
		Pick<User, K>,
		Promise<void>
	>;
}

// erasableSyntaxOnly 禁止 enum;与同名 namespace 合并声明,保持 User.Flag API
export const User = {
	Flag: {
		ignore: 1,
	},
};

export interface Binding {
	aid: number;
	bid: number;
	pid: string;
	platform: string;
}

export interface Channel {
	id: string;
	platform: string;
	/** @deprecated */
	flag: number;
	assignee: string;
	guildId: string;
	locales: string[];
	permissions: string[];
	createdAt: Date;
}

export namespace Channel {
	export type Flag = 1 | 4;

	export type Field = keyof Channel;
	export type Observed<K extends Field = Field> = utils.Observed<
		Pick<Channel, K>,
		Promise<void>
	>;
}

// erasableSyntaxOnly 禁止 enum;与同名 namespace 合并声明,保持 Channel.Flag API
export const Channel = {
	Flag: {
		ignore: 1,
		silent: 4,
	},
};
