<script setup lang="ts">
/**
 * DragRail — горизонтальная карусель с pointer-drag.
 *
 * Свайп пальцем + перетаскивание мышью поверх нативного overflow-x-auto
 * (тачпад/колесо/клавиатура остаются). Клик после перетаскивания подавляется,
 * чтобы карточка не открывалась случайно. Используется в саммари маршрута
 * для групп POI и для подсказок «рядом с маршрутом».
 */
import { useDragScroll } from '@/composables/useDragScroll';

const rail = useDragScroll<HTMLDivElement>();
</script>

<template>
  <div
    ref="rail"
    class="drag-rail flex gap-2 overflow-x-auto px-4 pb-1 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    style="scroll-padding-left: 1rem"
  >
    <slot />
  </div>
</template>

<style scoped>
.drag-rail {
  cursor: grab;
  touch-action: pan-x;
  /* grab handled via class toggle in useDragScroll; keep default for touch */
}
.drag-rail:active {
  cursor: grabbing;
}
</style>
