<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, type Component } from 'vue';
import { useRouter } from 'vue-router';
import {
  Landmark, Medal, Mountain, Church, TreePine, Building2,
  Search, X, AlertCircle, SearchX, Compass, Filter, CheckCheck, Check,
  RefreshCw, LayoutGrid, SlidersHorizontal, FileText, Image as ImageIcon,
  MapPin,
} from 'lucide-vue-next';
import { useTelegram } from '@/composables/useTelegram';
import { useBotShortcut } from '@/composables/useBotShortcut';
import { fetchPois, fetchRegions, type PoiRow, type PoiListResult } from '@/composables/usePois';
import { useCart } from '@/composables/useCart';
import {
  ALL_CATEGORIES,
  CATEGORY_STYLES,
  type PoiCategory,
} from '@/lib/poi-categories';
import { haversine, fmtDistance, type LatLon } from '@/composables/useGeo';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import PoiCard from '@/components/PoiCard.vue';
import CatalogMap from '@/components/CatalogMap.vue';

/** Century filter options — label shown to user, numeric for backend. */
const CENTURY_OPTIONS = [
  { n: 13, label: 'XIII век' }, { n: 14, label: 'XIV век' },
  { n: 15, label: 'XV век' }, { n: 16, label: 'XVI век' },
  { n: 17, label: 'XVII век' }, { n: 18, label: 'XVIII век' },
  { n: 19, label: 'XIX век' }, { n: 20, label: 'XX век' },
  { n: 21, label: 'XXI век' },
];

const router = useRouter();
const { showBackButton, hideBackButton, setMainButton, hideMainButton, haptic, tg } = useTelegram();
useBotShortcut('start');
const cart = useCart();

// ── Lucide icon resolver for categories ─────────────────────
const CATEGORY_LUCIDE_ICONS: Record<string, Component> = {
  heritage: Landmark,
  monument: Medal,
  sights: Mountain,
  religion: Church,
  nature: TreePine,
  museum: Building2,
};
function catIcon(cat: string): Component {
  return CATEGORY_LUCIDE_ICONS[cat] ?? Mountain;
}

// ── State ──────────────────────────────────────────────────────
const pois = ref<PoiRow[]>([]);
const total = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const searchQuery = ref('');
const activeCats = ref<Set<PoiCategory>>(new Set());
const centuryMin = ref(13);
const centuryMax = ref(21);
const centuryEnabled = ref(false);
const selectedRegion = ref<string>('');
const regions = ref<string[]>([]);
const hasDescription = ref(false);
const hasPhoto = ref(false);
const filtersOpen = ref(false);
const userLocation = ref<LatLon | null>(null);
const hasMore = ref(false);

const PAGE_SIZE = 30;
let offset = 0;
let searchDebounce: ReturnType<typeof setTimeout> | undefined;
let backCleanup: (() => void) | undefined;

// ── Computed ───────────────────────────────────────────────────
const isAllCats = computed(() => activeCats.value.size === 0);
const cartCount = computed(() => cart.count.value);

// ── MainButton sync (Telegram native) ────────────────────────
let mainBtnCleanup: (() => void) | undefined;
watch(cartCount, (n) => {
  if (mainBtnCleanup) { mainBtnCleanup(); mainBtnCleanup = undefined; }
  if (n > 0) {
    mainBtnCleanup = setMainButton({
      text: `Маршрут · ${n} ${n === 1 ? 'точка' : n < 5 ? 'точки' : 'точек'}`,
      onClick: goToRoute,
    });
    tg.value?.enableClosingConfirmation();
  } else {
    hideMainButton();
    tg.value?.disableClosingConfirmation();
  }
}, { immediate: true });

// ── Lifecycle ──────────────────────────────────────────────────
onMounted(() => {
  // Telegram BackButton — navigates back in the SPA.
  backCleanup = showBackButton(() => router.back());

  // Try to get user location for distance display.
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLocation.value = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      },
      () => {},
      { timeout: 5000, maximumAge: 60000 },
    );
  }

  loadPois(true);
});

