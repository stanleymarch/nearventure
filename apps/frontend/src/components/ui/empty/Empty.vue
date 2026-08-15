<script setup lang="ts">
import { cn } from '@/lib/utils'
import type { Component } from 'vue'

const props = withDefaults(defineProps<{
  icon?: Component | string
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  class?: string
}>(), {})
</script>

<template>
  <div :class="cn('flex flex-col items-center justify-center gap-3 py-12 text-center', props.class)">
    <div v-if="icon" class="flex items-center justify-center rounded-full bg-muted p-4">
      <component :is="icon" class="h-6 w-6 text-muted-foreground" v-bind="typeof icon === 'string' ? {} : {}" />
    </div>
    <div class="space-y-1">
      <p class="text-sm font-semibold text-foreground">{{ title }}</p>
      <p v-if="description" class="text-xs text-muted-foreground max-w-[240px] mx-auto">{{ description }}</p>
    </div>
    <button
      v-if="action"
      class="mt-1 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow transition hover:bg-primary/90"
      @click="action.onClick"
    >
      {{ action.label }}
    </button>
  </div>
</template>
