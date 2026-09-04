<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <virtual-list class="log-list k-text-selectable" :data="logs" :count="300" :max-height="maxHeight">
    <template #="record">
      <div :class="{ line: true, start: isStart(record) }">
        <code v-html="renderLine(record)"></code>
        <router-link
          class="log-link inline-flex items-center justify-center absolute w-20px h-20px bottom-0 right-0"
          v-if="showLink && store.config && store.packages && record.meta?.paths?.length"
          :to="'/plugins/' + record.meta.paths[0].replace(/\./, '/')"
        >
          <k-icon name="arrow-right"/>
        </router-link>
      </div>
    </template>
  </virtual-list>
</template>

<script lang="ts" setup>
/*
 * 通用日志列表组件（日志页与插件详情共用）：
 * 虚拟滚动渲染全部记录，把每条记录拼装成带 ANSI 颜色的终端风格行，
 * 可选显示指向日志来源插件的跳转链接；本次启动的首条日志上方绘制分隔线。
 */
import {
	store,
	Time,
	VirtualList,
} from "@koishi-ce/client";
import {} from "@koishi-ce/plugin-config";
import { AnsiUp } from "ansi_up";
import { Logger, type Message } from "reggol";

// reggol v2 移除了 Logger.Record 类型别名,此处等价替代
interface LogRecord extends Message {
	id: number;
	timestamp: number;
	content: string;
}

const props = defineProps<{
	logs: LogRecord[];
	showLink?: boolean;
	maxHeight?: string;
}>();

// ansi_up 在不同环境下的导出形状不一致，因此这里统一按实例化后使用
const converter = new AnsiUp();

/** 生成一段 ANSI 颜色转义序列（8/16 色码 + 可选装饰，如加粗 ";1"）。 */
function renderColor(
	code: number,
	value: string,
	decoration = "",
) {
	return `\u001b[3${code < 8 ? code : `8;5;${code}`}${decoration}m${value}\u001b[0m`;
}

const showTime = "yyyy-MM-dd hh:mm:ss";

/**
 * 判断某行是否是本次启动的首条日志：
 * 前一行 id 更大（说明日志序号回绕，即重启）且来源为 app 时成立，
 * 用于在两次启动的日志之间画分隔线。
 */
function isStart(record: LogRecord & { index: number }) {
	return (
		record.index &&
		props.logs[record.index - 1].id > record.id &&
		record.name === "app"
	);
}

/**
 * 拼装单行日志：时间戳 + [级别] + 作用域名（按名称散列取色、对齐补白）+ 正文，
 * 多行正文按首行缩进对齐，最后整体交给 AnsiUp 转成带颜色的 HTML。
 */
function renderLine(record: LogRecord) {
	const prefix = `[${record.type[0].toUpperCase()}]`;
	const space = " ";
	let indent = 3 + space.length,
		output = "";
	indent += showTime.length + space.length;
	output +=
		renderColor(
			8,
			Time.template(showTime, new Date(record.timestamp)),
		) + space;
	const code = Logger.code(record.name, { colors: 3 });
	const label = renderColor(code, record.name, ";1");
	const padLength = label.length - record.name.length;
	output +=
		prefix + space + label.padEnd(padLength) + space;
	output += record.content.replace(
		/\n/g,
		`\n${" ".repeat(indent)}`,
	);
	return converter.ansi_to_html(output);
}
</script>

<style lang="scss" scoped>

.log-list {
  color: var(--terminal-fg);
  background-color: var(--terminal-bg);

  :deep(.el-scrollbar__view) {
    padding: 1rem 1rem;
  }

  .line.start {
    margin-top: 1rem;

    &::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: -0.5rem;
      border-top: 1px solid var(--terminal-separator);
    }
  }

  .line:first-child {
    margin-top: 0;

    &::before {
      display: none;
    }
  }

  .line {
    padding: 0 0.5rem;
    border-radius: 2px;
    font-size: 14px;
    line-height: 20px;
    white-space: pre-wrap;
    word-break: break-all;
    position: relative;

    &:hover {
      color: var(--terminal-fg-hover);
      background-color: var(--terminal-bg-hover);
    }

    ::selection {
      background-color: var(--terminal-bg-selection);
    }
  }
}

</style>
