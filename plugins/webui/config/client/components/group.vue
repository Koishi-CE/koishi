<template>
  <k-modifier v-model="config"></k-modifier>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import KModifier from "./modifier.vue";
import type { Tree } from "./utils";

const props = defineProps<{
	current: Tree;
	modelValue: any;
}>();

const emit = defineEmits(["update:modelValue"]);

const config = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});
</script>

<style lang="scss" scoped>

h2 {
  font-size: 1.25rem;
}

</style>
