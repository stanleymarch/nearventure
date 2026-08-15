<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, reactive } from 'vue';
import { useRouter } from 'vue-router';
import {
  MapPinned, Map, SlidersHorizontal, Search, Layers, Globe, FilterX,
  Loader2, X, Shield, MapPin, ExternalLink, Users, BookOpen, Library,
  RefreshCw, TriangleAlert, CheckCircle, ArrowUpDown, Landmark, Trophy,
  Mountain, Church, Trees, FileText, ImageIcon, CalendarClock,
} from 'lucide-vue-next';
import {
  getPois,
  getRegions,
  poiName,
  poiMediaUrlById,
  poiSourceLabel,
  isVkUrl,
  sourceEntries,
  HERITAGE_LABELS,
  type Poi,
  type PoiCategory,
  type PoiQuery,
} from '@/api/pois';
import { CATEGORY_ORDER, CATEGORY_STYLES } from '@/lib/poi-categories';
import { formatYearCentury, formatLocation } from '@/lib/poi-meta';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

// ═══════════════════════════════════════════════════════════════
// Web Catalog View — Full web experience with sidebar filters,
// responsive POI card grid, infinite scroll, and detail modal.
// Accessible via /catalog in browser (not Mini App).
// ═══════════════════════════════════════════════════════════════

const router = useRouter();

/** POI ids whose media failed to load (broken okn-mk.mkrf.ru HTML urls etc).
 *  Once broken we show the category placeholder instead of an empty box. */
const brokenImageIds = reactive(new Set<string>());

// ─── Constants ──────────────────────────────────────────────
const PAGE_SIZE = 24;

type SourceFilter = 'all' | 'osm' | 'egrkn' | 'wikivoyage';
type SortOption = 'popularity' | 'name';

// Real origin taxonomy from poi_product.source (verified against the live DB):
// osm / egrkn / wikivoyage. "wikidata" was never a POI source — it is an
// enrichment (wikidata_qid column) shown separately on the detail card.
const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'Все источники' },
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'egrkn', label: 'ЕГРКН' },
  { value: 'wikivoyage', label: 'Wikivoyage' },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'popularity', label: 'По популярности' },
  { value: 'name', label: 'По названию' },
];

/** Century filter options: numeric value + roman label for display. */
const CENTURY_OPTIONS = [
  { n: 13, label: 'XIII в.' },
  { n: 14, label: 'XIV в.' },
  { n: 15, label: 'XV в.' },
  { n: 16, label: 'XVI в.' },
  { n: 17, label: 'XVII в.' },
  { n: 18, label: 'XVIII в.' },
  { n: 19, label: 'XIX в.' },
  { n: 20, label: 'XX в.' },
  { n: 21, label: 'XXI в.' },
];

// ─── State ──────────────────────────────────────────────────
const allPois = ref<Poi[]>([]);
const totalCount = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);

// Filters
const searchQuery = ref('');
const selectedCategories = ref<Set<PoiCategory>>(new Set());
const sourceFilter = ref<SourceFilter>('all');
const sortOption = ref<SortOption>('popularity');
const hasDescription = ref(false);
const hasPhoto = ref(false);
const centuryMin = ref(13);
const centuryMax = ref(21);
const centuryEnabled = ref(false);
const selectedRegion = ref<string>('');
const regions = ref<string[]>([]);

// Mobile filter panel
const filtersOpen = ref(false);
/** Trigger button of the mobile filter drawer — receives focus back on close. */
const filterToggleRef = ref<InstanceType<typeof Button> | null>(null);
const filtersAsideId = 'catalog-filters';

/** Close the mobile filter drawer and restore focus to its trigger. */
function closeFilters() {
  if (!filtersOpen.value) return;
  filtersOpen.value = false;
  nextTick(() => {
    const el = filterToggleRef.value?.$el as HTMLElement | undefined;
    if (el && typeof el.focus === 'function') el.focus();
  });
}

