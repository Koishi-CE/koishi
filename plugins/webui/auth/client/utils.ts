import { useStorage } from "@koishi-ce/client";
import type { LoginToken } from "@koishi-ce/plugin-auth";
import { ref } from "vue";

declare module "@koishi-ce/client" {
	interface Config {
		sync?: boolean;
	}
}

interface SharedConfig extends Partial<LoginToken> {
	sync?: boolean;
	name?: string;
	authType: 0 | 1;
	platform?: string;
	userId?: string;
	password?: string;
}

export const shared = useStorage<SharedConfig>("auth", 2, () => ({
	authType: 0,
}));

export const showLoginDialog = ref(false);
export const showSyncDialog = ref(false);
