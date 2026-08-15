<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { SelectTrigger, type SelectTriggerProps, useForwardProps } from 'reka-ui';
import { ChevronDown } from 'lucide-vue-next';
import { cn } from '@/lib/utils';

const props = defineProps<SelectTriggerProps & { class?: HTMLAttributes['class'] }>();
const forwarded = useForwardProps(props);
</script>

<template>
  <SelectTrigger
    v-bind="forwarded"
    :class="
      cn(
        'flex h-10 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate',
        props.class,
      )
    "
  >
    <slot />
    <ChevronDown class="size-4 shrink-0 text-muted-foreground" />
  </SelectTrigger>
</template>