onUnmounted(() => {
  backCleanup?.();
  hideBackButton();
  if (mainBtnCleanup) mainBtnCleanup();
  hideMainButton();
  tg.value?.disableClosingConfirmation();
  if (searchDebounce) clearTimeout(searchDebounce);
});

// ── Data loading ───────────────────────────────────────────────
async function loadPois(reset = false) {
  if (reset) {
    offset = 0;
    pois.value = [];
  }
  loading.value = reset;
  loadingMore.value = !reset;
  error.value = null;

  try {
    const cats = activeCats.value.size > 0 ? Array.from(activeCats.value).join(',') : undefined;
    const res: PoiListResult = await fetchPois({
      category: cats,
      search: searchQuery.value.trim() || undefined,
      limit: PAGE_SIZE,
      offset,
      sort: 'popularity',
      ...(hasDescription.value ? { hasDescription: true } : {}),
      ...(hasPhoto.value ? { hasPhoto: true } : {}),
      ...(centuryEnabled.value
        ? { century: Array.from({ length: centuryMax.value - centuryMin.value + 1 }, (_, i) => centuryMin.value + i).join(',') }
        : {}),
      ...(selectedRegion.value ? { region: selectedRegion.value } : {}),
    });

    if (reset) {
      pois.value = res.items;
    } else {
      pois.value = [...pois.value, ...res.items];
    }
    total.value = res.total;
    offset += res.items.length;
    hasMore.value = pois.value.length < res.total;
  } catch (e: any) {
    error.value = e?.response?.data?.message || 'Не удалось загрузить объекты.';
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

// ── Search with debounce ───────────────────────────────────────
function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadPois(true), 300);
}

function clearSearch() {
  searchQuery.value = '';
  haptic.impact('light');
  loadPois(true);
}

/** Load regions list once on mount. */
fetchRegions().then(r => regions.value = r);

// ── Category filter ────────────────────────────────────────────
function onCenturyChange() {
  if (centuryMin.value > centuryMax.value) {
    [centuryMin.value, centuryMax.value] = [centuryMax.value, centuryMin.value];
  }
  centuryEnabled.value = true;
  loadPois(true);
}

function resetCentury() {
  centuryMin.value = 13;
  centuryMax.value = 21;
  centuryEnabled.value = false;
  loadPois(true);
}

function toggleCat(c: PoiCategory | null) {
  haptic.selection();
  if (c === null) {
    // "Все" chip — reset
    activeCats.value = new Set();
  } else {
    const next = new Set(activeCats.value);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    activeCats.value = next;
  }
  loadPois(true);
}

// ── Content filters (Sheet) ─────────────────────────────────
const contentFilterCount = computed(
  () => (hasDescription.value ? 1 : 0) + (hasPhoto.value ? 1 : 0),
);

function toggleDescription() {
  haptic.selection();
  hasDescription.value = !hasDescription.value;
}

function togglePhoto() {
  haptic.selection();
  hasPhoto.value = !hasPhoto.value;
}

function applyContentFilters() {
  haptic.impact('light');
  filtersOpen.value = false;
  loadPois(true);
}

function resetContentFilters() {
  haptic.impact('light');
  hasDescription.value = false;
  hasPhoto.value = false;
  filtersOpen.value = false;
  loadPois(true);
}

// ── Cart actions ───────────────────────────────────────────────
function removeFromCart(p: PoiRow) {
  haptic.impact('light');
  cart.remove(p.id);
}

/** Wrapper used by <PoiCard>'s @toggle — single source of truth for
 *  "user tapped the add/remove button", keeps haptic + cart coupling local. */
function onPoiToggle(p: PoiRow) {
  if (cart.has(p.id)) {
    removeFromCart(p);
    return;
  }
  haptic.impact('medium');
  // The wizard owns start/profile/budget and the canonical versioned draft.
  // Keeping that policy in one place avoids a second local cart protocol.
  router.push({ name: 'wizard', query: { poi: p.id } });
}

