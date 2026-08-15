<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'
import type { TooltipContentProps } from 'reka-ui'

const props = withDefaults(defineProps<TooltipContentProps & { text: string; side?: 'top' | 'bottom' | 'left' | 'right' }>(), {
  side: 'top',
})
const forwarded = useForwardProps(props)
</script>

<template>
  <TooltipProvider>
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipContent v-bind="forwarded" :class="cn('z-50 overflow-hidden rounded-md bg-inverse-surface px-3 py-1.5 text-xs text-inverse-on-surface shadow-md animate-in fade-in-0 zoom-in-95')">
        {{ text }}
        <TooltipArrow class="fill-inverse-surface" />
      </TooltipContent>
    </TooltipRoot>
  </TooltipProvider>
</template>
