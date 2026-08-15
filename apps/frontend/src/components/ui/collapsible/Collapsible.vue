<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-vue-next'
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  defaultOpen?: boolean
  class?: string
}>(), {
  defaultOpen: false,
})

const open = ref(props.defaultOpen)
</script>

<template>
  <CollapsibleRoot v-model:open="open" :class="cn('rounded-xl border border-border', props.class)">
    <CollapsibleTrigger class="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-muted/50">
      {{ title }}
      <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform duration-200" :class="open ? 'rotate-180' : ''" />
    </CollapsibleTrigger>
    <CollapsibleContent class="overflow-hidden transition-all data-[state=closed]:animate-collapse-up data-[state=open]:animate-collapse-down">
      <div class="px-4 pb-3 pt-1 text-sm text-muted-foreground">
        <slot />
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
