import { store } from "@koishi-ce/client";
import { gt } from "semver";
import { ref } from "vue";

export const active = ref("");

export function hasUpdate(name: string) {
	const versions = store.registry?.[name];
	const local = store.dependencies?.[name];
	if (!versions || !local || local.workspace) return;
	const [latest] = Object.keys(versions);
	if (latest === undefined || local.resolved === undefined) return;
	try {
		return gt(latest, local.resolved);
	} catch {
		return undefined;
	}
}
