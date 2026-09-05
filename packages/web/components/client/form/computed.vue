<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  计算属性编辑器（schemastery-vue 扩展组件，经 form/index.ts 注册到
  type=union + role=computed 节点）：把配置值表达为 $switch 结构——
  「满足某条件的分支取各自的值，其余走 default」。
  · 未展开成 $switch 时退化为单个 k-schema 渲染，仅追加「添加分支」入口；
  · 展开后每个分支由条件（k-filter-button）与取值（k-schema）组成，
    右键菜单提供分支的上移 / 下移 / 删除 / 上下方插入。
-->
<template>
  <k-schema
    v-bind="$attrs"
    :schema="innerSchema"
    :modelValue="modelValue"
    @update:modelValue="emit('update:modelValue', $event)"
    :disabled="disabled"
    :prefix="prefix"
    :initial="initial"
    :collapsible="isSwitch ? { initial: false } : null"
  >
    <template #title><slot name="title"></slot></template>
    <template #desc>
      <k-markdown :source="tt(schema.meta.description ?? schema.list[0].meta.description)"></k-markdown>
    </template>
    <template #menu>
      <div class="k-menu-separator"></div>
      <div class="k-menu-item" @click="actions.insert()">
        <span class="k-menu-icon"><icon-branch></icon-branch></span>
        添加分支
      </div>
    </template>
    <template #prefix><slot name="prefix"></slot></template>
    <template #suffix>
      <el-button v-if="isSwitch" @click="actions.insert()">添加分支</el-button>
    </template>
    <template #collapse v-if="isSwitch">
      <k-schema
        v-for="(item, index) in modelValue.$switch.branches"
        :modelValue="modelValue.$switch.branches[index].then"
        @update:modelValue="actions.update(index, 'then', $event)"
        :key="index"
        :schema="{ ...innerSchema, meta: { ...innerSchema.meta, description: null } }"
        :disabled="disabled"
      >
        <template #menu>
          <div class="k-menu-separator"></div>
          <div class="k-menu-item" :class="{ disabled: disabled || !index }" @click="actions.up(index)">
            <span class="k-menu-icon"><icon-arrow-up></icon-arrow-up></span>
            上移分支
          </div>
          <div class="k-menu-item" :class="{ disabled: disabled || index === modelValue.$switch.branches.length - 1 }" @click="actions.down(index)">
            <span class="k-menu-icon"><icon-arrow-down></icon-arrow-down></span>
            下移分支
          </div>
          <div class="k-menu-item" :class="{ disabled }" @click="actions.delete(index)">
            <span class="k-menu-icon"><icon-delete></icon-delete></span>
            删除分支
          </div>
          <div class="k-menu-item" :class="{ disabled }" @click="actions.insert(index)">
            <span class="k-menu-icon"><icon-insert-before></icon-insert-before></span>
            在上方插入分支
          </div>
          <div class="k-menu-item" :class="{ disabled }" @click="actions.insert(index + 1)">
            <span class="k-menu-icon"><icon-insert-after></icon-insert-after></span>
            在下方插入分支
          </div>
        </template>
        <template #title>
          <span>当满足条件：</span>
          <k-filter-button
            :modelValue="modelValue.$switch.branches[index].case"
            @update:modelValue="actions.update(index, 'case', $event)"
            :options="schema.meta.extra"
            :disabled="disabled"
          ></k-filter-button>
        </template>
      </k-schema>
      <k-schema
        :modelValue="modelValue.$switch.default"
        @update:modelValue="actions.default"
        :schema="{ ...innerSchema, meta: { ...innerSchema.meta, description: null } }"
        :disabled="disabled"
        :initial="initial?.$switch ? initial.$switch.default : initial"
      >
        <template #title>
          <span>其他情况下</span>
        </template>
      </k-schema>
    </template>
  </k-schema>
</template>

