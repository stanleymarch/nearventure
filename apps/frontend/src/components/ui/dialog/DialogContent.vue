<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import {
  DialogClose,
  DialogContent,
  type DialogContentProps,
  type DialogContentEmits,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui';
import { X } from 'lucide-vue-next';
import { cn } from '@/lib/utils';

defineOptions({ inheritAttrs: false });

const props = defineProps<
  DialogContentProps & { class?: HTMLAttributes['class']; hideClose?: boolean }
>();
const emits = defineEmits<DialogContentEmits>();

const delegatedProps = reactiveOmit(props, 'class', 'hideClose');
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
    />
    <DialogContent
      v-bind="forwarded"
      :class="
        cn(
          'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-float duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 sm:rounded-2xl focus:outline-none',
          props.class,
        )
      "
    >
      <slot />
      <DialogClose
        v-if="!hideClose"
        class="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-muted-foreground opacity-70 transition hover:opacity-100 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X class="size-5" />
        <span class="sr-only">Закрыть</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
