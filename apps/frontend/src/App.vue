<script setup lang="ts">
import { useTheme } from '@/composables/useTheme';
import { MotionConfig, LazyMotion, domAnimation } from 'motion-v';

// Theme init applies the `dark` class to <html> from the saved preference.
// The shell itself stays transparent; each route/view owns its own chrome
// (the immersive home has its own top nav, AdminLayout has its own header).
useTheme();
</script>

<template>
  <!-- App-level MotionConfig: respect user reduced-motion preference system-wide. -->
  <LazyMotion :features="domAnimation">
    <MotionConfig reduced-motion="user">
      <router-view v-slot="{ Component, route }">
        <component :is="Component" :key="route.path" />
      </router-view>
    </MotionConfig>
  </LazyMotion>
</template>