function openPoiDetail(p: PoiRow) {
  haptic.impact('light');
  router.push({ name: 'poi-detail', params: { id: p.id } });
}

function goToRoute() {
  haptic.impact('medium');
  router.push({ name: 'route-preview' });
}

// ── Infinite scroll ────────────────────────────────────────────
const scrollContainer = ref<HTMLElement | null>(null);

function onScroll() {
  const el = scrollContainer.value;
  if (!el || loading.value || loadingMore.value || !hasMore.value) return;
  // Trigger when within 3 card heights of the bottom.
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) {
    loadPois(false);
  }
}

// ── Helpers ────────────────────────────────────────────────────
function poiDistance(p: PoiRow): string | null {
  if (!userLocation.value || p.lat == null || p.lon == null) return null;
  return fmtDistance(haversine(userLocation.value, { lat: p.lat, lon: p.lon }));
}

// poiImgUrl and onImgError moved to <PoiCard>.

// Toggle between list and map view. Map shows the same POIs as pins on a
// cyclOSM raster — a 'where are they' overview, not a full atlas. The
// full interactive map is in the web frontend's AdventureMap.
const viewMode = ref<'list' | 'map'>('list');

function poiName(p: PoiRow): string {
  return p.name || `Объект ${p.id.slice(0, 8)}`;
}

// Suppress unused-var warning for handlers that <PoiCard> now owns.
void poiName;
</script>

