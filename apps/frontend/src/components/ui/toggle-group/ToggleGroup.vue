<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import {
  ToggleGroupRoot,
  type ToggleGroupRootProps,
  type ToggleGroupRootEmits,
  useForwardPropsEmits,
} from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps<
  ToggleGroupRootProps & { class?: HTMLAttributes['class'] }
>();
const emits = defineEmits<ToggleGroupRootEmits>();
const delegatedProps = reactiveOmit(props, 'class');
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <ToggleGroupRoot
    v-bind="forwarded"
    :class="cn('inline-flex items-center gap-1', props.class)"
  >
    <slot />
  </ToggleGroupRoot>
</template>