<script lang="ts" setup>
import { clone } from "cosmokit";
import {
	IconArrowDown,
	IconArrowUp,
	IconBranch,
	IconDelete,
	IconInsertAfter,
	IconInsertBefore,
	type Schema,
	useI18nText,
} from "schemastery-vue";
import { computed, type PropType } from "vue";
import KFilterButton from "./k-filter-button.vue";

/** $switch 分支：case 为过滤条件（k-filter 结构），then 为命中时取的配置值 */
interface SwitchBranch {
	case: unknown;
	then: unknown;
	[key: string]: unknown;
}

/** 计算属性值的展开形态：各分支命中取 then，其余走 default */
interface SwitchValue {
	$switch: {
		branches: SwitchBranch[];
		default?: unknown;
	};
}

const props = defineProps({
	schema: {} as PropType<Schema>,
	// 未展开时是任意普通配置值（运行时不受约束），展开后为 $switch 结构
	modelValue: {} as PropType<SwitchValue | null>,
	disabled: {} as PropType<boolean>,
	prefix: {} as PropType<string>,
	initial: {} as PropType<unknown>,
	extra: {} as PropType<unknown>,
});

const emit = defineEmits(["update:modelValue"]);

const tt = useI18nText();

// 内层 schema：沿用外层 meta 但以内层自身的 role 覆写。外层的
// role: computed 专属于本组件，合并时若被内层继承，内层为 union 时
// 会再次命中本扩展的注册条件（type=union + role=computed）导致递归
// 接管、值控件不渲染
// upstream: koishijs/koishi#1382
const innerSchema = computed(() => {
	const { meta, ...rest } = props.schema.list[0];
	return {
		...rest,
		meta: { ...props.schema.meta, ...meta, role: meta.role },
	};
});

// 当前值是否已展开为 $switch 结构（决定渲染单值形态还是分支列表形态）
const isSwitch = computed(() => {
	return (
		props.schema?.meta.role === "computed" &&
		props.modelValue?.$switch
	);
});

// 对分支列表的全部编辑操作：均以不可变方式重建 $switch 对象后整体 emit
const actions = {
	up(index: number) {
		const branches =
			props.modelValue.$switch.branches.slice();
		branches.splice(
			index - 1,
			0,
			...branches.splice(index, 1),
		);
		emit("update:modelValue", {
			$switch: { ...props.modelValue.$switch, branches },
		});
	},
	down(index: number) {
		const branches =
			props.modelValue.$switch.branches.slice();
		branches.splice(
			index + 1,
			0,
			...branches.splice(index, 1),
		);
		emit("update:modelValue", {
			$switch: { ...props.modelValue.$switch, branches },
		});
	},
	delete(index: number) {
		const branches =
			props.modelValue.$switch.branches.slice();
		if (branches.length > 1) {
			branches.splice(index, 1);
			emit("update:modelValue", {
				$switch: { ...props.modelValue.$switch, branches },
			});
		} else {
			// 仅剩最后一个分支时删除整个 $switch，塌缩回普通值（default）
			emit(
				"update:modelValue",
				props.modelValue.$switch["default"],
			);
		}
	},
	update(index: number, key: string, value: unknown) {
		const branches =
			props.modelValue.$switch.branches.slice();
		branches[index] = { ...branches[index], [key]: value };
		emit("update:modelValue", {
			$switch: { ...props.modelValue.$switch, branches },
		});
	},
	insert(
		index: number = props.modelValue?.$switch?.branches
			.length,
	) {
		if (props.modelValue?.$switch) {
			const branches =
				props.modelValue.$switch.branches.slice();
			branches.splice(index, 0, { case: null, then: null });
			emit("update:modelValue", {
				$switch: { ...props.modelValue.$switch, branches },
			});
		} else {
			// 从普通值首次展开为 $switch：原值降级为 default 分支
			emit("update:modelValue", {
				$switch: {
					branches: [{ case: null, then: null }],
					default: clone(props.modelValue),
				},
			});
		}
	},
	default(value: unknown) {
		emit("update:modelValue", {
			$switch: {
				...props.modelValue.$switch,
				default: value,
			},
		});
	},
};
</script>

<style lang="scss">

</style>
