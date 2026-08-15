<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { SelectValue, type SelectValueProps } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps<SelectValueProps & { class?: HTMLAttributes['class'] }>();
</script>

<template>
  <SelectValue :class="cn('text-sm', props.class)" v-bind="$attrs">
    <slot />
  </SelectValue>
</template>
