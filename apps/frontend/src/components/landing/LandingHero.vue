<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useTheme } from '@/composables/useTheme';
import Icon from '@/components/Icon.vue';

const props = withDefaults(defineProps<{
  imagePath?: string;
  poiCount?: number | null;
}>(), {
  imagePath: '/assets/images/photo_2026-06-05_21-12-45.jpg',
  poiCount: null,
});

const router = useRouter();
const { isDark, toggleTheme } = useTheme();
const visible = ref(false);

onMounted(() => {
  setTimeout(() => { visible.value = true; }, 50);
});

function startAdventure() {
  router.push('/map');
}
function scrollTo(id: string) {
  document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' });
}
</script>

<template>
  <header
    class="relative min-h-[100dvh] flex items-center overflow-hidden"
    :class="visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'"
    :style="{
      transition: 'opacity 0.7s ease, transform 0.7s ease',
      background: isDark
        ? 'linear-gradient(135deg, rgb(27 19 16) 0%, rgb(36 27 23) 100%)'
        : 'linear-gradient(135deg, rgb(255 248 246) 0%, rgb(255 241 235) 100%)'
    }"
  >
    <!-- Ambient shapes -->
    <div class="absolute -top-1/4 -right-1/4 w-1/2 h-1/2 rounded-full bg-[var(--nv-primary)]/5 blur-3xl pointer-events-none" />
    <div class="absolute -bottom-1/4 -left-1/4 w-1/2 h-1/2 rounded-full bg-[var(--nv-secondary)]/5 blur-3xl pointer-events-none" />

    <!-- Nav -->
    <nav class="absolute top-0 left-0 right-0 z-10">
      <div class="max-w-[1200px] mx-auto px-6 md:px-16 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Icon name="explore" filled class="text-[28px]" style="color: rgb(var(--nv-primary))" />
          <span class="font-display font-extrabold text-xl tracking-tight" style="color: rgb(var(--nv-on-surface))">Nearventure</span>
        </div>
        <div class="flex items-center gap-4">
          <button
            class="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
            style="background: rgb(var(--nv-surface-lowest) / 0.7); border: 1px solid rgb(var(--nv-outline-variant) / 0.5); color: rgb(var(--nv-on-surface-variant))"
            :aria-label="isDark ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'"
            @click="toggleTheme"
          >
            <Icon :name="isDark ? 'light_mode' : 'dark_mode'" :filled="!isDark" />
          </button>
          <RouterLink
            to="/catalog"
            class="hidden sm:inline text-sm font-semibold transition-colors hover:text-[rgb(var(--nv-primary))]"
            style="color: rgb(var(--nv-on-surface-variant))"
          >Каталог</RouterLink>
          <a
            href="#about"
            class="hidden sm:inline text-sm font-semibold transition-colors"
            style="color: rgb(var(--nv-on-surface-variant))"
            @click.prevent="scrollTo('#about')"
          >О проекте</a>
          <button
            class="btn-primary px-5 py-2.5"
            @click="startAdventure"
          >Создать маршрут</button>
        </div>
      </div>
    </nav>

    <!-- Hero content — asymmetric split (text left, visual right) -->
    <div class="relative max-w-[1200px] mx-auto px-6 md:px-16 grid grid-cols-1 md:grid-cols-2 gap-12 items-center w-full py-28 md:py-20">
      <!-- Left: value prop (max 2-line headline, ≤20-word subtext, one CTA) -->
      <div class="space-y-6 max-w-lg">
        <div
          class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest"
          style="background: rgb(var(--nv-primary) / 0.12); color: rgb(var(--nv-primary))"
        >
          <Icon name="near_me" filled class="text-sm" />
          Приволжский округ · ПФО
        </div>

        <h1
          class="font-display font-extrabold leading-[1.05] tracking-tight"
          style="color: rgb(var(--nv-on-surface))"
        >
          <span class="block text-4xl md:text-5xl lg:text-6xl">
            Свободные три часа
          </span>
          <span class="block text-4xl md:text-5xl lg:text-6xl mt-2" style="color: rgb(var(--nv-primary))">
            могут стать маршрутом
          </span>
        </h1>

        <p class="text-lg md:text-xl leading-relaxed" style="color: rgb(var(--nv-on-surface-variant))">
          Выберите время и то, что хочется увидеть. Nearventure соберёт поездку и подготовит GPX для навигатора.
        </p>

        <div class="flex flex-wrap gap-4 pt-2">
          <button class="btn-primary px-8 py-3 text-base" @click="startAdventure">
            <Icon name="directions_bike" filled />
            Открыть карту
          </button>
        </div>

        <p class="text-sm pt-1" style="color: rgb(var(--nv-on-surface-variant))">
          <span v-if="poiCount != null">{{ poiCount.toLocaleString('ru-RU') }} объектов в 14 субъектах ПФО. Бесплатно, без регистрации.</span>
          <span v-else>14 субъектов ПФО. Бесплатно, без регистрации.</span>
        </p>
      </div>

      <!-- Right: real photo with summary overlay (not a fake div screenshot) -->
      <div class="relative">
        <div class="relative rounded-card overflow-hidden shadow-floating border-[6px]" :class="isDark ? 'border-zinc-800/50' : 'border-white/80'">
          <img
            :src="imagePath"
            alt="Вятский край"
            class="w-full h-auto object-cover aspect-[4/3]"
            loading="eager"
            width="800"
            height="600"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

          <!-- Real route screenshot replaces this photo once a verified
               production-like map state is captured. Do not simulate route data
               with invented metrics in the meantime. -->
        </div>
      </div>
    </div>
  </header>
</template>
