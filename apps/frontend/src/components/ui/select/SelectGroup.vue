<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { SelectGroup, type SelectGroupProps } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps<SelectGroupProps & { class?: HTMLAttributes['class'] }>();
</script>

<template>
  <SelectGroup :class="cn('', props.class)">
    <slot />
  </SelectGroup>
</template>
