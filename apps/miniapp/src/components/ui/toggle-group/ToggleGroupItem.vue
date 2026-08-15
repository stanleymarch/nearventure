<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import {
  ToggleGroupItem,
  type ToggleGroupItemProps,
  useForwardProps,
} from 'reka-ui';
import { cn } from '@/lib/utils';
import {
  toggleVariants,
  type ToggleVariants,
} from '@/components/ui/toggle';

const props = defineProps<
  ToggleGroupItemProps & {
    class?: HTMLAttributes['class'];
    variant?: ToggleVariants['variant'];
    size?: ToggleVariants['size'];
  }
>();
const delegatedProps = reactiveOmit(props, 'class', 'variant', 'size');
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <ToggleGroupItem
    v-bind="forwardedProps"
    :class="cn(toggleVariants({ variant, size }), props.class)"
  >
    <slot />
  </ToggleGroupItem>
</template>
