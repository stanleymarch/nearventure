<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  modelValue?: number
  max?: number
  showLabel?: boolean
  class?: string
}>(), {
  modelValue: 0,
  max: 100,
  showLabel: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const percent = () => Math.min(Math.max((props.modelValue / props.max) * 100, 0), 100)
</script>

<template>
  <div :class="cn('flex items-center gap-2', props.class)">
    <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="modelValue" :aria-valuemin="0" :aria-valuemax="max" :aria-valuetext="`${percent().toFixed(0)}%`">
      <div class="h-full rounded-full bg-primary transition-all duration-300" :style="{ width: percent() + '%' }" />
    </div>
    <span v-if="showLabel" class="text-xs font-medium tabular-nums text-muted-foreground">{{ percent().toFixed(0) }}%</span>
  </div>
</template>
