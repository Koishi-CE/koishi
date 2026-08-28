import type { Universal } from "@koishi-ce/client";

// Universal.Status 是 @satorijs/protocol 声明的 ambient const enum，
// verbatimModuleSyntax 下无法以值形式访问其成员，
// 这里按该枚举定义镜像等值常量（OFFLINE=0 … RECONNECT=4），
// Record 的键联合与枚举成员一一对应以防遗漏
const botStatus: Record<
	"OFFLINE" | "ONLINE" | "CONNECT" | "DISCONNECT" | "RECONNECT",
	number
> = {
	OFFLINE: 0,
	ONLINE: 1,
	CONNECT: 2,
	DISCONNECT: 3,
	RECONNECT: 4,
};

export function getStatus(status: Universal.Status) {
	switch (status) {
		case botStatus.OFFLINE:
			return "offline";
		case botStatus.ONLINE:
			return "online";
		case botStatus.CONNECT:
			return "connect";
		case botStatus.DISCONNECT:
			return "disconnect";
		case botStatus.RECONNECT:
			return "reconnect";
	}
}
