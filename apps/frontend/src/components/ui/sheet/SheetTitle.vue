<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { DialogTitle, type DialogTitleProps } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps<DialogTitleProps & { class?: HTMLAttributes['class'] }>();
</script>

<template>
  <DialogTitle
    :class="cn('font-display text-lg font-bold text-foreground', props.class)"
  >
    <slot />
  </DialogTitle>
</template>