<template>
  <div class="catalog-root">
    <!-- Sticky header: search + chips -->
    <header class="catalog-header">
      <!-- Search bar + content-filter button -->
      <div class="flex items-center gap-2">
        <div
          class="flex h-11 flex-1 items-center gap-2 rounded-xl border border-nv-outline-variant/50 bg-nv-surface-lowest px-3 transition-[border-color] duration-150 focus-within:border-nv-primary/60"
        >
        <Search class="size-5 shrink-0 text-nv-on-surface-variant" />
        <input
          v-model="searchQuery"
          type="text"
          class="min-w-0 flex-1 border-none bg-transparent text-[15px] text-nv-on-surface outline-none placeholder:text-nv-on-surface-variant/60"
          placeholder="Поиск мест…"
          @input="onSearchInput"
          @keydown.enter="loadPois(true)"
        />
        <button
          v-if="searchQuery"
          class="flex size-7 shrink-0 items-center justify-center rounded-full text-nv-on-surface-variant active:bg-nv-surface-low"
          @click="clearSearch"
          aria-label="Очистить"
        >
          <X class="size-4" />
        </button>
        </div>

        <!-- Content filters (opens bottom sheet) -->
        <button
          class="catalog-filter-btn"
          :class="{ active: contentFilterCount > 0 }"
          @click="filtersOpen = true"
          aria-label="Фильтры"
        >
          <SlidersHorizontal class="size-5 shrink-0" />
          <span
            v-if="contentFilterCount > 0"
            class="catalog-filter-badge"
          >{{ contentFilterCount }}</span>
        </button>
      </div>

      <!-- Category chips -->
      <div class="flex gap-1.5 overflow-x-auto px-4 pb-1 pt-2 scrollbar-none scroll-smooth" style="scroll-padding-left: 1rem">
        <button
          class="cat-chip"
          :class="{ active: isAllCats }"
          @click="toggleCat(null)"
        >
          <LayoutGrid class="size-4 shrink-0" />
          Все
        </button>
        <button
          v-for="c in ALL_CATEGORIES"
          :key="c"
          class="cat-chip"
          :class="{ active: activeCats.has(c) }"
          :style="activeCats.has(c) ? { background: CATEGORY_STYLES[c].container, color: CATEGORY_STYLES[c].color, borderColor: CATEGORY_STYLES[c].color } : {}"
          @click="toggleCat(c)"
        >
          <component :is="catIcon(c)" class="size-4 shrink-0" />
          {{ CATEGORY_STYLES[c].label }}
        </button>
      </div>
      <div v-if="total > 0" class="flex items-center px-0.5 pt-1">
        <span class="text-xs text-nv-on-surface-variant/60 leading-tight">Найдено: {{ total.toLocaleString('ru') }}</span>
      </div>

      <!-- Century range — two selects (reliable in Telegram WebView) -->
      <div v-if="!loading && total > 0" class="flex items-center gap-1.5 px-0.5 pb-2 pt-1">
        <span class="text-[11px] text-muted-foreground shrink-0">Эпоха</span>
        <select
          v-model.number="centuryMin"
          @change="onCenturyChange"
          class="century-select"
        >
          <option v-for="c in CENTURY_OPTIONS" :key="c.n" :value="c.n">{{ c.label }}</option>
        </select>
        <span class="text-[10px] text-muted-foreground">—</span>
        <select
          v-model.number="centuryMax"
          @change="onCenturyChange"
          class="century-select"
        >
          <option v-for="c in CENTURY_OPTIONS" :key="c.n" :value="c.n">{{ c.label }}</option>
        </select>
        <button
          v-if="centuryEnabled"
          type="button"
          class="ml-auto text-[10px] font-semibold uppercase text-primary"
          @click="resetCentury"
        >Сбросить</button>
      </div>
    </header>

    <!-- Region filter (compact dropdown) -->
    <div v-if="regions.length" class="flex items-center gap-2 px-0.5 py-1.5">
      <MapPin class="size-3.5 shrink-0 text-nv-on-surface-variant/60" />
      <select
        v-model="selectedRegion"
        class="w-full rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-primary/60"
        @change="loadPois(true)"
      >
        <option value="">Все регионы</option>
        <option v-for="r in regions" :key="r" :value="r">{{ r }}</option>
      </select>
    </div>

    <!-- Scrollable list -->
    <div
      ref="scrollContainer"
      class="catalog-list scrollbar-thin"
      @scroll.passive="onScroll"
    >
      <!-- Loading skeleton -->
      <template v-if="loading">
        <div v-for="i in 6" :key="'sk-' + i" class="catalog-skeleton" />
      </template>

      <!-- Error state -->
      <div v-else-if="error" class="state-block">
        <AlertCircle class="size-12 text-nv-on-surface-variant/40" />
        <p class="state-text">{{ error }}</p>
        <Button variant="outline" class="gap-1.5 text-sm" @click="loadPois(true)">
          <RefreshCw class="size-4" />
          Повторить
        </Button>
      </div>

      <!-- Empty state -->
      <div v-else-if="pois.length === 0" class="state-block">
        <component
          :is="searchQuery ? SearchX : Compass"
          class="size-12 text-nv-on-surface-variant/40"
        />
        <p class="state-text">
          {{ searchQuery ? 'Ничего не найдено. Попробуйте изменить запрос.' : 'Объектов в этой категории пока нет.' }}
        </p>
        <Button
          v-if="searchQuery || activeCats.size > 0"
          variant="outline"
          class="gap-1.5 text-sm"
          @click="() => { searchQuery = ''; activeCats = new Set(); loadPois(true); }"
        >
          <Filter class="size-4" />
          Сбросить фильтры
        </Button>
      </div>

      <!-- View mode toggle: list vs map. Independent v-if (NOT v-else-if)
           so the cards/map below render regardless of the toggle state. -->
      <div v-if="!loading && !error && pois.length > 0" class="px-0.5 py-1.5">
        <ToggleGroup
          v-model="viewMode"
          type="single"
          variant="outline"
          class="inline-flex"
        >
          <ToggleGroupItem value="list" aria-label="Список">Список</ToggleGroupItem>
          <ToggleGroupItem value="map" aria-label="Карта">Карта</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <!-- Map view — independent of the ToggleGroup above -->
      <template v-if="viewMode === 'map' && pois.length > 0 && !loading && !error">
        <CatalogMap :pois="pois" @open="openPoiDetail" />
        <p class="mt-2 px-1 text-xs text-nv-on-surface-variant/70">
          Нажмите на метку, чтобы открыть карточку. Вернитесь в список, чтобы добавить в маршрут.
        </p>
      </template>

      <!-- POI cards — independent of the ToggleGroup above -->
      <template v-if="viewMode === 'list' && !loading && !error">
        <PoiCard
          v-for="p in pois"
          :key="p.id"
          :poi="p"
          :in-cart="cart.has(p.id)"
          :distance="poiDistance(p)"
          @open="openPoiDetail"
          @toggle="onPoiToggle"
        />

        <!-- Loading more indicator -->
        <div v-if="loadingMore" class="flex justify-center py-4">
          <div class="skeleton-spinner" />
        </div>

        <!-- End of list -->
        <div v-if="!hasMore && pois.length > 0" class="list-end">
          <CheckCheck class="size-3.5" />
          Всего: {{ total }}
        </div>
      </template>
    </div>

    <!-- ═══ Content filters bottom sheet ═══ -->
    <Sheet v-model:open="filtersOpen">
      <SheetContent side="bottom" class="flex flex-col gap-4 rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Фильтры</SheetTitle>
          <SheetDescription class="sr-only">
            Показывать только объекты с описанием или фото
          </SheetDescription>
        </SheetHeader>

        <button
          class="content-toggle"
          :class="{ active: hasDescription }"
          @click="toggleDescription"
        >
          <span class="flex items-center gap-3">
            <FileText class="size-5 text-nv-on-surface-variant" />
            <span class="flex flex-col items-start">
              <span class="text-sm font-medium text-nv-on-surface">С описанием</span>
              <span class="text-xs text-nv-on-surface-variant">Только объекты с текстом</span>
            </span>
          </span>
          <Check v-if="hasDescription" class="size-5 text-nv-primary" />
        </button>

        <button
          class="content-toggle"
          :class="{ active: hasPhoto }"
          @click="togglePhoto"
        >
          <span class="flex items-center gap-3">
            <ImageIcon class="size-5 text-nv-on-surface-variant" />
            <span class="flex flex-col items-start">
              <span class="text-sm font-medium text-nv-on-surface">С фото</span>
              <span class="text-xs text-nv-on-surface-variant">Только объекты с изображением</span>
            </span>
          </span>
          <Check v-if="hasPhoto" class="size-5 text-nv-primary" />
        </button>

        <div class="mt-1 flex gap-2">
          <Button
            variant="outline"
            class="flex-1 gap-1.5"
            :disabled="contentFilterCount === 0"
            @click="resetContentFilters"
          >
            <Filter class="size-4" />
            Сбросить
          </Button>
          <Button class="flex-1 gap-1.5" @click="applyContentFilters">
            <CheckCheck class="size-4" />
            Показать
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  </div>
</template>

