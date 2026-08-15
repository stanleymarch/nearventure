<script setup lang="ts">
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg'
  class?: string
}>(), {
  size: 'md',
})

const sizes = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' }
</script>

<template>
  <Loader2
    :class="cn('animate-spin text-muted-foreground', sizes[size], props.class)"
    aria-label="Загрузка…"
  />
</template>
