<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  布局顶栏：左侧标题（默认取当前路由名）、右侧菜单区，
  移动端额外提供侧栏开关按钮与溢出菜单（"..."）按钮。
-->
<template>
  <div class="layout-header" :class="{ 'has-menu': menuKey }">
    <div
      class="toggle-sidebar-button"
      role="button"
      tabindex="0"
      @click="$emit('update:isLeftAsideOpen', !isLeftAsideOpen)"
    >
      <div class="icon">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
    <div class="left">
      <slot name="left">{{ route.name }}</slot>
    </div>
    <div class="right">
      <slot name="right"></slot>
    </div>
    <div class="toggle-menu-button"
      v-if="menuKey"
      role="button"
      tabindex="1"
      @click.stop="trigger($event, menuData)"
    >
      <k-icon name="ellipsis"></k-icon>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {
	type ActionContext,
	useMenu,
} from "@koishi-ce/client";
import { useRoute } from "vue-router";

const props = defineProps<{
	isLeftAsideOpen: boolean;
	isRightAsideOpen: boolean;
	menuKey?: string;
	menuData?: unknown;
}>();

// 溢出菜单按钮的点击触发器：打开 menuKey 对应的上下文菜单
// （menuKey 为运行期字符串，这里断言为菜单键类型以复用字面量重载）
const trigger = useMenu(
	props.menuKey as keyof ActionContext,
);

defineEmits([
	"update:isLeftAsideOpen",
	"update:isRightAsideOpen",
]);

const route = useRoute();
</script>

<style lang="scss">

.toggle-sidebar-button {
  position: absolute;
  top: 0;
  height: 100%;
  left: 1rem;
  display: none;
  cursor: pointer;
}

.toggle-sidebar-button .icon {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 1.25rem;
  height: 100%;
  cursor: inherit;

  span {
    display: inline-block;
    width: 100%;
    height: 2px;
    border-radius: 2px;
    background-color: var(--fg1);
    transition: transform 0.3s ease;

    &:nth-child(2) {
      margin: 6px 0;
    }
  }
}

.toggle-menu-button {
  display: none;
  height: 100%;
  width: var(--header-height);
  align-items: center;
  justify-content: center;

  .k-icon {
    height: 1.25rem;
  }
}

@media screen and (max-width: 768px) {
  .toggle-sidebar-button {
    display: block;
  }

  .toggle-menu-button {
    display: flex;
  }

  .layout-header.has-menu .right {
    display: none;
  }
}

.layout-header {
  position: relative;
  box-sizing: border-box;
  height: var(--header-height);
  flex: 0 0 auto;
  background-color: inherit;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  border-bottom: var(--k-color-divider-dark) 1px solid;
  transition: var(--color-transition);
  font-weight: bolder;

  .left {
    margin-left: var(--header-height);
    padding-left: 0.5rem;
  }

  .right {
    margin-right: 0.5rem;
    flex: 0 0 auto;
  }

  .menu-item {
    position: relative;
    width: 4rem;
    height: var(--header-height);
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: var(--color-transition);

    &.active {
      color: var(--k-color-primary);
    }

    &.spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% {
        transform: rotate(0deg);
      }
      100% {
        transform: rotate(360deg);
      }
    }

    &.disabled {
      opacity: 0.3;
      pointer-events: none;

      @media screen and (max-width: 768px) {
        display: none;
      }
    }

    .menu-icon {
      height: 1.125rem;
    }

    @media screen and (max-width: 768px) {
      width: 3rem;
    }
  }
}

</style>