// Native dialog semantics: close the drawer on Escape while it is open.
let escHandler: ((e: KeyboardEvent) => void) | null = null;
watch(filtersOpen, (open) => {
  if (escHandler) {
    window.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  if (open) {
    escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFilters();
      }
    };
    window.addEventListener('keydown', escHandler);
  }
});

// Detail modal
const selectedPoi = ref<Poi | null>(null);

// Infinite scroll
const sentinelRef = ref<HTMLElement | null>(null);
let ioObserver: IntersectionObserver | null = null;
const hasMore = computed(() => allPois.value.length < totalCount.value);

// Debounce timer
let searchTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Helpers ────────────────────────────────────────────────
function categoryIcon(cat: PoiCategory) {
  const map: Record<PoiCategory, any> = {
    heritage: Landmark,
    monument: Trophy,
    sights: Mountain,
    religion: Church,
    nature: Trees,
    museum: Library,
  };
  return map[cat] ?? MapPin;
}

// ─── Computed ───────────────────────────────────────────────
/** Server-driven list. Source filter and name sort are now query params
 *  (previously applied client-side over a paginated page → wrong count +
 *  sparse grid). */
const displayedPois = computed(() => allPois.value);

const activeFilterCount = computed(() => {
  let n = selectedCategories.value.size;
  if (sourceFilter.value !== 'all') n++;
  if (searchQuery.value.trim()) n++;
  if (hasDescription.value) n++;
  if (hasPhoto.value) n++;
  n += centuryEnabled.value ? 1 : 0;
  return n;
});

const isEmpty = computed(
  () => !loading.value && !loadingMore.value && displayedPois.value.length === 0,
);

// ─── Helpers ────────────────────────────────────────────────
// Source filtering + name sort now run server-side (see buildQuery).

function buildQuery(offset: number): PoiQuery {
  const q: PoiQuery = {
    limit: PAGE_SIZE,
    offset,
  };
  const cats = Array.from(selectedCategories.value);
  if (cats.length > 0) {
    q.category = cats.join(',');
  }
  if (searchQuery.value.trim()) {
    q.search = searchQuery.value.trim();
  }
  if (hasDescription.value) {
    q.hasDescription = true;
  }
  if (hasPhoto.value) {
    q.hasPhoto = true;
  }
  if (selectedRegion.value) {
    q.region = selectedRegion.value;
  }
  if (sourceFilter.value !== 'all') {
    q.source = sourceFilter.value;
  }
  if (centuryEnabled.value) {
    const range = [];
    for (let n = centuryMin.value; n <= centuryMax.value; n++) range.push(n);
    q.century = range.join(',');
  }
  q.sort = sortOption.value;
  return q;
}

function categoryLabel(cat: PoiCategory): string {
  return CATEGORY_STYLES[cat]?.label ?? cat;
}

function categoryLongLabel(cat: PoiCategory): string {
  return CATEGORY_STYLES[cat]?.labelLong ?? cat;
}

function onCenturyMinInput(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value, 10);
  centuryMin.value = Math.min(v, centuryMax.value - 1);
  centuryEnabled.value = true;
}

function onCenturyMaxInput(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value, 10);
  centuryMax.value = Math.max(v, centuryMin.value + 1);
  centuryEnabled.value = true;
}

function sourceLabel(poi: Poi): string {
  return poiSourceLabel(poi);
}

function openDetail(poi: Poi) {
  selectedPoi.value = poi;
}

function closeDetail() {
  selectedPoi.value = null;
}

function openOnMap(poi: Poi) {
  closeDetail();
  router.push({ name: 'home', query: { poi: poi.id, lat: poi.lat, lng: poi.lon } });
}

// ─── Filter actions ─────────────────────────────────────────
function toggleCategory(cat: PoiCategory) {
  const next = new Set(selectedCategories.value);
  if (next.has(cat)) next.delete(cat);
  else next.add(cat);
  selectedCategories.value = next;
}

