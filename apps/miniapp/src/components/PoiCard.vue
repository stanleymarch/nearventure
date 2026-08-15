<script setup lang="ts">
/**
 * PoiCard — the row-style POI tile used by the Mini App catalog and the
 * wizard's department shelves. Shared between CatalogView and WizardView
 * so a tweak propagates to both (and the e2e tests have a single selector
 * to target).
 *
 * Layout:
 *   ┌─────────┬────────────────────────────┬──────┐
 *   │ [photo] │ [badge]  [distance]        │ [+]  │
 *   │  72×72  │ Name (1 line, truncate)    │  or  │
 *   │         │ Description (2 lines)      │  [✓] │
 *   │         │ Century · location         │      │
 *   └─────────┴────────────────────────────┴──────┘
 *
 * The "add to cart" button on the right is a clickable overlay that does
 * NOT trigger the parent click (we use @click.stop). The card itself
 * navigates to PoiDetailView (caller provides the handler).
 *
 * Used both for browse (catalog) and selection (wizard), so we expose the
 * add/remove callback rather than coupling to the cart composable.
 */
import { computed } from 'vue';
import { Plus, Check, MapPin, type LucideIcon } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { categoryStyle, type PoiCategory } from '@/lib/poi-categories';
import { formatYearCentury, formatLocation } from '@nearventure/design-system/poi-meta';
import { poiMediaUrlById } from '@/api/poi-types';
import type { PoiRow } from '@/composables/usePois';

const props = defineProps<{
  /** The POI to render. */
  poi: PoiRow;
  /** True when this POI is already in the user's cart. */
  inCart: boolean;
  /** Distance label (e.g. "1.2 км") — optional, hides the column if empty. */
  distance?: string | null;
}>();

const emit = defineEmits<{
  /** User tapped the add/remove button (right side). */
  toggle: [poi: PoiRow];
  /** User tapped the card body (open detail). */
  open: [poi: PoiRow];
}>();

// Lucide icon resolver — re-used by both Catalog and Wizard views so the
// import is local to this component (smaller bundle than per-view copies).
import { Landmark, Medal, Mountain, Church, TreePine, Building2 } from 'lucide-vue-next';
const ICONS: Record<PoiCategory, LucideIcon> = {
  heritage: Landmark,
  monument: Medal,
  sights: Mountain,
  religion: Church,
  nature: TreePine,
  museum: Building2,
};
function catIcon(cat: string): LucideIcon {
  return (ICONS as Record<string, LucideIcon>)[cat] ?? Mountain;
}

const style = computed(() => categoryStyle(props.poi.category));
const Icon = computed<LucideIcon>(() => catIcon(props.poi.category));
const name = computed(() => props.poi.name || `Объект ${props.poi.id.slice(0, 8)}`);
const imgUrl = computed(() => (props.poi.imageUrl ? poiMediaUrlById(props.poi.id) : undefined));
const yearText = computed(() => formatYearCentury(props.poi.year, props.poi.year_end));
const locText = computed(() => formatLocation(props.poi.region, props.poi.district, props.poi.city));
const hasMeta = computed(() => Boolean(yearText.value || locText.value));

function onToggle(e: Event) {
  e.stopPropagation();
  emit('toggle', props.poi);
}
function onOpen() {
  emit('open', props.poi);
}
function onImgError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<template>
  <article
    data-testid="poi-card"
    class="relative flex items-stretch gap-2.5 rounded-card border bg-card p-2.5 transition-colors hover:bg-accent/30"
  >
    <button
      type="button"
      class="absolute inset-0 z-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      :aria-label="`Открыть: ${name}`"
      data-testid="poi-card__open"
      @click="onOpen"
    />
    <!-- Media: image or category-tinted placeholder -->
    <div class="pointer-events-none relative z-10 size-[72px] shrink-0 overflow-hidden rounded-lg bg-muted">
      <img
        v-if="imgUrl"
        :src="imgUrl"
        :alt="name"
        class="size-full object-cover"
        loading="lazy"
        @error="onImgError"
      />
      <div
        v-else
        class="size-full flex items-center justify-center"
        :style="{ background: style.container }"
      >
        <component :is="Icon" :style="{ color: style.color }" class="size-7" />
      </div>
    </div>

    <!-- Body -->
    <div class="pointer-events-none relative z-10 min-w-0 flex-1 pr-9 flex flex-col justify-center gap-1">
      <div class="flex items-center gap-1.5">
        <Badge
          variant="outline"
          class="gap-1 px-1.5 py-0 text-[11px] font-semibold border-transparent"
          :style="{ background: style.container, color: style.color }"
        >
          <component :is="Icon" class="size-3.5" />
          {{ style.label }}
        </Badge>
        <span v-if="distance" class="text-[11px] text-muted-foreground shrink-0 ml-auto">
          {{ distance }}
        </span>
      </div>
      <h3 class="text-sm font-semibold text-foreground truncate" data-testid="poi-card__name">
        {{ name }}
      </h3>
      <p
        v-if="poi.description"
        class="text-xs text-muted-foreground line-clamp-2"
      >
        {{ poi.description }}
      </p>
      <p
        v-if="hasMeta"
        class="text-[11px] text-muted-foreground flex items-center gap-1 truncate"
      >
        <template v-if="yearText">
          <span>{{ yearText }}</span>
          <span v-if="locText" aria-hidden="true">·</span>
        </template>
        <span v-if="locText" class="truncate flex items-center gap-1">
          <MapPin class="size-3 shrink-0" />
          {{ locText }}
        </span>
      </p>
    </div>

    <!-- Add/remove from cart -->
    <button
      type="button"
      class="absolute right-2 top-1/2 z-20 size-11 -translate-y-1/2 rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="inCart ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'"
      :aria-label="inCart ? 'Убрать из маршрута' : 'Добавить в маршрут'"
      :aria-pressed="inCart"
      data-testid="poi-card__add"
      @click="onToggle"
    >
      <Check v-if="inCart" class="size-5" />
      <Plus v-else class="size-5" />
    </button>
  </article>
</template>