<style scoped>
/* ── Root layout (fixed/inset not ergonomic in Tailwind) ── */
.catalog-root {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: rgb(var(--nv-bg));
  overflow: hidden;
}
.catalog-header {
  flex-shrink: 0;
  padding: calc(8px + var(--safe-top, 0px)) 12px 8px;
  background: rgb(var(--nv-bg));
  z-index: 10;
  box-shadow: 0 1px 0 rgb(var(--nv-outline-variant) / 0.4);
}
.catalog-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 12px calc(16px + var(--safe-bottom, 0px));
}

/* ── Century selects ─────────────────────────────────── */
.century-select {
  font-size: 11px;
  border: 1px solid rgb(var(--nv-outline));
  background: rgb(var(--nv-surface-low));
  color: rgb(var(--nv-on-surface));
  border-radius: 6px;
  padding: 3px 6px;
  outline: none;
  -webkit-appearance: auto;
  appearance: auto;
}

/* ── Category chip ────────────────────────────────────── */
.cat-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 12px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 500;
  background: rgb(var(--nv-surface-lowest));
  border: 1px solid rgb(var(--nv-outline-variant) / 0.5);
  color: rgb(var(--nv-on-surface-variant));
  cursor: pointer;
  white-space: nowrap;
  min-height: 36px;
  transition: all 0.12s;
}
.cat-chip:active {
  transform: scale(0.96);
}
.cat-chip.active {
  background: rgb(var(--nv-primary-container));
  color: rgb(var(--nv-on-primary-container));
  border-color: rgb(var(--nv-primary) / 0.4);
}