function resetFilters() {
  searchQuery.value = '';
  selectedCategories.value = new Set();
  sourceFilter.value = 'all';
  sortOption.value = 'popularity';
  hasDescription.value = false;
  hasPhoto.value = false;
  centuryMin.value = 13;
  centuryMax.value = 21;
  centuryEnabled.value = false;
  selectedRegion.value = '';
}

// ─── Data fetching ──────────────────────────────────────────
async function fetchPois() {
  loading.value = true;
  error.value = null;
  try {
    const res = await getPois(buildQuery(0));
    allPois.value = res.items;
    totalCount.value = res.total;
  } catch (e: any) {
    error.value = e?.message || 'Не удалось загрузить места';
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const res = await getPois(buildQuery(allPois.value.length));
    allPois.value = [...allPois.value, ...res.items];
  } catch {
    // Silent fail on pagination — don't crash the UI
  } finally {
    loadingMore.value = false;
  }
}

// ─── Watchers: refetch on filter changes ────────────────────
watch(
  [selectedCategories, sourceFilter, sortOption, hasDescription, hasPhoto, centuryMin, centuryMax, centuryEnabled, selectedRegion],
  () => fetchPois(),
  { deep: true },
);

// Debounced search
watch(searchQuery, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => fetchPois(), 300);
});

// ─── Infinite scroll ────────────────────────────────────────
function setupObserver() {
  if (ioObserver) ioObserver.disconnect();
  ioObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value) {
        loadMore();
      }
    },
    { rootMargin: '300px' },
  );
  nextTick(() => {
    if (sentinelRef.value) ioObserver?.observe(sentinelRef.value);
  });
}

watch(hasMore, () => {
  if (hasMore.value) setupObserver();
});

// ─── Lifecycle ──────────────────────────────────────────────
onMounted(() => {
  fetchPois().then(() => setupObserver());
  getRegions().then((r) => { regions.value = ['', ...r]; });
});

onUnmounted(() => {
  if (ioObserver) ioObserver.disconnect();
  if (searchTimer) clearTimeout(searchTimer);
  if (escHandler) window.removeEventListener('keydown', escHandler);
});
</script>

