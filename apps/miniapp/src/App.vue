<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTelegram } from '@/composables/useTelegram';
import { navigateFromStartParam } from '@/router';
import { getPoiCount } from '@/api';
import { ref } from 'vue';
import { MotionConfig, LazyMotion, domAnimation } from 'motion-v';

const { init, colorScheme } = useTelegram();
const route = useRoute();

const poiCount = ref<number | null>(null);

onMounted(async () => {
  init();

  // Deep link via start_param (t.me/bot/app?startapp=...).
  const tg = useTelegram();
  const startParam = tg.startParam();
  if (!navigateFromStartParam(startParam)) {
    // No deep link → count POIs for the home screen.
    try {
      const c = await getPoiCount();
      poiCount.value = c.total;
    } catch {
      poiCount.value = null;
    }
  }
});

// Apply theme class reactively (used by a few style branches).
watch(colorScheme, (cs) => {
  document.documentElement.classList.toggle('tg-dark', cs === 'dark');
});

// Surface the current route name for any screen-level concerns.
void route;
</script>

<template>
  <LazyMotion :features="domAnimation">
    <MotionConfig reduced-motion="user">
      <div class="min-h-screen" :class="$route.meta.immersive ? '' : 'app-shell'">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>
    </MotionConfig>
  </LazyMotion>
</template>

<style>
/* Shell respects safe areas; content clears the native MainButton (~80px). */
.app-shell {
  padding: calc(12px + var(--safe-top)) 12px calc(88px + var(--safe-bottom));
  max-width: 640px;
  margin: 0 auto;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