/* ── Filter button (opens content-filter sheet) ─────── */
.catalog-filter-btn {
  position: relative;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px solid rgb(var(--nv-outline-variant) / 0.5);
  background: rgb(var(--nv-surface-lowest));
  color: rgb(var(--nv-on-surface-variant));
  cursor: pointer;
  transition: all 0.12s;
}
.catalog-filter-btn:active {
  transform: scale(0.94);
}
.catalog-filter-btn.active {
  border-color: rgb(var(--nv-primary) / 0.6);
  color: rgb(var(--nv-primary));
  background: rgb(var(--nv-primary-container));
}
.catalog-filter-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 9999px;
  background: rgb(var(--nv-primary));
  color: rgb(var(--nv-on-primary));
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

/* ── Content toggle row (in bottom sheet) ────────────── */
.content-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgb(var(--nv-outline-variant) / 0.5);
  background: rgb(var(--nv-surface-lowest));
  cursor: pointer;
  transition: all 0.12s;
}
.content-toggle.active {
  border-color: rgb(var(--nv-primary) / 0.6);
  background: rgb(var(--nv-primary-container) / 0.5);
}
.content-toggle:active {
  transform: scale(0.99);
}

/* ── POI card ─────────────────────────────────────────── */
.poi-card {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 10px;
  border-radius: 14px;
  background: rgb(var(--nv-surface-lowest));
  margin-bottom: 8px;
  position: relative;
  cursor: pointer;
  transition: background 0.12s;
  border: 1px solid transparent;
}
.poi-card:active {
  background: rgb(var(--nv-surface-low));
}
.poi-card-media {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  border-radius: 10px;
  overflow: hidden;
  background: rgb(var(--nv-surface-low));
}
.poi-card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.poi-card-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--nv-surface-low));
}
.poi-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding-right: 36px;
}
.poi-card-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.poi-dist {
  font-size: 11px;
  color: rgb(var(--nv-on-surface-variant));
  white-space: nowrap;
}
.poi-card-name {
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--nv-on-surface));
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.poi-card-desc {
  font-size: 12px;
  color: rgb(var(--nv-on-surface-variant));
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.poi-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin-top: 4px;
  font-size: 11px;
  color: rgb(var(--nv-on-surface-variant));
  opacity: 0.85;
}
.poi-card-meta > span {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}
.poi-card-loc {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: rgb(var(--nv-on-surface-variant) / 0.85);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}
.poi-card-add {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgb(var(--nv-surface-low));
  color: rgb(var(--nv-on-surface-variant));
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}
.poi-card-add:active {
  transform: translateY(-50%) scale(0.9);
}
.poi-card-add.is-in {
  background: rgb(var(--nv-primary));
  color: rgb(var(--nv-on-primary));
}

/* ── Skeleton loading ────────────────────────────────── */
.catalog-skeleton {
  height: 92px;
  border-radius: 14px;
  margin-bottom: 8px;
  background: linear-gradient(
    90deg,
    rgb(var(--nv-surface-low)) 25%,
    rgb(var(--nv-outline-variant) / 0.15) 50%,
    rgb(var(--nv-surface-low)) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.skeleton-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgb(var(--nv-outline-variant) / 0.3);
  border-top-color: rgb(var(--nv-primary));
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── State blocks ────────────────────────────────────── */
.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  text-align: center;
}
.state-text {
  font-size: 14px;
  color: rgb(var(--nv-on-surface-variant));
  line-height: 1.4;
  margin: 0;
  max-width: 260px;
}

/* ── Load more / end ─────────────────────────────────── */
.list-end {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px 0 8px;
  font-size: 12px;
  color: rgb(var(--nv-on-surface-variant) / 0.6);
}

/* ── Utilities ───────────────────────────────────────── */
.scrollbar-none {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
.scrollbar-thin {
  scrollbar-width: thin;
}
</style>