<template>
  <div class="flex h-screen h-dvh flex-col overflow-hidden bg-background">
    <!-- ═══ Topbar ═══ -->
    <header class="flex flex-shrink-0 flex-col sm:flex-row items-stretch sm:items-center justify-between border-b border-border bg-background/95 backdrop-blur-md">
      <div class="flex items-center gap-2 px-4 sm:px-6 pt-3 pb-1 sm:py-3 min-w-0">
        <router-link to="/" class="flex items-center gap-1.5 font-semibold text-foreground no-underline shrink-0">
          <MapPinned class="size-5 text-primary" />
          <span>Nearventure</span>
        </router-link>
        <Separator orientation="vertical" class="h-5 shrink-0" />
        <h1 class="text-lg font-medium text-muted-foreground whitespace-nowrap">Каталог мест</h1>
      </div>
      <div class="flex items-center justify-between sm:justify-end gap-2 px-4 sm:px-6 pb-3 sm:py-3">
        <span class="truncate text-sm text-muted-foreground min-w-0">
          Найдено: {{ totalCount.toLocaleString('ru') }} мест
        </span>
        <Button variant="outline" size="sm" class="shrink-0" @click="router.push({ name: 'home' })">
          <Map class="size-4" />
          <span class="hidden sm:inline">На карту</span>
          <span class="sm:hidden">Карта</span>
        </Button>
      </div>
    </header>

    <!-- ═══ Mobile filter toggle ═══ -->
    <Button
      ref="filterToggleRef"
      variant="outline"
      class="mx-4 mt-2 flex sm:hidden"
      :aria-expanded="filtersOpen"
      :aria-controls="filtersAsideId"
      @click="filtersOpen = !filtersOpen"
    >
      <SlidersHorizontal class="size-4" />
      Фильтры
      <Badge v-if="activeFilterCount > 0" variant="default" class="ml-1">
        {{ activeFilterCount }}
      </Badge>
    </Button>

    <!-- ═══ Body ═══ -->
    <div class="relative flex flex-1 overflow-hidden">
      <!-- ─── Sidebar ─── -->
      <aside
        :id="filtersAsideId"
        class="w-[280px] flex-shrink-0 overflow-y-auto border-r border-border bg-card p-5"
        role="dialog"
        aria-label="Фильтры каталога"
        :class="filtersOpen
          ? 'fixed inset-y-0 left-0 z-[100] flex max-w-[85vw] flex-col gap-5 shadow-xl'
          : 'hidden flex-col gap-5 sm:flex'"
      >
        <!-- Search -->
        <div class="flex flex-col gap-2">
          <Label for="catalog-search" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Search class="size-4" />
            Поиск
          </Label>
          <Input id="catalog-search" v-model="searchQuery" name="catalog-search" placeholder="Поиск по названию…" />
        </div>

        <!-- Categories -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Layers class="size-4" />
            Категории
          </div>
          <div class="flex flex-col gap-1.5">
            <Button
              v-for="cat in CATEGORY_ORDER"
              :key="cat"
              variant="outline"
              size="sm"
              class="justify-start"
              data-testid="category-btn"
              :aria-pressed="selectedCategories.has(cat)"
              :class="selectedCategories.has(cat)
                ? 'border-2 text-foreground'
                : 'text-muted-foreground'"
              :style="selectedCategories.has(cat)
                ? { borderColor: CATEGORY_STYLES[cat].color, backgroundColor: CATEGORY_STYLES[cat].container }
                : {}"
              @click="toggleCategory(cat)"
            >
              <component :is="categoryIcon(cat)" class="size-4 shrink-0" />
              {{ CATEGORY_STYLES[cat].label }}
            </Button>
          </div>
        </div>

        <!-- Centuries -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarClock class="size-4" />
            Век постройки
          </div>
          <div class="space-y-2 rounded-lg border border-border/60 px-3 py-2.5">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium text-foreground">{{ CENTURY_OPTIONS[centuryMin - 13].label }}</span>
              <span class="text-[0.6rem] text-muted-foreground">—</span>
              <span class="text-xs font-medium text-foreground">{{ CENTURY_OPTIONS[centuryMax - 13].label }}</span>
              <button
                type="button"
                class="ml-auto shrink-0 text-[0.6rem] font-semibold uppercase text-muted-foreground underline-offset-2 hover:underline"
                :class="centuryEnabled ? 'text-primary' : 'text-muted-foreground/40'"
                @click="centuryEnabled = !centuryEnabled"
              >
                {{ centuryEnabled ? 'Сбросить' : 'Фильтр' }}
              </button>
            </div>
            <div v-if="centuryEnabled" class="relative h-6">
              <div class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-secondary" />
              <div
                class="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/40"
                :style="{
                  left: ((centuryMin - 13) / 8) * 100 + '%',
                  width: ((centuryMax - centuryMin) / 8) * 100 + '%',
                }"
              />
              <label for="catalog-century-min" class="sr-only">Минимальный век</label>
              <input
                id="catalog-century-min"
                name="catalog-century-min"
                type="range"
                min="13" max="21" step="1"
                :value="centuryMin"
                @input="onCenturyMinInput"
                class="pointer-events-none absolute inset-0 z-[3] w-full cursor-pointer appearance-none bg-transparent
                  [&::-webkit-slider-thumb]:pointer-events-auto
                  [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary
                  [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow
                  [&::-moz-range-thumb]:pointer-events-auto
                  [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4
                  [&::-moz-range-thumb]:appearance-none
                  [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary
                  [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow"
              />
              <label for="catalog-century-max" class="sr-only">Максимальный век</label>
              <input
                id="catalog-century-max"
                name="catalog-century-max"
                type="range"
                min="13" max="21" step="1"
                :value="centuryMax"
                @input="onCenturyMaxInput"
                class="pointer-events-none absolute inset-0 z-[2] w-full cursor-pointer appearance-none bg-transparent
                  [&::-webkit-slider-thumb]:pointer-events-auto
                  [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary
                  [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow
                  [&::-moz-range-thumb]:pointer-events-auto
                  [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4
                  [&::-moz-range-thumb]:appearance-none
                  [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary
                  [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow"
              />
            </div>
          </div>
        </div>

        <!-- Source → toggle chips -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Globe class="size-4" />
            Источник данных
          </div>
          <div class="flex flex-wrap gap-1.5">
            <Button
              v-for="opt in SOURCE_OPTIONS"
              :key="opt.value"
              variant="outline"
              size="sm"
              class="h-8 px-2.5 text-xs"
              :aria-pressed="sourceFilter === opt.value"
              :class="sourceFilter === opt.value
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'text-muted-foreground'"
              @click="sourceFilter = opt.value"
            >
              {{ opt.label }}
            </Button>
          </div>
        </div>

        <!-- Region -->
        <div class="flex flex-col gap-2">
          <Label for="catalog-region" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MapPin class="size-4" />
            Регион
          </Label>
          <select id="catalog-region" v-model="selectedRegion" name="catalog-region" class="h-10 w-full rounded-control border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30">
            <option value="">Все регионы</option>
            <option v-for="r in regions.slice(1)" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>

        <!-- Sort -->
        <div class="flex flex-col gap-2">
          <Label for="catalog-sort" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ArrowUpDown class="size-4" />
            Сортировка
          </Label>
          <select id="catalog-sort" v-model="sortOption" name="catalog-sort" class="h-10 w-full rounded-control border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30">
            <option v-for="opt in SORT_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>

        <!-- Content filters -->
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <SlidersHorizontal class="size-4" />
            Содержимое
          </div>
          <Label for="catalog-has-description" class="flex items-center justify-between gap-3 text-sm text-foreground">
            <span class="flex items-center gap-2">
              <FileText class="size-4 text-muted-foreground" />
              С описанием
            </span>
            <Switch id="catalog-has-description" v-model="hasDescription" name="catalog-has-description" />
          </Label>
          <Label for="catalog-has-photo" class="flex items-center justify-between gap-3 text-sm text-foreground">
            <span class="flex items-center gap-2">
              <ImageIcon class="size-4 text-muted-foreground" />
              С фото
            </span>
            <Switch id="catalog-has-photo" v-model="hasPhoto" name="catalog-has-photo" />
          </Label>
        </div>

        <!-- Reset -->
        <Button
          v-if="activeFilterCount > 0"
          variant="outline"
          size="sm"
          class="w-full"
          @click="resetFilters"
        >
          <FilterX class="size-4" />
          Сбросить фильтры
        </Button>
      </aside>

      <!-- Backdrop (mobile) -->
      <div
        v-if="filtersOpen"
        class="fixed inset-0 z-[90] bg-black/40 sm:hidden"
        @click="closeFilters"
      />

      <!-- ─── Main ─── -->
      <main class="flex-1 overflow-y-auto p-6">
        <!-- Error state -->
        <div
          v-if="error"
          class="flex flex-col items-center justify-center gap-4 py-20 text-center"
        >
          <TriangleAlert class="size-12 text-destructive" />
          <p class="text-lg font-medium text-foreground">{{ error }}</p>
          <Button @click="fetchPois">
            <RefreshCw class="size-4" />
            Повторить
          </Button>
        </div>

        <!-- Loading skeletons -->
        <div
          v-else-if="loading"
          class="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
        >
          <div
            v-for="i in 12"
            :key="i"
            class="rounded-xl border bg-card"
          >
            <Skeleton class="aspect-[16/10] rounded-t-xl rounded-b-none" />
            <div class="space-y-2 p-4">
              <Skeleton class="h-4 w-3/4" />
              <Skeleton class="h-3 w-full" />
              <Skeleton class="h-3 w-2/3" />
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-else-if="isEmpty"
          class="flex flex-col items-center justify-center gap-4 py-20 text-center"
        >
          <Search class="size-12 text-muted-foreground" />
          <p class="text-lg font-medium text-foreground">Ничего не найдено</p>
          <p class="text-sm text-muted-foreground">
            Попробуйте изменить фильтры или поисковый запрос
          </p>
          <Button variant="outline" size="sm" @click="resetFilters">
            <FilterX class="size-4" />
            Сбросить фильтры
          </Button>
        </div>

        <!-- POI grid -->
        <template v-else>
          <div class="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            <button
              v-for="poi in displayedPois"
              :key="poi.id"
              type="button"
              data-testid="poi-card"
              class="group cursor-pointer overflow-hidden rounded-xl border bg-card text-left text-card-foreground shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :style="{
                '--cat-border-color': CATEGORY_STYLES[poi.category]?.color,
              }"
              :aria-label="`Открыть: ${poiName(poi)}`"
              @click="openDetail(poi)"
            >
              <!-- Media -->
              <div class="relative aspect-[16/10] overflow-hidden bg-muted">
                <img
                  v-if="poi.imageUrl && !brokenImageIds.has(poi.id)"
                  :src="poiMediaUrlById(poi.id)"
                  :alt="poiName(poi)"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                  @error="brokenImageIds.add(poi.id)"
                />
                <div
                  v-else
                  class="flex size-full items-center justify-center"
                  :style="{ background: `linear-gradient(135deg, ${CATEGORY_STYLES[poi.category]?.container ?? 'rgb(var(--muted))'}, rgb(var(--muted) / 0.3))` }"
                >
                  <component
                    :is="categoryIcon(poi.category)"
                    class="size-14"
                    :style="{ color: CATEGORY_STYLES[poi.category]?.color ?? 'rgb(var(--muted-foreground))' }"
                  />
                </div>
                <!-- Category badge -->
                <div
                  class="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm"
                >
                  <component
                    :is="categoryIcon(poi.category)"
                    class="size-3.5"
                  />
                  {{ categoryLabel(poi.category) }}
                </div>
              </div>

              <!-- Body -->
              <div class="flex flex-col gap-1.5 p-4">
                <h3
                  class="line-clamp-2 text-sm font-semibold text-foreground"
                >
                  {{ poiName(poi) }}
                </h3>
                <p
                  v-if="poi.descRu"
                  class="line-clamp-2 text-xs text-muted-foreground"
                >
                  {{ poi.descRu.length > 120
                    ? poi.descRu.slice(0, 120) + '…'
                    : poi.descRu
                  }}
                </p>
                <!-- Construction century + region (collector pipeline) -->
                <div
                  v-if="formatYearCentury(poi.year, poi.year_end) || formatLocation(poi.region, poi.district, poi.city)"
                  class="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[0.7rem] text-muted-foreground"
                >
                  <span v-if="formatYearCentury(poi.year, poi.year_end)" class="flex items-center gap-1">
                    <CalendarClock class="size-3 shrink-0" />
                    {{ formatYearCentury(poi.year, poi.year_end) }}
                  </span>
                  <span v-if="formatLocation(poi.region, poi.district, poi.city)" class="flex min-w-0 items-center gap-1">
                    <MapPin class="size-3 shrink-0" />
                    <span class="truncate">{{ formatLocation(poi.region, poi.district, poi.city) }}</span>
                  </span>
                </div>
                <div
                  class="mt-auto flex items-center justify-between gap-2 pt-2 text-xs"
                >
                  <span class="text-muted-foreground">{{ sourceLabel(poi) }}</span>
                  <span
                    v-if="poi.is_protected"
                    class="flex items-center gap-0.5"
                    style="color: rgb(var(--nv-secondary))"
                  >
                    <Shield class="size-3.5" />
                    Охраняется
                  </span>
                </div>
              </div>
            </button>
          </div>

          <!-- Infinite scroll sentinel + loading indicator -->
          <div ref="sentinelRef" class="py-8">
            <div
              v-if="loadingMore"
              class="flex items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 class="size-5 animate-spin text-primary" />
              <span>Загрузка…</span>
            </div>
            <div
              v-else-if="!hasMore && displayedPois.length > 0"
              class="flex items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <CheckCircle
                class="size-5"
                style="color: rgb(var(--nv-tertiary))"
              />
              Это все места по вашему запросу
            </div>
          </div>
        </template>
      </main>
    </div>

    <!-- ═══ POI Detail Dialog ═══ -->
    <Dialog
      v-if="selectedPoi"
      :open="!!selectedPoi"
      @update:open="(v: boolean) => !v && closeDetail()"
    >
      <DialogContent
        class="max-w-lg overflow-hidden p-0 sm:rounded-2xl"
        hide-close
      >
        <!-- Image / placeholder -->
        <div
          v-if="selectedPoi?.imageUrl"
          class="relative h-[240px] overflow-hidden"
        >
          <img
            :src="poiMediaUrlById(selectedPoi.id)"
            :alt="poiName(selectedPoi)"
            referrerpolicy="no-referrer"
            class="size-full object-cover"
          />
          <Button
            variant="ghost"
            size="icon"
            class="absolute right-3 top-3 z-10 rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
            aria-label="Закрыть карточку места"
            @click="closeDetail"
          >
            <X class="size-5" />
          </Button>
        </div>
        <div
          v-else
          class="relative flex h-[240px] items-center justify-center bg-muted"
        >
          <component
            :is="selectedPoi ? categoryIcon(selectedPoi.category) : MapPin"
            class="size-16 text-muted-foreground/50"
          />
          <Button
            variant="ghost"
            size="icon"
            class="absolute right-3 top-3 z-10 rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
            aria-label="Закрыть карточку места"
            @click="closeDetail"
          >
            <X class="size-5" />
          </Button>
        </div>

        <!-- Content -->
        <div class="max-h-[calc(92dvh-240px)] overflow-y-auto p-6">
          <!-- Header -->
          <div class="mb-4 flex items-start gap-3">
            <component
              :is="selectedPoi ? categoryIcon(selectedPoi.category) : MapPin"
              class="size-7 shrink-0"
              :style="{
                color: selectedPoi
                  ? CATEGORY_STYLES[selectedPoi.category]?.color
                  : undefined,
              }"
            />
            <div>
              <h2 class="text-xl font-bold text-foreground">
                {{ selectedPoi ? poiName(selectedPoi) : '' }}
              </h2>
              <p class="text-sm text-muted-foreground">
                {{ selectedPoi ? categoryLongLabel(selectedPoi.category) : '' }}
              </p>
            </div>
          </div>

          <!-- Description -->
          <p
            v-if="selectedPoi?.descRu"
            class="mb-4 text-sm leading-relaxed text-muted-foreground"
          >
            {{ selectedPoi.descRu }}
          </p>

          <!-- Heritage badge -->
          <div
            v-if="selectedPoi?.heritageSignificance"
            class="mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
            :style="{
              backgroundColor: 'rgb(var(--nv-secondary) / 0.1)',
              color: 'rgb(var(--nv-secondary))',
            }"
          >
            <Shield class="size-4" />
            Объект
            {{ HERITAGE_LABELS[selectedPoi.heritageSignificance] ?? selectedPoi.heritageSignificance }}
          </div>

          <!-- Actions -->
          <div class="mb-4 flex flex-wrap gap-2">
            <Button size="sm" @click="selectedPoi && openOnMap(selectedPoi)">
              <Map class="size-4" />
              Открыть на карте
            </Button>
            <Button
              v-if="selectedPoi?.officialUrl"
              variant="outline"
              size="sm"
              as-child
            >
              <a
                :href="selectedPoi.officialUrl"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-2"
              >
                <ExternalLink class="size-4" />
                Сайт
              </a>
            </Button>
            <Button
              v-if="selectedPoi && isVkUrl(selectedPoi.socialUrl)"
              variant="outline"
              size="sm"
              as-child
            >
              <a
                :href="selectedPoi.socialUrl!"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-2"
              >
                <Users class="size-4" />
                ВКонтакте
              </a>
            </Button>
            <Button
              v-if="selectedPoi?.articleUrl"
              variant="outline"
              size="sm"
              as-child
            >
              <a
                :href="selectedPoi.articleUrl"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-2"
              >
                <BookOpen class="size-4" />
                Подробнее
              </a>
            </Button>
            <Button
              v-if="selectedPoi?.wikidataQid"
              variant="outline"
              size="sm"
              as-child
            >
              <a
                :href="`https://www.wikidata.org/wiki/${selectedPoi.wikidataQid}`"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-2"
              >
                <Library class="size-4" />
                Wikidata
              </a>
            </Button>
          </div>

          <!-- Source links -->
          <div
            v-if="selectedPoi && sourceEntries(selectedPoi).length > 0"
            class="mb-4 flex flex-wrap items-center gap-2 border-t border-border pt-4"
          >
            <span class="text-xs font-semibold text-muted-foreground">
              Источники:
            </span>
            <a
              v-for="src in sourceEntries(selectedPoi)"
              :key="src.key"
              :href="src.url"
              target="_blank"
              rel="noopener"
              class="rounded-md px-2 py-0.5 text-xs no-underline transition-colors"
              :style="{
                backgroundColor: 'rgb(var(--nv-secondary) / 0.08)',
                color: 'rgb(var(--nv-secondary))',
              }"
            >
              {{ src.label }}
            </a>
          </div>

          <!-- Image attribution -->
          <div
            v-if="selectedPoi?.imageAttribution || selectedPoi?.imageSourceNotice"
            class="flex flex-col gap-0.5"
          >
            <template v-if="selectedPoi?.imageAttribution">
              <small
                v-if="selectedPoi.imageAttribution.artist || selectedPoi.imageAttribution.credit"
                class="text-xs text-muted-foreground"
              >
                Фото: {{ selectedPoi.imageAttribution.artist || selectedPoi.imageAttribution.credit }}
              </small>
              <small
                v-else-if="selectedPoi.imageAttribution.source"
                class="text-xs text-muted-foreground"
              >
                Источник изображения: {{ selectedPoi.imageAttribution.source }}
              </small>
              <small
                v-if="selectedPoi.imageAttribution.license"
                class="text-xs text-muted-foreground"
              >
                Лицензия:
                <a
                  v-if="selectedPoi.imageAttribution.licenseUrl"
                  :href="selectedPoi.imageAttribution.licenseUrl"
                  target="_blank"
                  rel="noopener"
                  class="underline"
                >
                  {{ selectedPoi.imageAttribution.license }}
                </a>
                <span v-else>{{ selectedPoi.imageAttribution.license }}</span>
              </small>
              <small v-if="selectedPoi.imageAttribution.notice" class="text-xs text-muted-foreground">
                {{ selectedPoi.imageAttribution.notice }}
              </small>
            </template>
            <template v-if="selectedPoi?.imageSourceNotice">
              <small v-if="selectedPoi.imageSourceNotice.source" class="text-xs text-muted-foreground">
                Источник изображения: {{ selectedPoi.imageSourceNotice.source }}
              </small>
              <small v-if="selectedPoi.imageSourceNotice.notice" class="text-xs text-muted-foreground">
                Сведения об источнике: {{ selectedPoi.imageSourceNotice.notice }}
              </small>
            </template>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
/* All styling is done via Tailwind/shadcn classes.
   No additional scoped styles needed. */
</style>
