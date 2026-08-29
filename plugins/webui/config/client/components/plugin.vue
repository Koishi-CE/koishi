<template>
  <template v-if="name">
    <k-comment v-if="!local.runtime">
      <p>正在加载插件配置……</p>
    </k-comment>
    <k-comment v-else-if="local.runtime.failed" type="danger">
      <p>插件加载失败，这可能是插件本身的问题所致。{{ hint }}</p>
    </k-comment>

    <k-slot v-else name="plugin-details">
      <!-- 依赖信息：peer 插件依赖与注入服务的加载状态提示 -->
      <k-slot-item :order="800">
        <k-slot name="plugin-dependency" single>
          <k-comment
            v-for="({ required, active }, name) in env.peer" :key="name"
            :type="active ? 'success' : required ? 'warning' : 'primary'">
            <p>
              {{ required ? '必需' : '可选' }}依赖：{{ name }} ({{ active ? '已加载' : '未加载' }})
            </p>
          </k-comment>
          <k-comment
            v-for="({ required }, name) in env.using" :key="name"
            :type="name in store.services ? 'success' : required ? 'warning' : 'primary'">
            <p>
              {{ required ? '必需' : '可选' }}服务：{{ name }} ({{ name in store.services ? '已加载' : '未加载' }})
            </p>
          </k-comment>
        </k-slot>
      </k-slot-item>

      <!-- 实现的服务：本插件将提供哪些服务 -->
      <k-slot-item :order="600">
        <template v-for="name in env.impl" :key="name">
          <k-comment v-if="name in store.services && current.disabled" type="warning">
            <p>此插件将会提供 {{ name }} 服务，但此服务已被其他插件实现。</p>
          </k-comment>
          <k-comment v-else :type="current.disabled ? 'primary' : 'success'">
            <p>此插件{{ current.disabled ? '启用后将会提供' : '提供了' }} {{ name }} 服务。</p>
          </k-comment>
        </template>
      </k-slot-item>

      <!-- 可重用性：不可重用插件的重复启用警告与多份配置提示 -->
      <k-slot-item :order="400">
        <k-comment v-if="local.runtime.id && !local.runtime.forkable && current.disabled" type="warning">
          <p>此插件已在运行且不可重用，启用可能会导致非预期的问题。</p>
        </k-comment>
        <k-comment v-if="plugins.forks[current.name]?.length > 1" type="primary">
          <p>此插件存在多份配置，<span class="k-link" @click.stop="dialogFork = name">点击前往管理</span>。</p>
        </k-comment>
      </k-slot-item>

      <!-- 提供的页面：本插件注册的控制台活动页 -->
      <k-slot-item :order="300">
        <template v-for="(activity, key) in ctx.$router.pages" :key="key">
          <k-comment type="success" v-if="activity.ctx.extension?.paths.includes(current.path) && !activity.disabled()">
            <p>
              <span>此插件提供了页面：</span>
              <k-activity-link :id="activity.id" />
            </p>
          </k-comment>
        </template>
      </k-slot-item>

      <!-- 用法说明：插件自带的 Markdown 文档 -->
      <k-slot-item :order="-200" v-if="local.runtime?.usage">
        <k-markdown unsafe class="usage" :source="local.runtime?.usage"></k-markdown>
      </k-slot-item>

      <!-- 过滤器设置：编辑 $filter 上下文过滤条件 -->
      <k-slot-item :order="-600">
        <k-modifier v-if="local.runtime.filter !== false" v-model="config"></k-modifier>
      </k-slot-item>

      <!-- 配置表单：按 schema 生成的设置项 -->
      <k-slot-item :order="-1000">
        <k-comment v-if="!local.runtime.schema" type="warning">
          <p>此插件未声明配置项，这可能并非预期行为。{{ hint }}</p>
        </k-comment>
        <k-form v-else :schema="local.runtime.schema" :initial="current.config" v-model="config">
          <template #hint>{{ hint }}</template>
        </k-form>
      </k-slot-item>
    </k-slot>
  </template>

  <template v-else>
    <k-slot name="plugin-missing" single>
      <k-comment type="danger">
        <p>此插件尚未安装。</p>
      </k-comment>
    </k-slot>
  </template>
</template>

<script lang="ts" setup>
/**
 * 插件设置面板：配置页右侧针对单个插件的展示区。
 *
 * 按 k-slot（plugin-details）组织内容，各区块有固定 order：
 * 依赖提示（800）、实现的服务（600）、可重用性提示（400）、提供的
 * 页面（300）、用法文档（-200）、过滤器设置（-600）、配置表单（-1000），
 * 其它插件可在这些插槽位之间插入自定义内容。
 * 插件缺少运行时信息时自动发起 config/request-runtime 请求。
 */
import { send, store, useContext } from "@koishi-ce/client";
import { computed, provide, watch } from "vue";
import KModifier from "./modifier.vue";
import { dialogFork, envMap, name, plugins, type Tree } from "./utils";

const props = defineProps<{
	current: Tree;
	modelValue: Record<string, unknown>;
}>();

const emit = defineEmits(["update:modelValue"]);

const ctx = useContext();

const config = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

const env = computed(() => envMap.value[name.value]);
const local = computed(() => store.packages[name.value]);
// 提示语按插件来源区分:工作区插件提示检查源码,市场插件提示联系作者
const hint = computed(() =>
	local.value.workspace ? "请检查插件源代码。" : "请联系插件作者并反馈此问题。",
);

// store 中缺少该插件的运行时信息时,主动向服务端请求解析
watch(
	local,
	(value) => {
		if (!value || value.runtime) return;
		void send("config/request-runtime", value.name);
	},
	{ immediate: true },
);

// 向下注入共享状态,供其它插件的自定义区块取用
provide("plugin:name", name);
provide("plugin:env", env);
provide("manager.settings.local", local);
provide("manager.settings.config", config);
provide(
	"manager.settings.current",
	computed(() => props.current),
);
</script>

<style lang="scss">

.plugin-view {
  .markdown.usage {
    margin-bottom: 2rem;

    h2 {
      font-size: 1.25rem;
    }
  }
}

</style>
