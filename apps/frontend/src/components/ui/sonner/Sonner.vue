<script setup lang="ts">
import { Toaster } from 'vue-sonner';
import { useTheme } from '@/composables/useTheme';

const { isDark } = useTheme();
</script>

<template>
  <!-- vue-sonner reads our CSS variables (--background, --foreground, --primary,
       --border …) so toasts match the warm Material 3 palette automatically. -->
  <Toaster
    :theme="isDark ? 'dark' : 'light'"
    position="bottom-center"
    :rich-colors="true"
    :close-button="true"
    :toast-options="{
      class: 'rounded-xl border-border bg-background text-foreground shadow-float font-sans',
    }"
    :expand="true"
  />
</template>
