<template>
  <el-dialog
    v-model="visible"
    append-to-body
    :class="'bundle-uninstall-dialog'"
    :title="title || t('bundle.actions.uninstall')"
    width="min(760px, calc(100vw - 24px))"
    destroy-on-close
  >
    <template v-if="packageName">
      <div class="bundle-uninstall-body">
        <!-- 合包标识:fallback 记录(本地推导、非持久化)时给出提示 -->
        <p>
          <strong>{{ recordView?.label || packageName }}</strong>
          {{ t('bundle.messages.isBundle') }}
        </p>

        <p class="bundle-package-name">{{ packageName }}</p>

        <k-comment v-if="recordView?.fallback" type="warning">
          <p>{{ t('bundle.messages.fallbackRecord') }}</p>
        </k-comment>

        <div v-if="loadingRecord" class="bundle-loading">{{ t('bundle.loading') }}</div>

        <template v-else-if="memberRows.length">
          <!-- Bulk Operations Bar -->
          <div class="bundle-bulk-row">
            <span class="bulk-label">{{ t('bundle.bulk.label') }}</span>
            <button class="bundle-section-action" @click="setAllActions('dependency')">{{ t('bundle.bulk.removeDependency') }}</button>
            <span class="bundle-section-spacer">|</span>
            <button class="bundle-section-action" @click="setAllActions('config')">{{ t('bundle.bulk.cleanConfig') }}</button>
            <span class="bundle-section-spacer">|</span>
            <button class="bundle-section-action" @click="setAllActions('keep')">{{ t('bundle.bulk.keepAll') }}</button>
          </div>

          <!-- 成员列表:每行展示本地状态(已装/组内外配置/workspace)并三选一策略 -->
          <div class="bundle-member-list">
            <section v-for="row in memberRows" :key="row.package" class="bundle-member-option">
              <div class="member-main">
                <span class="member-title">{{ row.package }}</span>
                <span class="member-meta">
                  {{ row.required ? t('bundle.members.required') : t('bundle.members.optional') }} · {{ row.version || t('bundle.members.notDeclared') }}
                </span>
              </div>
              <div class="member-state">
                <span>{{ row.installed ? t('bundle.members.dependencyInstalled') : t('bundle.members.dependencyNotInstalled') }}</span>
                <span v-if="row.hasGroupConfig">{{ t('bundle.members.groupConfig') }}</span>
                <span v-if="row.hasExternalConfig" class="warning">{{ t('bundle.members.externalConfig') }}</span>
                <span v-if="row.workspace">{{ t('bundle.members.workspace') }}</span>
              </div>
              <el-radio-group v-model="memberActions[row.package]" size="small">
                <el-radio-button value="config" :disabled="!row.hasGroupConfig">{{ t('bundle.members.cleanGroupConfig') }}</el-radio-button>
                <el-radio-button value="dependency" :disabled="!row.canRemoveDependency">
                  {{ t('bundle.members.removeDependency') }}
                </el-radio-button>
                <el-radio-button value="keep">{{ t('bundle.members.keep') }}</el-radio-button>
              </el-radio-group>
              <p v-if="row.hasExternalConfig" class="member-note">
                {{ t('bundle.conflict.externalNote') }}
              </p>
            </section>
          </div>
        </template>

        <k-comment v-else>
          <p>{{ t('bundle.messages.noMembers') }}</p>
        </k-comment>

        <!-- 底部摘要:卸载/清配置/保留 三类计数 -->
        <div class="bundle-summary">
          <span>{{ t('bundle.summary.remove', { count: dependencyRemovalCount }) }}</span>
          <span>{{ t('bundle.summary.clean', { count: configCleanupCount }) }}</span>
          <span>{{ t('bundle.summary.keep', { count: keepCount }) }}</span>
        </div>

        <p class="bundle-uninstall-note">
          {{ t('bundle.messages.outsideConfig') }}
        </p>
      </div>
    </template>
    <template v-else>
      <k-comment type="warning">
        <p>{{ t('bundle.messages.noDependency') }}</p>
      </k-comment>
    </template>

    <template #footer>
      <el-button @click="visible = false">{{ t('bundle.actions.cancel') }}</el-button>
      <el-button type="danger" :loading="loadingRecord || uninstalling" :disabled="!packageName" @click="uninstallBundle">
        {{ t('bundle.actions.uninstall') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * @file 合包(bundle)卸载对话框。
 *
 * 按成员粒度决定卸载策略:每个成员可选"卸载依赖 / 仅清组内配置 / 保留",
 * 汇总后要么直接执行(override 里合包与所选成员版本置空串,交给
 * shared/operations 的 install(),成功回调再清组配置与合包记录),要么在
 * 批量模式下暂存进 pendingBundleUninstalls 等确认对话框统一执行。
 *
 * 消费方:dialogs/install/index.vue(依赖卸载入口)、extensions/version/index.vue
 * (插件详情页)、extensions/bundle-group-uninstall/index.vue(配置树分组右键)。
 * 记录来源优先 props.record,缺则用 fetchBundleRecord 拉取。
 */

import {
	message,
	router,
	send,
	store,
	useConfig,
	useContext,
} from "@koishi-ce/client";
import { computed, reactive, ref, watch } from "vue";
import type { PluginBundleRecord } from "../../../src/shared/bundle";
import { getBundleGroupIdent } from "../../../src/shared/bundle-idents";
import { useMarketNextI18n } from "../../shared/i18n";
import {
	type BundleMemberCleanupTarget,
	type BundleRecordView,
	fetchBundleRecord,
	getBundleMemberConfigState,
	install,
	pendingBundleUninstalls,
} from "../../shared/operations";
import {
	getBulkMode,
	getPendingOverrides,
	getWritableBundleRecords,
	patchMarketNextData,
} from "../../shared/plugin-config";

/** 成员级卸载策略:config=仅清组内配置,dependency=卸载依赖(含清配置),keep=保留不动。 */
type MemberAction = "config" | "dependency" | "keep";

/** 宿主运行所必需的依赖,禁止从这里卸载。 */
const protectedDeps = new Set([
	"@koishijs/plugin-console",
	"@koishi-ce/plugin-config",
	"@koishijs/plugin-server",
]);

const props = defineProps<{
	modelValue: boolean;
	packageName?: string;
	record?: BundleRecordView | PluginBundleRecord;
	title?: string;
	redirectToPlugins?: boolean;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: boolean];
	done: [];
}>();

const config = useConfig();
const { t } = useMarketNextI18n();

/** 批量操作:一键设置所有成员策略,不可行者自动降级(卸载→清配置/保留)。 */
function setAllActions(action: MemberAction) {
	for (const row of memberRows.value) {
		if (action === "dependency") {
			memberActions[row.package] = row.canRemoveDependency
				? "dependency"
				: row.hasGroupConfig
					? "config"
					: "keep";
		} else if (action === "config") {
			memberActions[row.package] = row.hasGroupConfig ? "config" : "keep";
		} else {
			memberActions[row.package] = "keep";
		}
	}
}
const ctx = useContext();
/** 记录拉取中/卸载执行中标记。 */
const loadingRecord = ref(false);
const uninstalling = ref(false);
/** props.record 缺失时通过 fetchBundleRecord 拉到的远端记录。 */
const remoteRecord = ref<BundleRecordView>();
/** 各成员当前选择的策略,key 为成员包名。 */
const memberActions = reactive<Record<string, MemberAction>>({});

/** 目标合包包名(props 缺省时为空串,模板据此展示兜底提示)。 */
const packageName = computed(() => props.packageName || "");
/** v-model 开关的读写代理。 */
const visible = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

/** 生效的合包记录视图:props.record 带成员时优先,其次远端记录,最后原样返回。 */
const recordView = computed(() => {
	if (props.record?.members?.length) return props.record;
	if (remoteRecord.value?.package === packageName.value)
		return remoteRecord.value;
	return props.record;
});

/**
 * 成员展示行:在记录成员之上叠加本地现状——是否已装、是否 workspace、
 * 组内/组外是否有配置、能否卸载依赖(workspace、invalid、受保护依赖、
 * 组外还有配置的都不可卸载)。
 */
const memberRows = computed(() => {
	const groupKey =
		recordView.value?.groupKey ||
		(packageName.value
			? `group:${getBundleGroupIdent(packageName.value)}`
			: undefined);
	return (recordView.value?.members ?? []).map((member) => {
		const dep = store.dependencies?.[member.package];
		const state = getBundleMemberConfigState(ctx, member, groupKey);
		const installed = !!dep;
		const blocked =
			!!dep?.workspace || !!dep?.invalid || protectedDeps.has(member.package);
		const hasExternalConfig = !!state.external.length;
		return {
			...member,
			installed,
			workspace: !!dep?.workspace,
			hasGroupConfig: !!state.group.length,
			hasExternalConfig,
			canRemoveDependency: installed && !blocked && !hasExternalConfig,
		};
	});
});

/** 策略为"卸载依赖"且确实可卸载的成员。 */
const dependencyRemovalMembers = computed(() =>
	memberRows.value.filter(
		(row) =>
			memberActions[row.package] === "dependency" && row.canRemoveDependency,
	),
);
/** 策略为"卸载依赖"或"仅清配置"且组内有配置的成员(配置清理目标)。 */
const configCleanupMembers = computed(() =>
	memberRows.value
		.filter(
			(row) =>
				memberActions[row.package] === "dependency" ||
				memberActions[row.package] === "config",
		)
		.filter((row) => row.hasGroupConfig),
);
/** 底部摘要的三项计数;keepCount 按"未被前两类触及"的成员去重统计。 */
const dependencyRemovalCount = computed(
	() => dependencyRemovalMembers.value.length,
);
const configCleanupCount = computed(() => configCleanupMembers.value.length);
const keepCount = computed(() =>
	Math.max(
		0,
		memberRows.value.length -
			new Set([
				...dependencyRemovalMembers.value.map((row) => row.package),
				...configCleanupMembers.value.map((row) => row.package),
			]).size,
	),
);

/** 每次打开时清空远端记录并重新拉取,再按新行数据重置策略。 */
watch(
	visible,
	async (value) => {
		if (!value) return;
		remoteRecord.value = undefined;
		await loadRecord();
		resetActions();
	},
	{ immediate: true },
);

/** 成员行数据变化(store 刷新等)时,只给新出现的行补默认策略、清掉消失的行。 */
watch(memberRows, () => {
	if (visible.value) resetActions(false);
});

/** props.record 缺失时向服务端拉取合包记录(fetchBundleRecord 带本地回退)。 */
async function loadRecord() {
	const name = packageName.value;
	if (!name || props.record?.members?.length) return;
	loadingRecord.value = true;
	try {
		const record = await fetchBundleRecord(name);
		if (record) remoteRecord.value = record;
	} catch (error) {
		console.warn(error);
		message.warning(t("bundle.messages.recordFailed"));
	} finally {
		loadingRecord.value = false;
	}
}

/** 重置成员策略:force 全量重置;非 force 时保留用户已手动改过的行。 */
function resetActions(force = true) {
	const seen = new Set<string>();
	for (const row of memberRows.value) {
		seen.add(row.package);
		if (!force && memberActions[row.package]) continue;
		memberActions[row.package] = getDefaultAction(row);
	}
	for (const key of Object.keys(memberActions)) {
		if (!seen.has(key)) delete memberActions[key];
	}
}

/** 成员默认策略:组外有配置则不卸载;因合包新装的默认卸载;组内有配置默认清理;否则保留。 */
function getDefaultAction(
	row: (typeof memberRows.value)[number],
): MemberAction {
	if (row.hasExternalConfig) return row.hasGroupConfig ? "config" : "keep";
	if (row.canRemoveDependency && row.installedByBundle === true)
		return "dependency";
	if (row.hasGroupConfig) return "config";
	return "keep";
}

/** 取批量模式共享的待应用覆盖清单(marketData.override)。 */
function ensureOverride() {
	return getPendingOverrides();
}

/** 组装配置清理目标列表(成员包名 + 插件键,供 remove-bundle-configs 定位)。 */
function getCleanupTargets(): BundleMemberCleanupTarget[] {
	return configCleanupMembers.value.map((member) => ({
		package: member.package,
		plugin: member.plugin,
	}));
}

/**
 * 执行卸载:override = 合包 + 所选成员全部置空串(卸载)。
 * 批量模式只把变更暂存进 override 与 pendingBundleUninstalls,关窗即止;
 * 直接模式调 install(),成功回调里清组配置(remove-bundle-configs)、
 * 删除合包持久化记录、按需跳转插件页并 emit done。
 */
async function uninstallBundle() {
	const name = packageName.value;
	if (!name || uninstalling.value) return;
	const members = dependencyRemovalMembers.value.map(
		(member) => member.package,
	);
	const configs = getCleanupTargets();
	const override = {
		[name]: "",
		...Object.fromEntries(members.map((name) => [name, ""])),
	};

	if (getBulkMode(config.value)) {
		const overrides = ensureOverride();
		Object.assign(overrides, override);
		void patchMarketNextData({ override: { ...overrides } });
		pendingBundleUninstalls.value[name] = {
			members,
			cleanup: !!configs.length,
			configs,
		};
		visible.value = false;
		message.success(
			t("bundle.messages.stagedUninstall", {
				members: members.length,
				configs: configs.length,
			}),
		);
		return;
	}

	visible.value = false;
	uninstalling.value = true;
	try {
		await install(
			override,
			async () => {
				if (configs.length) {
					await send("market/remove-bundle-configs", {
						package: name,
						members: configs,
						removeEmptyGroup: true,
					});
				}
				const records = getWritableBundleRecords(config.value);
				delete records[name];
				const saved = await patchMarketNextData({ bundleRecords: records });
				if (!saved) message.warning(t("bundle.messages.recordSaveFailed"));
				if (props.redirectToPlugins) await router.replace("/plugins");
				emit("done");
			},
			undefined,
			{
				loadingText: t("bundle.messages.uninstalling"),
				successText: t("bundle.messages.uninstalled"),
				errorText: t("bundle.messages.uninstallFailed"),
				timeoutText: t("bundle.messages.uninstallTimeout"),
			},
		);
	} finally {
		uninstalling.value = false;
	}
}
</script>

<style lang="scss" scoped src="./index.scss"></style>
