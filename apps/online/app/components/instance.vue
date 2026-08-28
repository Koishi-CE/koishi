<template>
  <!-- 单个实例卡片：头部为可编辑的实例名称，底部为操作按钮组 -->
  <k-card class="instance">
    <template #header>
      <input v-model="model"/>
    </template>
    <template #footer>
      <!-- 当前实例：仅展示运行中状态，不可操作 -->
      <template v-if="data.current === id">
        <el-button disabled>
          运行中
        </el-button>
      </template>
      <!-- 非当前实例：可切换、可删除 -->
      <template v-else>
        <el-button @click="activate(id, $event)">
          <k-icon name="start"></k-icon>
          切换
        </el-button>
        <el-button @click="remove(id)">
          <k-icon name="delete"></k-icon>
          删除
        </el-button>
      </template>
      <el-button @click="share(id)">
        <k-icon name="share"></k-icon>
        分享
      </el-button>
    </template>
  </k-card>
</template>

<script lang="ts" setup>
// 实例卡片组件：被 instances.vue 复用，props 为实例 id 与 Instance 元数据。
import { message } from "@koishi-ce/client";
import { computed } from "vue";
import {
	activate,
	data,
	flush,
	type Instance,
	instances,
	remove,
	shareLink,
} from "../utils";

const props = defineProps<{ id: string } & Instance>();

// 名称输入框的双向绑定：写入即更新索引条目并落盘
const model = computed({
	get: () => props.name,
	set: (value) => {
		instances.value[props.id].name = value;
		void flush();
	},
});

/** 生成该实例的分享链接并复制到剪贴板。 */
async function share(id: string) {
	const link = await shareLink(id);
	await navigator.clipboard.writeText(link);
	message.success("已复制分享链接");
}
</script>

<style lang="scss" scoped>

.k-card.instance {
  input {
    outline: none;
    background-color: transparent;
    font-size: 1.25rem;
    font-weight: 500;
    border: none;
    color: inherit;
  }

  :deep(.k-card-body) {
    flex: 1 1 auto;
  }

  :deep(footer) {
    margin: 0;
    padding: 0;
    height: 3rem;
    display: flex;

    .el-button {
      flex: 1 1 auto;
      margin: 0;
      height: 100%;
      border-radius: 0;

      &:first-child {
        border-bottom-left-radius: 8px;
      }
      &:last-child {
        border-bottom-right-radius: 8px;
      }
    }

    .k-icon {
      margin-right: 0.5rem;
    }
  }
}

</style>
