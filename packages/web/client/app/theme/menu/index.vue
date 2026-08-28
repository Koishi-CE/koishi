<!--
  全局菜单层：渲染当前处于活动状态的所有上下文菜单（activeMenus）。
  任意 click / contextmenu 事件都视为点击了菜单外区域，关闭全部活动菜单。
-->
<template>
  <template v-for="menu of ctx.internal.activeMenus" :key="menu.id">
    <k-menu v-bind="menu"></k-menu>
  </template>
</template>

<script lang="ts" setup>
import { useContext } from "@koishi-ce/client";
import { useEventListener } from "@vueuse/core";
import KMenu from "./menu.vue";

const ctx = useContext();

// useEventListener 会随组件卸载自动解绑，无需手动清理
useEventListener("click", () => {
	ctx.internal.activeMenus.splice(0);
});

useEventListener("contextmenu", () => {
	ctx.internal.activeMenus.splice(0);
});
</script>
