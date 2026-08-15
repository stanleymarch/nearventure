<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, type Component, h, render } from 'vue';
import { useStorage } from '@vueuse/core';
import { useRouter, useRoute } from 'vue-router';
import maplibregl from 'maplibre-gl';
import { Motion, AnimatePresence } from 'motion-v';
import { toast } from 'vue-sonner';
import {
  Compass, Layers, Share2, Download, Save, Plus, Check, Sun, Moon, User,
  Sparkles, Bike, Footprints, Car, Clock, Mountain, Route as RouteIcon,
  Navigation, Loader2, SlidersHorizontal, MapPin, Trash2, TrendingUp, TrendingDown,
  Globe, X, Check as CheckIcon, Radar, Maximize2, Minimize2,
  ArrowUpRight, Link2, BookOpen, BadgeCheck, RefreshCw, ChevronUp, ChevronDown,
  Send, Landmark,
} from 'lucide-vue-next';
import AdventureMap from '@/components/AdventureMap.vue';
import OnboardingCarousel from '@/components/OnboardingCarousel.vue';
import DragRail from '@/components/DragRail.vue';
import Icon from '@/components/Icon.vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  getPois, poiName, poiAttribution, poiHasExternalLinks, isVkUrl,
  poiMediaUrlById,
  SOURCE_LABELS, HERITAGE_LABELS, type Poi, type PoiCategory,
} from '@/api/pois';
import {
  planRoute, getRoutingHealth, downloadGpx, getIsochrone,
  formatDistance, formatDuration, straightDistance,
  type RoutingProfile, type RouteResult, type LatLng, type PlanResult,
  type SuggestedPoi, type RoutingHealth,
} from '@/api/routing';
import { availableRoutingProfiles, isRoutingProfileAvailable, preserveRoutingProfile, ROUTING_PROFILE_LABELS, createLatestRequestGate } from '@/api/routing-contracts';
import {
  useGeolocation, budgetToDistance, formatMinutes, type GeoPoint,
} from '@/composables/useGeolocation';
import { extractLineCoordinates } from '@/lib/geojson-utils';
import { useTheme } from '@/composables/useTheme';
import {
  CATEGORY_ORDER, CATEGORY_STYLES, DEFAULT_ACTIVE_CATEGORIES, isWaterPoi,
} from '@/lib/poi-categories';
import { CATEGORY_LUCIDE as CATEGORY_ICON, poiLucideIcon } from '@/lib/category-icons';
import { DEFAULT_STYLE_CONFIG, buildStyle, type MapStyleConfig } from '@/lib/map-styles';
import ItineraryRail from '@/components/itinerary/ItineraryRail.vue';
import RouteWorkspace from '@/components/route/RouteWorkspace.vue';
import RouteEvidence from '@/components/route/RouteEvidence.vue';
import { useItineraryDraft } from '@/composables/useItineraryDraft';
import type { AutoFillPreset, BudgetMode, CreateItineraryInput, RouteImpactItem, VisitMode } from '@/api/itineraries';

const router = useRouter();
const route = useRoute();
const { isDark, toggleTheme, setTheme } = useTheme();
const { locate: locateMe, loading: locating } = useGeolocation();
const itinerary = useItineraryDraft();
const showItineraryMobile = ref(false);
const mobileItineraryExpanded = ref(false);
const plannerOpen = ref(false);
const railCollapsed = ref(false);
const restartConfirmOpen = ref(false);
const plannerSuccess = ref('');
const plannerHeading = ref<HTMLElement | null>(null);

// ---- viewport (drives Sheet side variants) ----
// At tablet widths a 360–400 px side rail would leave less than 55% of the
// viewport for the map, so the itinerary stays a bottom sheet until 1024 px.
const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
const showMapChrome = ref(true);
function toggleMapChrome() {
  showMapChrome.value = !showMapChrome.value;
}
function onGlobalKeydown(event: KeyboardEvent) { if (event.key === 'Escape') itinerary.clearAlternativePreview(); }
function onResize() {
  const nextMobile = window.innerWidth < 1024;
  if (isMobile.value === nextMobile) return;
  isMobile.value = nextMobile;
  // A bottom sheet belongs only to mobile/tablet; a desktop rail is restored
  // immediately when crossing the breakpoint.
  showItineraryMobile.value = false;
  mobileItineraryExpanded.value = false;
  if (!nextMobile && itinerary.draft.value) railCollapsed.value = false;
}

// ---- reactive state ----
const ghReady = ref<boolean | null>(null);
const routingHealth = ref<RoutingHealth | null>(null);
const timeMinutes = ref(90); // default for bike/mtb
// Automatic selection is always pass_by on its first build. Per-Place dwell
// is an explicit edit after the server returns the route.
const draftPreset = ref<AutoFillPreset>('balanced');
const preflightBudgetMode = ref<BudgetMode>('whole_trip');
/** Preserve the exact public GraphHopper profile, including its aliases. */
const profile = ref<RoutingProfile>('bike');

const availableProfiles = computed(() => availableRoutingProfiles(routingHealth.value));
const profileAvailable = computed(() => ghReady.value !== false && isRoutingProfileAvailable(profile.value, routingHealth.value));
const canRequestRouting = computed(() => ghReady.value === true && profileAvailable.value);
itinerary.setRoutingGuard(
  () => canRequestRouting.value,
  () => {
    error.value = ghReady.value === false
      ? 'Маршрутизатор недоступен. Повторите проверку и попробуйте снова.'
      : 'Проверяем маршрутизатор. Подождите немного.';
    toast.error('Маршрутизация недоступна', { description: 'Повторите проверку подключения и попробуйте снова.' });
  },
);
function onProfileChange(value: RoutingProfile) {
  if (ghReady.value !== false && isRoutingProfileAvailable(value, routingHealth.value)) profile.value = value;
}

/** The itinerary's immutable published route id (`null` while unpublished). */
const publishedRouteId = computed(() => itinerary.draft.value?.publishedRouteId ?? null);

/** Sharing is only valid for the immutable route created by explicit publish. */
const canShareRoute = computed(() => Boolean(activeRoute.value) && Boolean(publishedRouteId.value));
const canShareSummary = computed(() => Boolean(summaryRoute.value) && Boolean(publishedRouteId.value));

const start = ref<LatLng | null>(null);
const startLabel = ref<string>('Моё местоположение');
const finish = ref<LatLng | null>(null);
const finishLabel = ref('');
const mapPickTarget = ref<'start' | 'finish'>('start');

// ── Persisted preferences (local: survive reloads, per-device) ──
// Selected POI categories and the map style (base + overlays) are a user's
// personal view of the map — we keep them in localStorage so returning to
// /map restores the same picture without re-toggling everything.
const CATEGORY_KEYS = CATEGORY_ORDER as readonly string[];
const activeCategoriesArr = useStorage<string[]>('nv:active-categories', [...DEFAULT_ACTIVE_CATEGORIES]);
const activeCategories = computed<Set<PoiCategory>>({
  get: () => new Set(activeCategoriesArr.value.filter((c): c is PoiCategory => CATEGORY_KEYS.includes(c))),
  set: (v) => { activeCategoriesArr.value = [...v]; },
});

const pois = ref<Poi[]>([]);
const loadingPois = ref(false);
const errorPois = ref<string | null>(null);

const showOnboarding = ref(false);

// ── Map style config (passed to AdventureMap as :style-config) ───
// Controls base map (light/dark/satellite) and overlays (cycling/hiking/hillshade).
// Sheet buttons update this ref; AdventureMap watches it for style rebuilds.
const styleConfig = useStorage<MapStyleConfig>('nv:map-style', { ...DEFAULT_STYLE_CONFIG }, undefined, { deep: true });

// Sync UI theme ↔ map base style (single source of truth)
watch(isDark, (dark) => {
  styleConfig.value = { ...styleConfig.value, base: dark ? 'dark' : 'light' };
}, { immediate: true });

// ── Quick-visibility toggles (derived from styleConfig where applicable) ─
const showHillshade = computed(() => styleConfig.value.overlays.hillshade);
const showContours = computed(() => styleConfig.value.overlays.contours);
// FE-3: independent isochrone (reachable-area) visibility toggle.
// Bound to <AdventureMap :show-isochrone>; the map agent wires it to layer visibility.
const showIsochrone = useStorage<boolean>('nv:show-isochrone', true);
const isochroneApproximate = ref(false);
const showLayerPanel = ref(false);

// ── Route planning ────────────────────────────────────────────────
const optLoop = ref(true);
const optOptimize = ref(true);
const optAlternatives = ref(false);
const planResult = ref<PlanResult | null>(null);
const activeRoute = ref<RouteResult | null>(null);
const activeRouteIdx = ref(0);
const orderChanged = ref(false);
const error = ref<string | null>(null);
// Keep location failures separate: a manual start may dismiss only this stale
// message, never an unrelated routing or save failure.
const geolocationError = ref<string | null>(null);
const displayError = computed(() => error.value ?? geolocationError.value);
const loading = ref(false);

/** Kirov center (default map center / fallback location). */
const KIROV: [number, number] = [58.603, 49.668];

const selectedWaypoints = ref<Poi[]>([]);
const selectedPoi = ref<Poi | null>(null);
const pendingManualPoi = ref<Poi | null>(null);

// ── Trip summary dialog (rich overview with mini-map) ─────────────
const showTripSummary = ref(false);
const summaryRoute = ref<RouteResult | null>(null);
const summaryLoop = ref<boolean | null>(null);
const activeRouteLoop = ref(true);
const summaryPois = ref<Poi[]>([]);
const summaryLoading = ref(false);
const routeMode = ref<'auto' | 'manual'>('auto');
const summaryMapEl = ref<HTMLDivElement | null>(null);
let summaryMap: maplibregl.Map | null = null;

/** POIs suggested by enrichment (near the route, fit in budget).
 *  Surfaced in the TripSummary dialog as "+N min, add?" chips. */
const suggestedPois = ref<SuggestedPoi[]>([]);

const mapRef = ref<InstanceType<typeof AdventureMap> | null>(null);

// ---------- derived ----------
const timeLabel = computed(() => formatMinutes(timeMinutes.value));
const distanceHint = computed(() =>
  formatDistance(budgetToDistance(timeMinutes.value, profile.value)),
);

const hasWaypoints = computed(() => selectedWaypoints.value.length > 0);
const alternativesAvailable = computed(
  () => selectedWaypoints.value.length === 1 && !optLoop.value,
);

const detailSide = computed<'bottom' | 'right'>(() => (isMobile.value ? 'bottom' : 'right'));
const layersSide = computed<'bottom' | 'right'>(() => (isMobile.value ? 'bottom' : 'right'));

/** Stop number for a selected POI (1-based) after TSP reorder, else selection order. */
function stopNumber(poi: Poi): number | null {
  const selIdx = selectedWaypoints.value.findIndex((p) => p.id === poi.id);
  if (selIdx < 0) return null;
  if (planResult.value && planResult.value.optimize) {
    const pos = planResult.value.order.indexOf(selIdx);
    return pos < 0 ? selIdx + 1 : pos + 1;
  }
  return selIdx + 1;
}

function catalogVibeRank(poi: Poi): number {
  if (draftPreset.value === 'scenic') return poi.category === 'nature' || poi.category === 'sights' ? 2 : 0;
  if (draftPreset.value === 'training') return poi.category === 'nature' ? 2 : 0;
  if (draftPreset.value === 'more_places') return 0;
  return (poi.popularityScore ?? 0) / 100;
}

const discovery = computed(() => {
  const origin = start.value ?? { lat: KIROV[0] as number, lon: KIROV[1] as number };
  const seen = new Set<string>();
  return [...pois.value]
    .filter(
      (p) =>
        activeCategories.value.has(p.category) &&
        !selectedWaypoints.value.some((w) => w.id === p.id) &&
        seen.size === seen.add(p.id).size - 1, // dedup by id
    )
    .map((p) => ({ poi: p, d: straightDistance(origin, { lat: p.lat, lon: p.lon }) }))
    .sort((a, b) => catalogVibeRank(b.poi) - catalogVibeRank(a.poi) || a.d - b.d || (b.poi.popularityScore ?? 0) - (a.poi.popularityScore ?? 0))
    .slice(0, 8);
});

const routeImpacts = ref<Record<string, RouteImpactItem>>({});
const selectedPoiImpact = computed(() => selectedPoi.value ? routeImpacts.value[selectedPoi.value.id] : undefined);
const impactEstimate = (poiId: string) => routeImpacts.value[poiId]?.estimate;
const compactMinutes = (minutes: number) => minutes >= 60
  ? `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')}`
  : `${Math.round(minutes)} мин`;
const mobileRouteCapsuleLabel = computed(() => {
  const draft = itinerary.draft.value;
  if (!draft) return 'План';
  const total = compactMinutes(draft.totals.totalMinutes);
  const budget = draft.totals.budgetMinutes == null ? 'без лимита' : compactMinutes(draft.totals.budgetMinutes);
  return `${draft.places.length} ${ruPlural(draft.places.length, ['место', 'места', 'мест'])} · ${total} / ${budget}`;
});

const emptyStateAction = computed(() => {
  if (!activeCategories.value.size) {
    return {
      icon: 'layers',
      text: 'Включите категории точек',
      action: () => (activeCategories.value = new Set(DEFAULT_ACTIVE_CATEGORIES)),
    };
  }
  if (!ghReady.value) {
    return { icon: 'refresh', text: 'Проверьте подключение к маршрутизатору', action: () => checkHealth() };
  }
  return { icon: 'explore', text: 'Нажмите на карту, чтобы поставить точку старта' };
});

const routeCard = computed(() => {
  if (!activeRoute.value) return null;
  return {
    distance: formatDistance(activeRoute.value.distance),
    duration: formatDuration(activeRoute.value.duration),
    ascend: activeRoute.value.ascend ? Math.round(activeRoute.value.ascend) : null,
  };
});

const canAdventure = computed(() => !!start.value && !!ghReady.value && profileAvailable.value);
const canPlan = computed(() => !!start.value && hasWaypoints.value && !!ghReady.value && profileAvailable.value);

const startPointForMap = computed(
  () => (start.value ? { lat: start.value.lat, lng: start.value.lon } : null),
);
const finishPointForMap = computed(
  () => (finish.value ? { lat: finish.value.lat, lng: finish.value.lon } : null),
);
const routeStopsForMap = computed(() => (itinerary.draft.value?.places ?? [])
  .map((place, index) => {
    const point = place.accessPoint ?? place.center ?? place.pois[0];
    return point ? { id: place.id, name: place.name, lat: point.lat, lon: point.lon, index: index + 1 } : null;
  })
  .filter((stop): stop is NonNullable<typeof stop> => stop !== null));

// ---------- category toggles ----------
function toggleCategory(cat: PoiCategory) {
  const next = new Set(activeCategories.value);
  next.has(cat) ? next.delete(cat) : next.add(cat);
  activeCategories.value = next;
}
const isCatOn = (cat: PoiCategory) => activeCategories.value.has(cat);

// ── Route preference indicator ──────────────────────────────────────
// Categories rank automatic candidates and the manual shop; they never mutate
// a manual itinerary by themselves.
const totalCategories = CATEGORY_ORDER.length;
const activeCategoryCount = computed(() => activeCategories.value.size);
const hiddenCategoryCount = computed(() => totalCategories - activeCategories.value.size);

/** Number of active map overlays (cycling, hiking, hillshade, contours, isochrone).
 *  Drives the badge on the Layers button so the user sees overlay state at a glance. */
/** Russian plural picker: ruPlural(2, ['точка','точки','точек']) → 'точки'. */
function ruPlural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

const routeScopeLabel = computed(() => {
  const n = activeCategoryCount.value;
  if (n === 0) return 'Без предпочтений по категориям';
  if (hiddenCategoryCount.value === 0) return `Все ${totalCategories} категорий в приоритете`;
  return `${n} из ${totalCategories} категорий в приоритете`;
});

// CATEGORY_ICON + poiLucideIcon are imported from @/lib/category-icons so the
// map pins (CATEGORY_PIN_PATHS), the chips and the cards all resolve to the
// SAME glyph per category. See poi-categories.ts for the single source of truth.

/** Lucide icons for the empty-state hints (keys match `emptyStateAction.icon`). */
const EMPTY_STATE_ICON: Record<string, Component> = {
  layers: Layers,
  refresh: RefreshCw,
  explore: Compass,
};

// ---------- start / location ----------
function onMapClick({ lat, lng }: { lat: number; lng: number }) {
  if (mapPickTarget.value === 'finish' && !optLoop.value) {
    finish.value = { lat, lon: lng };
    finishLabel.value = 'Финиш на карте';
    mapPickTarget.value = 'start';
    toast.success('Финиш выбран');
    return;
  }
  setStart({ lat, lon: lng }, 'Своя точка');
}

function pickFinishOnMap() {
  if (optLoop.value) return;
  mapPickTarget.value = 'finish';
  toast.info('Укажите финиш на карте', { description: 'Нажмите на нужную точку. Без финиша маршрут закончится у последнего места.' });
}

function clearFinish() {
  finish.value = null;
  finishLabel.value = '';
  mapPickTarget.value = 'start';
}

function onStartDrag(p: { lat: number; lng: number }) {
  setStart({ lat: p.lat, lon: p.lng }, 'Своя точка');
}

async function onMapView(view: { bbox: [number, number, number, number]; zoom: number }) {
  loadingPois.value = true;
  errorPois.value = null;
  try {
    const [minLng, minLat, maxLng, maxLat] = view.bbox;
    const bboxStr = `${minLng.toFixed(5)},${minLat.toFixed(5)},${maxLng.toFixed(5)},${maxLat.toFixed(5)}`;
    const cats = Array.from(activeCategories.value).join(',') || undefined;
    const res = await getPois({ bbox: bboxStr, limit: 200, category: cats, sort: 'popularity' });
    pois.value = res.items;
  } catch (e: any) {
    errorPois.value = e?.message || 'Не удалось загрузить точки';
  } finally {
    loadingPois.value = false;
  }
}

function setStart(p: LatLng, label: string) {
  start.value = p;
  startLabel.value = label;
  // A manually chosen start supersedes a failed location prompt, but must
  // not hide an unrelated routing or save failure.
  geolocationError.value = null;
  scheduleRebuild();
}
// Expose for e2e tests
if (typeof window !== 'undefined') {
  (window as any).__setStart = setStart;
  (window as any).__setTimeMinutes = (v: number) => { timeMinutes.value = v; };
  (window as any).__setTransport = (v: RoutingProfile) => { profile.value = v; };
}

// ---------- Isochrone (reachable area for time budget) ----------
let isochroneTimer: ReturnType<typeof setTimeout> | null = null;
async function refreshIsochrone() {
  if (!showIsochrone.value || !start.value || ghReady.value !== true || !profileAvailable.value || (routeMode.value === 'manual' && preflightBudgetMode.value === 'unlimited')) {
    isochroneApproximate.value = false;
    mapRef.value?.clearIsochrone();
    return;
  }
  try {
    const res = await getIsochrone(start.value, profile.value, timeMinutes.value);
    isochroneApproximate.value = res.approximate === true;
    mapRef.value?.drawIsochrone(res.geojson ?? null);
  } catch {
    isochroneApproximate.value = false;
    mapRef.value?.clearIsochrone();
  }
}
function scheduleIsochrone() {
  if (isochroneTimer) clearTimeout(isochroneTimer);
  isochroneTimer = setTimeout(refreshIsochrone, 400);
}
watch([start, profile, timeMinutes, routeMode, preflightBudgetMode], scheduleIsochrone, { deep: true });

// Adjust default time budget when switching transport mode.
// Car reaches much further in 60 min than bike; short budgets produce
// poor reachability for slower profiles.
watch(profile, (selected) => {
  if (selected === 'car') timeMinutes.value = Math.max(timeMinutes.value, 60);
  else if (selected.startsWith('bike') || selected.startsWith('mtb')) timeMinutes.value = Math.max(timeMinutes.value, 90);
  else timeMinutes.value = Math.max(timeMinutes.value, 150);
});
// FE-3: react to the visibility toggle itself — redraw when re-enabled, clear when disabled.
watch(showIsochrone, (on) => {
  if (on) scheduleIsochrone();
  else mapRef.value?.clearIsochrone();
});

async function useMyLocation() {
  try {
    const p: GeoPoint = await locateMe();
    setStart({ lat: p.lat, lon: p.lng }, 'Моё местоположение');
    mapRef.value?.panTo({ lat: p.lat, lng: p.lng });
  } catch (e: any) {
    geolocationError.value = e?.message || 'Не удалось определить местоположение';
    toast.error('Не удалось определить местоположение');
  }
}

// ---------- POI selection ----------
/** When opening POI detail from inside the TripSummary dialog, hide the
 *  summary first to avoid z-index stacking (both Dialog and Sheet are z-50).
 *  The flag restores the summary when the detail sheet closes. */
const summaryHiddenForDetail = ref(false);
function openDetail(poi: Poi) {
  selectedPoi.value = poi;
  if (showTripSummary.value) {
    showTripSummary.value = false;
    summaryHiddenForDetail.value = true;
  }
}

function createDraftInput(intent: 'auto_budget' | 'manual_collection' | 'destination'): CreateItineraryInput | null {
  if (!start.value) return null;
  const budgetMode: BudgetMode = intent === 'auto_budget' ? 'whole_trip' : preflightBudgetMode.value;
  return {
    start: start.value,
    ...(!optLoop.value && finish.value ? { finish: finish.value } : {}),
    profile: profile.value,
    loop: optLoop.value,
    intent,
    // The first route has no implicit dwell. Place modes are explicit edits.
    stopPace: 'pass_by',
    budgetMode,
    ...(budgetMode === 'unlimited' ? {} : { budgetMinutes: timeMinutes.value }),
    preset: draftPreset.value,
  };
}

async function ensureManualDraft() {
  if (itinerary.draft.value) return itinerary.draft.value;
  const input = createDraftInput('manual_collection');
  return input ? itinerary.create(input) : null;
}

async function goToDestination(poi: Poi) {
  if (ghReady.value !== true || !profileAvailable.value) {
    toast.error('Маршрутизация пока недоступна', { description: ghReady.value === null ? 'Проверяем маршрутизатор.' : 'Повторите проверку подключения.' });
    return;
  }
  if (!start.value) {
    toast.info('Сначала укажите старт', { description: 'Разрешите геолокацию или поставьте точку на карте.' });
    return;
  }
  // A new destination must pass through the same explicit conditions as every
  // manual route. Existing drafts are extended without resetting their state.
  const draft = itinerary.draft.value;
  if (!draft) {
    pendingManualPoi.value = poi;
    openPlanner('manual');
    selectedPoi.value = null;
    toast.info('Сначала условия маршрута', { description: 'Выберите транспорт, время и финиш. Затем место будет добавлено.' });
    return;
  }
  if (!draft.places.some((place) => place.pois.some((item) => item.id === poi.id))) {
    if (!await itinerary.addPoi(poi.id)) return;
  }
  const replanned = await itinerary.replan();
  if (!replanned?.route) return;
  routeMode.value = 'manual';
  if (!selectedWaypoints.value.some((item) => item.id === poi.id)) selectedWaypoints.value = [...selectedWaypoints.value, poi];
  summaryRoute.value = replanned.route as RouteResult;
  summaryPois.value = selectedWaypoints.value;
  showTripSummary.value = true;
  selectedPoi.value = null;
}

/** «Начать отсюда» — make this POI the route start. */
function startFromHere(poi: Poi) {
  setStart({ lat: poi.lat, lon: poi.lon }, poiName(poi));
  toast.success('Старт задан', { description: 'Отредактируйте условия и соберите маршрут.' });
  selectedPoi.value = null;
}

/** «Посмотреть рядом» — fly the map to the POI and drop out of the sheet. */
function lookNearby(poi: Poi) {
  mapRef.value?.panTo({ lat: poi.lat, lng: poi.lon });
  selectedPoi.value = null;
}

async function addToRoute(poi: Poi) {
  if (ghReady.value !== true || !profileAvailable.value) {
    toast.error('Маршрутизация пока недоступна', { description: ghReady.value === null ? 'Проверяем маршрутизатор.' : 'Повторите проверку подключения.' });
    return;
  }
  // Adding a point is an explicit move into manual routing: the trip is built
  // through the picked points instead of auto-generated from categories. Mirror
  // that in `routeMode` so the indicator / CTA / time budget reflect reality,
  // and surface the transition to the user instead of switching silently.
  const wasAuto = routeMode.value === 'auto';
  if (!itinerary.draft.value) {
    pendingManualPoi.value = poi;
    openPlanner('manual');
    selectedPoi.value = null;
    toast.info('Сначала условия маршрута', { description: 'После подтверждения место попадёт в ручной маршрут.' });
    return;
  }
  const updated = await itinerary.addPoi(poi.id);
  if (!updated) return;
  await itinerary.replan();
  if (!selectedWaypoints.value.some((item) => item.id === poi.id)) {
    selectedWaypoints.value = [...selectedWaypoints.value, poi];
  }
  routeMode.value = 'manual';
  plannerOpen.value = false;
  if (isMobile.value) {
    mobileItineraryExpanded.value = false;
    showItineraryMobile.value = true;
  }
  // The draft replan is the only route writer once manual itinerary exists.
  toast.success(
    `«${poiName(poi)}» в маршруте`,
    { description: wasAuto ? 'Добавлена точка. Маршрут будет строиться по выбранным объектам.' : `Точка ${selectedWaypoints.value.length}` },
  );
}

async function removeWaypoint(id: string) {
  const place = itinerary.draft.value?.places.find(node => node.pois.some(poi => poi.id === id));
  if (place) {
    if (!await itinerary.removePlace(place.id)) return;
    await itinerary.replan();
  }
  selectedWaypoints.value = selectedWaypoints.value.filter((p) => p.id !== id);
  if (selectedPoi.value?.id === id) selectedPoi.value = null;
  if (selectedWaypoints.value.length === 0) {
    activeRoute.value = null;
    planResult.value = null;
    paintRoute(null);
  }
}
function clearSelection() {
  selectedWaypoints.value = [];
  selectedPoi.value = null;
  activeRoute.value = null;
  planResult.value = null;
  routeMode.value = 'auto';
  paintRoute(null);
}

/** Add a suggested POI (from enrichment) to the route and rebuild. */
function addSuggestedPoi(sug: SuggestedPoi) {
  const poi: Poi = {
    id: sug.id,
    source: 'suggested',
    externalId: sug.id,
    category: sug.category as PoiCategory,
    tags: null,
    lat: sug.lat,
    lon: sug.lon,
    name: sug.name,
    nameRu: sug.name,
    descRu: null,
    imageUrl: null,
    featured: false,
    popularityScore: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  addToRoute(poi);
}
async function moveWaypointUp(idx: number) {
  if (idx <= 0) return;
  const arr = [...selectedWaypoints.value];
  [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
  if (itinerary.draft.value) {
    const ids = arr.map((poi) => itinerary.draft.value!.places.find((place) => place.pois.some((child) => child.id === poi.id))?.id).filter((id): id is string => !!id);
    if (ids.length === itinerary.draft.value.places.length && await itinerary.reorder(ids)) await itinerary.replan();
    return;
  }
  selectedWaypoints.value = arr;
  scheduleRebuild();
}
async function moveWaypointDown(idx: number) {
  if (idx >= selectedWaypoints.value.length - 1) return;
  const arr = [...selectedWaypoints.value];
  [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
  if (itinerary.draft.value) {
    const ids = arr.map((poi) => itinerary.draft.value!.places.find((place) => place.pois.some((child) => child.id === poi.id))?.id).filter((id): id is string => !!id);
    if (ids.length === itinerary.draft.value.places.length && await itinerary.reorder(ids)) await itinerary.replan();
    return;
  }
  selectedWaypoints.value = arr;
  scheduleRebuild();
}
function closeDetail() {
  selectedPoi.value = null;
  // Restore TripSummary if it was hidden to show the detail sheet.
  if (summaryHiddenForDetail.value) {
    showTripSummary.value = true;
    summaryHiddenForDetail.value = false;
  }
}

let impactTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleImpactRefresh() {
  if (impactTimer) clearTimeout(impactTimer);
  impactTimer = setTimeout(refreshRouteImpacts, 180);
}
async function refreshRouteImpacts() {
  const draft = itinerary.draft.value;
  if (!draft?.route) {
    routeImpacts.value = {};
    return;
  }
  const ids = new Set<string>();
  if (selectedPoi.value) ids.add(selectedPoi.value.id);
  if (!isMobile.value && routeMode.value === 'manual') {
    discovery.value.slice(0, 8).forEach(({ poi }) => ids.add(poi.id));
  }
  if (!ids.size) return;
  const version = draft.version;
  const result = await itinerary.routeImpact([...ids]);
  if (itinerary.draft.value?.version !== version) return;
  routeImpacts.value = Object.fromEntries(result.map((item) => [item.poiId, item]));
}

/** Open the common conditions preflight before auto or manual surfaces. */
function openPlanner(mode: 'auto' | 'manual') {
  routeMode.value = mode;
  if (mode === 'auto') preflightBudgetMode.value = 'whole_trip';
  plannerOpen.value = true;
  selectedPoi.value = null;
  showItineraryMobile.value = false;
}

function setRouteMode(mode: 'auto' | 'manual') {
  routeMode.value = mode;
  if (mode === 'auto') preflightBudgetMode.value = 'whole_trip';
  plannerOpen.value = true;
}

// ---------- route painting on the main map ----------
function paintRoute(r: RouteResult | null) {
  const m = mapRef.value;
  if (!m) return;
  const g = r?.geojson?.geometry;
  if (g?.type === 'LineString' && g.coordinates.length > 1) {
    m.drawRoutePreview(g.coordinates.map(([lon, lat]) => ({ lon, lat })));
  } else {
    m.clearRoutePreview();
  }
}
function fitRoute(r: RouteResult | null) {
  const m = mapRef.value;
  if (!m || !r?.bbox) return;
  const [minLng, minLat, maxLng, maxLat] = r.bbox;
  m.flyToBounds([
    [minLng, minLat],
    [maxLng, maxLat],
  ]);
}

// ---------- route planning ----------
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRebuild() {
  // A persisted itinerary is the sole route source. Legacy planning remains
  // available only before a draft exists for the auto/manual discovery flow.
  if (itinerary.draft.value) return;
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 250);
}

async function rebuild() {
  if (itinerary.draft.value || !start.value || !hasWaypoints.value || ghReady.value !== true || !profileAvailable.value) return;
  error.value = null;
  loading.value = true;
  try {
    const res = await planRoute(
      start.value,
      selectedWaypoints.value.map((p) => ({ lat: p.lat, lon: p.lon })),
      profile.value,
      {
        loop: optLoop.value,
        optimize: optOptimize.value,
        alternatives: optAlternatives.value && alternativesAvailable.value,
        maxAlternatives: 3,
      },
    );
    planResult.value = res;
    activeRouteIdx.value = 0;
    if (res.optimize && res.order.length > 0) {
      const originalOrder = res.order.slice().sort();
      orderChanged.value = !res.order.every((val, i) => val === originalOrder[i]);
    } else {
      orderChanged.value = false;
    }
    applyActiveRoute();
    await nextTick();
    fitRoute(activeRoute.value);
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || 'Не удалось построить маршрут';
  } finally {
    loading.value = false;
  }
}

function applyActiveRoute() {
  const routes = planResult.value?.routes ?? [];
  activeRoute.value = routes[activeRouteIdx.value] ?? routes[0] ?? null;
  if (planResult.value) activeRouteLoop.value = planResult.value.loop;
}
function selectVariant(idx: number) {
  activeRouteIdx.value = idx;
  applyActiveRoute();
}

// ---------- canonical preflight completion ----------
async function prepareTrip() {
  if (ghReady.value !== true || !profileAvailable.value) {
    error.value = ghReady.value === false ? 'Маршрутизатор недоступен. Проверьте подключение и попробуйте снова.' : ghReady.value === null ? 'Проверяем маршрутизатор. Подождите немного.' : 'Выберите доступный транспорт.';
    return;
  }
  if (!start.value) {
    error.value = 'Сначала укажите точку старта (геолокация или клик по карте)';
    toast.error('Сначала укажите точку старта');
    return;
  }
  error.value = null;
  summaryLoading.value = true;
  try {
    if (routeMode.value === 'manual') {
      const draft = await ensureManualDraft();
      if (!draft) return;
      const pending = pendingManualPoi.value;
      pendingManualPoi.value = null;
      if (pending && !draft.places.some((place) => place.pois.some((poi) => poi.id === pending.id))) {
        if (await itinerary.addPoi(pending.id)) {
          await itinerary.replan();
          selectedWaypoints.value = [pending];
        }
      }
      plannerOpen.value = false;
      toast.success('Условия сохранены', { description: 'Теперь добавляйте места с карты или из каталога.' });
      if (isMobile.value && itinerary.draft.value?.places.length) showItineraryMobile.value = true;
      return;
    }

    const input = createDraftInput('auto_budget');
    const draft = itinerary.draft.value ?? (input ? await itinerary.create(input) : null);
    if (!draft) return;
    const selected = await itinerary.autoFill(Array.from(activeCategories.value), undefined, draftPreset.value);
    if (!selected?.route) return;
    summaryRoute.value = selected.route as RouteResult;
    summaryLoop.value = selected.loop;
    summaryPois.value = selected.places.flatMap((place) => place.pois).filter((poi) => poi.included !== false).map((poi) => ({
      id: poi.id, name: poi.name, category: poi.category as PoiCategory, lat: poi.lat, lon: poi.lon,
    })) as Poi[];
    planResult.value = { routes: [selected.route as RouteResult], order: [], loop: selected.loop, optimize: false };
    activeRoute.value = selected.route as RouteResult;
    activeRouteLoop.value = selected.loop;
    activeRouteIdx.value = 0;
    suggestedPois.value = [];
    plannerOpen.value = false;
    showTripSummary.value = false;
    await nextTick();
    fitRoute(activeRoute.value);
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || 'Не удалось построить маршрут';
    toast.error('Не удалось построить маршрут');
  } finally {
    summaryLoading.value = false;
  }
}

function confirmTrip() {
  const r = summaryRoute.value;
  if (!r) return;
  destroySummaryMap();
  showTripSummary.value = false;
  selectedWaypoints.value = [];
  selectedPoi.value = null;
  const builtLoop = summaryLoop.value ?? false;
  planResult.value = { routes: [r], order: [], loop: builtLoop, optimize: false };
  activeRouteLoop.value = builtLoop;
  activeRouteIdx.value = 0;
  applyActiveRoute();
  nextTick(() => fitRoute(activeRoute.value));
  summaryRoute.value = null;
  summaryLoop.value = null;
  summaryPois.value = [];
}

function cancelTrip() {
  showTripSummary.value = false;
  destroySummaryMap();
  if (mapRef.value) mapRef.value.clearRoutePreview();
  summaryRoute.value = null;
  summaryLoop.value = null;
  summaryPois.value = [];
}

function clearRouteWorkspace() {
  activeRoute.value = null;
  planResult.value = null;
  selectedWaypoints.value = [];
  selectedPoi.value = null;
  summaryRoute.value = null;
  summaryLoop.value = null;
  summaryPois.value = [];
  suggestedPois.value = [];
  mapRef.value?.clearRoutePreview();
}

async function restartDraft() {
  const current = itinerary.draft.value;
  if (!current || itinerary.loading.value) return;
  if (current.publishedRouteId) {
    const next = await itinerary.create({
      start: current.start, finish: current.finish, profile: current.profile, loop: current.loop,
      intent: current.intent, stopPace: current.stopPace, budgetMode: current.budgetMode,
      ...(current.budgetMinutes == null ? {} : { budgetMinutes: current.budgetMinutes }),
      reserveMinutes: current.reserveMinutes, preset: current.preset,
    });
    if (!next) return;
    clearRouteWorkspace();
    routeMode.value = 'auto';
    railCollapsed.value = false;
    plannerOpen.value = true;
    plannerSuccess.value = 'Создан новый черновик. Можно собрать новый маршрут.';
    await nextTick(); plannerHeading.value?.focus();
    showItineraryMobile.value = false;
    mobileItineraryExpanded.value = false;
    return;
  }
  restartConfirmOpen.value = true;
}

async function confirmDiscardDraft() {
  if (!await itinerary.discard()) return;
  itinerary.cancelImpact();
  itinerary.clearAlternativePreview();
  restartConfirmOpen.value = false;
  clearRouteWorkspace();
  routeMode.value = 'auto';
  railCollapsed.value = false;
  plannerOpen.value = true;
  plannerSuccess.value = 'Можно собрать новый маршрут.';
  await nextTick(); plannerHeading.value?.focus();
  showItineraryMobile.value = false;
  mobileItineraryExpanded.value = false;
}

function initSummaryMap() {
  const el = summaryMapEl.value;
  const r = summaryRoute.value;
  if (!el || !r?.geojson?.geometry || summaryMap) return;

  summaryMap = new maplibregl.Map({
    container: el,
    style: buildStyle('light', { cycling: false, hiking: false, hillshade: false, contours: false }),
    center: [58.603, 58.004],
    zoom: 12,
    interactive: false,
    attributionControl: false,
  });

  summaryMap.on('load', () => {
    if (r.geojson.geometry) {
      summaryMap!.addSource('route', { type: 'geojson', data: r.geojson as any });
      summaryMap!.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#9b4500', 'line-width': 4, 'line-opacity': 0.85 },
      });
    }
    for (const poi of summaryPois.value) {
      const s = CATEGORY_STYLES[poi.category];
      if (!s) continue;
      const marker = document.createElement('div');
      marker.className = 'nv-poi-marker';
      marker.style.cssText = `display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${s.container};color:${s.color};box-shadow:0 1px 3px rgba(0,0,0,.25);font-size:14px;`;
      // Mount a Lucide-based <Icon /> into the marker (replaces the legacy
      // `<span class="ms ms-fill">…</span>` Material Symbols glyph).
      const vnode = h(Icon, { name: s.icon, filled: true });
      const mount = document.createElement('div');
      render(vnode, mount);
      marker.appendChild(mount.firstElementChild!);
      new maplibregl.Marker({ element: marker, anchor: 'center' })
        .setLngLat([poi.lon, poi.lat])
        .addTo(summaryMap!);
    }
    try {
      const bounds = new maplibregl.LngLatBounds();
      if (r.geojson.geometry?.type === 'LineString') {
        for (const coord of r.geojson.geometry.coordinates) bounds.extend(coord as [number, number]);
      }
      summaryMap!.fitBounds(bounds, { padding: 30 });
    } catch { /* empty */ }
  });
}

function destroySummaryMap() {
  if (summaryMap) {
    summaryMap.remove();
    summaryMap = null;
  }
}

const profileLabel = computed(() => ROUTING_PROFILE_LABELS[profile.value]);

const groupedSummaryPois = computed(() => {
  const groups: { key: PoiCategory; label: string; icon: string; pois: Poi[] }[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = summaryPois.value.filter((p) => p.category === cat);
    if (items.length) {
      groups.push({ key: cat, label: CATEGORY_STYLES[cat].label, icon: CATEGORY_STYLES[cat].icon, pois: items });
    }
  }
  return groups;
});


function difficultyOf(m: number) {
  return m < 10000 ? { label: 'Лёгкий', tone: 'tertiary' } : m < 30000 ? { label: 'Средний', tone: 'primary' } : { label: 'Сложный', tone: 'error' };
}

const healthRequestGate = createLatestRequestGate();
async function checkHealth() {
  const token = healthRequestGate.begin();
  ghReady.value = null;
  routingHealth.value = null;
  try {
    const health = await getRoutingHealth();
    if (!healthRequestGate.isCurrent(token)) return;
    routingHealth.value = health;
    ghReady.value = health.available;
    const replacement = preserveRoutingProfile(profile.value, health);
    if (replacement && replacement !== profile.value) profile.value = replacement;
  } catch {
    if (!healthRequestGate.isCurrent(token)) return;
    ghReady.value = false;
    routingHealth.value = { available: false, profiles: [] };
  }
}
function gotoAdmin() {
  router.push('/admin');
}

function dismissOnboarding() {
  showOnboarding.value = false;
  try {
    localStorage.setItem('nearventure-onboarding-seen', 'true');
  } catch { /* ignore */ }
}
function checkOnboarding() {
  try {
    if (!localStorage.getItem('nearventure-onboarding-seen')) showOnboarding.value = true;
  } catch { /* ignore */ }
}

const saving = ref(false);

/** Send legacy routes to the explicit draft/publish flow; never save on share. */
function openPublishFlow() {
  toast.info('Сначала сохраните маршрут', { description: 'Откройте планировщик, соберите маршрут и нажмите «Сохранить маршрут».' });
  if (!itinerary.draft.value) openPlanner('manual');
}

async function shareUrl(url: string, text: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Маршрут Nearventure', text, url });
      return;
    } catch { /* cancelled */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Ссылка скопирована', { description: 'Поделитесь маршрутом с друзьями' });
  } catch { /* ignore */ }
}

/** Share an already-published route via the Telegram deep link. */
async function shareToTelegram() {
  if (!activeRoute.value || saving.value) return;
  const id = publishedRouteId.value;
  if (!id) return openPublishFlow();
  window.open(`https://t.me/nearventure_bot?start=route_${id}`, '_blank', 'noopener,noreferrer');
}

/** Share an already-published summary route via the Telegram deep link. */
async function shareSummaryToTelegram() {
  if (!summaryRoute.value || saving.value) return;
  const id = publishedRouteId.value;
  if (!id) return openPublishFlow();
  window.open(`https://t.me/nearventure_bot?start=route_${id}`, '_blank', 'noopener,noreferrer');
}

async function shareCurrentRoute() {
  if (!activeRoute.value || saving.value) return;
  const id = publishedRouteId.value;
  if (!id) return openPublishFlow();
  const url = `${window.location.origin}/#/route/${id}`;
  await shareUrl(url, `Маршрут Nearventure: ${formatDistance(activeRoute.value.distance)} · ${formatDuration(activeRoute.value.duration)}`);
  router.push(`/route/${id}`);
}

async function shareRoute() {
  const r = summaryRoute.value;
  if (!r || saving.value) return;
  const id = publishedRouteId.value;
  if (!id) return openPublishFlow();
  const url = `${window.location.origin}/#/route/${id}`;
  await shareUrl(url, `Маршрут Nearventure: ${formatDistance(r.distance)} · ${formatDuration(r.duration)}`);
  router.push(`/route/${id}`);
}

async function downloadThenConfirm() {
  const r = summaryRoute.value;
  if (!r) return;
  downloadGpx(r);
  confirmTrip();
}

async function setDraftVisitMode(placeId: string, mode: VisitMode, custom?: number) { await itinerary.setVisitMode(placeId, mode, custom); }
function setDraftTopology(loop: boolean) {
  optLoop.value = loop;
  if (loop) clearFinish();
}
function pickDraftFinish() {
  optLoop.value = false;
  showItineraryMobile.value = false;
  pickFinishOnMap();
}
async function setDraftBudgetMode(mode: BudgetMode) {
  preflightBudgetMode.value = mode;
  const updated = await itinerary.command('update-settings', {
    budgetMode: mode,
    ...(mode === 'unlimited' ? {} : { budgetMinutes: timeMinutes.value }),
  });
  if (updated?.places.length) await itinerary.replan();
}
async function reorderDraft(ids: string[]) {
  const updated = await itinerary.reorder(ids);
  if (!updated) return;
  await itinerary.replan();
  const byPoi = new Map(selectedWaypoints.value.map(poi => [poi.id, poi]));
  selectedWaypoints.value = updated.places.map(place => byPoi.get(place.pois[0]?.id)).filter((poi): poi is Poi => !!poi);
}
async function removeDraftPlace(placeId: string) {
  const place = itinerary.draft.value?.places.find(node => node.id === placeId);
  if (!place || !await itinerary.removePlace(placeId)) return;
  await itinerary.replan();
  const ids = new Set(place.pois.map(poi => poi.id));
  selectedWaypoints.value = selectedWaypoints.value.filter(poi => !ids.has(poi.id));
}
async function publishDraft() {
  if (!itinerary.draft.value?.route || !itinerary.draft.value?.totals.feasible || itinerary.draft.value.publishedRouteId) return;
  const p = await itinerary.publish();
  if (p?.publishedRouteId) {
    toast.success('Маршрут сохранён', { description: 'Ссылка готова к публикации.' });
    router.push(`/route/${p.publishedRouteId}`);
  } else if (p === null && itinerary.error.value) {
    toast.error('Не удалось сохранить маршрут', { description: itinerary.error.value });
  }
}
function downloadDraftGpx() {
  const r = itinerary.draft.value?.route as RouteResult | undefined;
  if (r) downloadGpx(r);
}

// react to option changes
watch([optLoop, optOptimize, optAlternatives, profile], () => {
  // The persisted itinerary owns route geometry while it is active.
  if (!itinerary.draft.value) scheduleRebuild();
});
let draftSettingsTimer: ReturnType<typeof setTimeout> | undefined;
let applyingHydratedSettings = false;
watch([optLoop, profile, timeMinutes, finish], () => {
  const draft = itinerary.draft.value;
  if (!draft || applyingHydratedSettings) return;
  if (draftSettingsTimer) clearTimeout(draftSettingsTimer);
  draftSettingsTimer = setTimeout(async () => {
    const updated = await itinerary.command('update-settings', {
      loop: optLoop.value,
      finish: optLoop.value ? null : finish.value,
      profile: profile.value,
      budgetMode: draft.budgetMode,
      ...(draft.budgetMode === 'unlimited' ? {} : { budgetMinutes: timeMinutes.value }),
    });
    if (updated?.places.length) await itinerary.replan();
  }, 350);
});
watch(activeRoute, (r) => { if (!itinerary.draft.value) paintRoute(r); });
watch(() => itinerary.preview.value, (preview) => {
  if (!preview) { mapRef.value?.clearAlternativePreview(); return; }
  const geometry = preview.route.geojson.geometry;
  if (geometry?.type !== 'LineString') return;
  const stops = preview.places.flatMap((place: any, index: number) => place.pois.map((poi: any) => ({ id: `${place.id}:${poi.id}`, name: poi.name, lat: poi.lat, lon: poi.lon, index: index + 1 })));
  mapRef.value?.drawAlternativePreview(geometry.coordinates, stops as any);
});
watch(() => itinerary.draft.value?.id, () => itinerary.clearAlternativePreview());
watch(() => itinerary.draft.value?.version, () => itinerary.clearAlternativePreview());
watch(() => itinerary.draft.value?.route, (r) => {
  // Hydration and every draft command repaint the same map source; legacy
  // planResult/activeRoute cannot overwrite a persisted itinerary route.
  if (itinerary.draft.value) {
    paintRoute((r ?? null) as RouteResult | null);
    activeRoute.value = (r ?? null) as RouteResult | null;
    activeRouteLoop.value = itinerary.draft.value.loop;
  }
  // Keep TripSummary in sync: if the dialog is open and the draft route
  // changes (add/remove/replan/accept-suggestion), update summaryRoute so
  // GPX, share, and the summary map never show stale geometry.
  if (showTripSummary.value && r) {
    summaryRoute.value = r as RouteResult;
    summaryLoop.value = itinerary.draft.value?.loop ?? null;
    summaryPois.value = selectedWaypoints.value.slice();
    nextTick(() => initSummaryMap());
  }
}, { immediate: true });

watch(() => itinerary.draft.value?.intent, (intent) => {
  if (!intent) return;
  routeMode.value = intent === 'auto_budget' ? 'auto' : 'manual';
  plannerOpen.value = false;
}, { immediate: true });
watch([
  () => itinerary.draft.value?.version,
  () => selectedPoi.value?.id,
  () => discovery.value.map(({ poi }) => poi.id).join(','),
  routeMode,
  isMobile,
], scheduleImpactRefresh);

watch(pois, (list) => {
  const poiId = String(route.query.poi || '');
  const lat = parseFloat(String(route.query.lat || ''));
  const lng = parseFloat(String(route.query.lng || ''));

  // If we have explicit coordinates, fly there immediately
  // (passed from catalog's «Открыть на карте»).
  if (!isNaN(lat) && !isNaN(lng) && mapRef.value) {
    mapRef.value.panTo({ lat, lng });
    // Clear params so subsequent POI reloads don't re-fly.
    router.replace({ query: {} });
  }

  if (poiId && list.length) {
    const match = list.find((p) => p.id === poiId);
    if (match) nextTick(() => openDetail(match));
  }
});

function applyHydratedDraftSettings(draft: NonNullable<typeof itinerary.draft.value>) {
  applyingHydratedSettings = true;
  start.value = { lat: draft.start.lat, lon: draft.start.lon };
  startLabel.value = 'Старт маршрута';
  optLoop.value = draft.loop;
  finish.value = draft.finish ?? null;
  finishLabel.value = draft.finish ? 'Финиш маршрута' : '';
  draftPreset.value = draft.preset ?? 'balanced';
  preflightBudgetMode.value = draft.budgetMode;
  if (draft.totals.budgetMinutes != null) timeMinutes.value = draft.totals.budgetMinutes;
  selectedWaypoints.value = draft.places
    .flatMap((place) => place.pois)
    .filter((poi) => poi.included !== false)
    .map((poi) => ({
      id: poi.id,
      source: 'itinerary',
      externalId: poi.id,
      category: poi.category as PoiCategory,
      tags: null,
      lat: poi.lat,
      lon: poi.lon,
      name: poi.name,
      nameRu: poi.name,
      descRu: null,
      imageUrl: null,
      featured: false,
      popularityScore: 0,
      createdAt: '',
      updatedAt: '',
    } as Poi));
  if ((['bike', 'bike_touring', 'mtb', 'mtb_leisure', 'foot', 'foot_scenic', 'car'] as string[]).includes(draft.profile)) {
    profile.value = draft.profile as RoutingProfile;
  }
  nextTick(() => { applyingHydratedSettings = false; });
}

onMounted(async () => {
  const draftId = String(route.query.draft || '');
  if (draftId) {
    const hydrated = await itinerary.hydrate(draftId);
    if (hydrated) applyHydratedDraftSettings(hydrated);
  }
  checkHealth();
  checkOnboarding();
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onGlobalKeydown);
});

onBeforeUnmount(() => {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  if (draftSettingsTimer) clearTimeout(draftSettingsTimer);
  if (impactTimer) clearTimeout(impactTimer);
  destroySummaryMap();
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onGlobalKeydown);
});
</script>

<template>
  <div
    class="relative h-[100dvh] w-full overflow-hidden bg-background"
    :data-routing-state="ghReady === null ? 'loading' : ghReady ? 'ready' : 'error'"
  >
      <a href="#main-map" class="nv-skip">Перейти к карте</a>

      <!-- ═══ MAP (full screen; shrinks beside the desktop itinerary rail) ═══ -->
      <div class="absolute inset-y-0 left-0" :class="itinerary.draft.value && !isMobile && !railCollapsed ? 'right-[clamp(360px,30vw,400px)]' : 'right-0'">
      <AdventureMap
        id="main-map"
        ref="mapRef"
        :pois="pois"
        :active-categories="Array.from(activeCategories)"
        :selected-poi-id="selectedPoi?.id"
        :show-hillshade="showHillshade"
        :show-contours="showContours"
        :show-isochrone="showIsochrone"
        :start-point="startPointForMap"
        :finish-point="!optLoop ? finishPointForMap : null"
        :style-config="styleConfig"
        :route-active="!!itinerary.draft.value?.route"
        :route-stops="routeStopsForMap"
        mode="cycling"
        @poi-select="openDetail"
        @map-click="onMapClick"
        @map-view="onMapView"
        @update:start-point="onStartDrag"
        @update:finish-point="({ lat, lng }) => { finish = { lat, lon: lng }; finishLabel = 'Финиш на карте'; }"
      />
      </div>

      <p v-if="isochroneApproximate && showIsochrone" class="pointer-events-none absolute left-1/2 top-[max(4rem,env(safe-area-inset-top))] z-20 -translate-x-1/2 rounded-full border border-border/70 bg-card/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-card">
        Зона достижимости приблизительная
      </p>

      <OnboardingCarousel v-if="showOnboarding" @dismiss="dismissOnboarding" />

      <div v-if="itinerary.draft.value && !isMobile && !railCollapsed" class="absolute inset-y-0 right-0 z-40 w-[clamp(360px,30vw,400px)] border-l border-border shadow-float">
        <ItineraryRail :draft="itinerary.draft.value" :preferred-categories="Array.from(activeCategories)" :loading="itinerary.loading.value" :error="itinerary.error.value" :offline="itinerary.offline.value" :preview-alternative-id="itinerary.preview.value?.alternativeId ?? null" :enriched-suggestions="suggestedPois" @mode="setDraftVisitMode" @lock="(placeId, locked) => itinerary.setLocked(placeId, locked)" @remove="removeDraftPlace" @reorder="reorderDraft" @budget-mode="setDraftBudgetMode" @topology="setDraftTopology" @pick-finish="pickDraftFinish" @clear-finish="clearFinish" @undo="itinerary.undo" @apply-smart-fix="(id) => itinerary.applySmartFix(id)" @accept-addition="(id) => itinerary.acceptAddition(id)" @add-enriched="addSuggestedPoi" @replace-place="(id) => itinerary.replacePlace(id)" @accept-replacement="(id) => itinerary.acceptReplacement(id)" @select-alternative="(id) => itinerary.selectAlternative(id)" @preview-alternative="(id) => itinerary.showAlternativePreview(id)" @clear-preview="itinerary.clearAlternativePreview" @auto-fill="(cats, seed, preset) => itinerary.autoFill(cats, seed, preset)" @close="itinerary.clearAlternativePreview(); railCollapsed = true" @restart="restartDraft" @publish="publishDraft" @download-gpx="downloadDraftGpx" />
      </div>
      <div v-if="itinerary.draft.value && (isMobile || railCollapsed)" class="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex items-center gap-2">
        <Button v-if="isMobile" class="min-h-12 min-w-0 flex-1 justify-start rounded-full px-4 shadow-float" aria-label="Открыть план маршрута" @click="mobileItineraryExpanded = false; showItineraryMobile = true">
          <RouteIcon data-icon="inline-start" />
          <span class="truncate">Открыть план маршрута · {{ mobileRouteCapsuleLabel }}</span>
        </Button>
        <Button v-else class="min-h-12 min-w-0 flex-1 justify-start rounded-full px-4 shadow-float" aria-label="Развернуть панель маршрута" :aria-expanded="false" @click="railCollapsed = false">
          <RouteIcon data-icon="inline-start" />
          <span class="truncate">Развернуть панель маршрута · {{ mobileRouteCapsuleLabel }}</span>
        </Button>
        <Button as-child variant="outline" size="icon" class="min-h-12 min-w-12 rounded-full bg-card shadow-card" aria-label="Открыть каталог мест">
          <router-link to="/catalog"><MapPin /></router-link>
        </Button>
      </div>
      <Sheet v-model:open="showItineraryMobile" @update:open="(open: boolean) => { if (!open) itinerary.clearAlternativePreview(); }">
        <SheetContent side="bottom" class="gap-0 p-0" :class="mobileItineraryExpanded ? 'h-[92dvh]' : 'h-[45dvh]'">
          <SheetHeader class="flex-row items-center gap-3 border-b border-border px-4 py-3 text-left">
            <div class="min-w-0 flex-1">
              <SheetTitle>План путешествия</SheetTitle>
              <SheetDescription class="truncate">{{ mobileRouteCapsuleLabel }}</SheetDescription>
            </div>
            <Button variant="ghost" size="sm" class="min-h-11 shrink-0" :aria-expanded="mobileItineraryExpanded" @click="mobileItineraryExpanded = !mobileItineraryExpanded">
              {{ mobileItineraryExpanded ? 'Свернуть' : 'Развернуть' }}
              <ChevronDown v-if="mobileItineraryExpanded" data-icon="inline-end" />
              <ChevronUp v-else data-icon="inline-end" />
            </Button>
          </SheetHeader>
          <ItineraryRail v-if="itinerary.draft.value" compact-header :draft="itinerary.draft.value" :preferred-categories="Array.from(activeCategories)" :loading="itinerary.loading.value" :error="itinerary.error.value" :offline="itinerary.offline.value" :preview-alternative-id="itinerary.preview.value?.alternativeId ?? null" :enriched-suggestions="suggestedPois" @mode="setDraftVisitMode" @lock="(placeId, locked) => itinerary.setLocked(placeId, locked)" @remove="removeDraftPlace" @reorder="reorderDraft" @budget-mode="setDraftBudgetMode" @topology="setDraftTopology" @pick-finish="pickDraftFinish" @clear-finish="clearFinish" @undo="itinerary.undo" @apply-smart-fix="(id) => itinerary.applySmartFix(id)" @accept-addition="(id) => itinerary.acceptAddition(id)" @add-enriched="addSuggestedPoi" @replace-place="(id) => itinerary.replacePlace(id)" @accept-replacement="(id) => itinerary.acceptReplacement(id)" @select-alternative="(id) => itinerary.selectAlternative(id)" @preview-alternative="(id) => itinerary.showAlternativePreview(id)" @clear-preview="itinerary.clearAlternativePreview" @auto-fill="(cats, seed, preset) => itinerary.autoFill(cats, seed, preset)" @close="itinerary.clearAlternativePreview(); railCollapsed = true" @restart="restartDraft" @publish="publishDraft" @download-gpx="downloadDraftGpx" />
        </SheetContent>
      </Sheet>

      <!-- ═══ TOP HEADER ═══ -->
      <Motion
        v-if="showMapChrome"
        :initial="{ opacity: 0, y: -16 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5, ease: 'easeOut' }"
        class="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-3 px-4 py-3 [padding-top:max(1rem,env(safe-area-inset-top))] sm:px-4"
      >
        <!-- Brand -->
        <div
          class="pointer-events-auto flex items-center gap-3 rounded-full border border-border/50 bg-card/85 px-3 py-1.5 shadow-card backdrop-blur-xl"
        >
          <span class="grid size-8 place-items-center rounded-full bg-primary/12 text-primary">
            <Compass class="size-5" />
          </span>
          <span class="hidden font-display text-base font-extrabold tracking-tight text-foreground sm:inline">Nearventure</span>
        </div>

        <!-- Router status: only visible on loading or error (spec §5.1) -->
        <div
          v-if="ghReady !== true"
          class="flex items-center gap-2 rounded-full border border-border/50 bg-card/80 px-3 py-1 text-[0.7rem] font-semibold shadow-sm backdrop-blur-xl"
          :class="{ 'text-destructive': ghReady === false }"
          role="status"
          aria-live="polite"
        >
          <span class="size-1.5 animate-pulse rounded-full" :class="ghReady === null ? 'bg-muted-foreground' : 'bg-destructive'" aria-hidden="true" />
          <span>{{ ghReady === null ? 'Проверяем маршрутизатор…' : 'Маршрутизатор недоступен' }}</span>
          <button v-if="ghReady === false" type="button" class="underline underline-offset-2" @click="checkHealth">Повторить</button>
        </div>

        <!-- Actions -->
        <div class="pointer-events-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            class="rounded-full border-border/50 bg-card/85 shadow-card backdrop-blur-xl"
            :aria-label="isDark ? 'Светлая тема' : 'Тёмная тема'"
            @click="toggleTheme"
          >
            <Sun v-if="isDark" class="size-5" />
            <Moon v-else class="size-5" />
          </Button>
          <Button
            variant="outline"
            class="gap-2 rounded-full border-border/50 bg-card/85 px-3 shadow-surface backdrop-blur-xl"
            aria-label="Слои карты"
            @click="showLayerPanel = true"
          >
            <Layers class="size-5 text-primary" />
            <span class="hidden text-sm font-semibold sm:inline">Слои</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="rounded-full border-border/50 bg-card/85 shadow-card backdrop-blur-xl"
            :aria-label="showMapChrome ? 'Скрыть панели' : 'Показать панели'"
            @click="toggleMapChrome"
          >
            <Maximize2 v-if="showMapChrome" class="size-5" />
            <Minimize2 v-else class="size-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="rounded-full border-border/50 bg-card/85 shadow-card backdrop-blur-xl"
            aria-label="Профиль"
            @click="gotoAdmin"
          >
            <User class="size-5" />
          </Button>
        </div>
      </Motion>

      <!-- ═══ RIGHT FLOATING ACTIONS (desktop) — share only; location moved to workspace ═══ -->
      <Motion
        v-if="!isMobile && showMapChrome && canShareRoute"
        :initial="{ opacity: 0, x: 16 }"
        :animate="{ opacity: 1, x: 0 }"
        :transition="{ duration: 0.5, delay: 0.15, ease: 'easeOut' }"
        class="absolute bottom-44 right-4 z-20 flex flex-col gap-2"
      >
        <Button
          variant="outline"
          size="icon"
          class="rounded-full border-border/50 bg-card/85 shadow-card backdrop-blur-xl"
          aria-label="Поделиться маршрутом"
          :disabled="saving"
          @click="shareCurrentRoute"
        >
          <Share2 class="size-5 text-primary" />
        </Button>
      </Motion>

      <!-- ═══ BOTTOM ZONE: route bar + discovery drawer + action bar ═══ -->
      <div
        v-if="showMapChrome && (!itinerary.draft.value || (!isMobile && routeMode === 'manual'))"
        class="pointer-events-none absolute bottom-0 left-0 z-20 flex flex-col gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
        :class="itinerary.draft.value && !isMobile ? 'right-[clamp(360px,30vw,400px)]' : 'right-0'"
      >
        <!-- Selected waypoints strip -->
        <AnimatePresence>
          <Motion
            v-if="!plannerOpen && !itinerary.draft.value && hasWaypoints && start"
            :initial="{ opacity: 0, y: 20, scale: 0.98 }"
            :animate="{ opacity: 1, y: 0, scale: 1 }"
            :exit="{ opacity: 0, y: 20, scale: 0.98 }"
            :transition="{ duration: 0.3, ease: 'easeOut' }"
            class="pointer-events-auto mx-auto w-full max-w-2xl"
          >
            <div class="rounded-2xl border border-border/50 bg-card/90 p-2 shadow-card backdrop-blur-xl">
              <div class="flex items-center gap-2 overflow-x-auto pb-0.5 pl-4 pr-4 scroll-smooth scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style="scroll-padding-left: 1rem">
                <div class="flex shrink-0 items-center gap-1 pr-1 text-xs font-semibold text-muted-foreground">
                  <RouteIcon class="size-4 text-primary" /><span class="hidden sm:inline">Маршрут</span>
                </div>
                <div
                  v-for="(poi, idx) in selectedWaypoints"
                  :key="poi.id"
                  class="flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-1 pr-1"
                >
                  <button class="grid size-5 place-items-center rounded-full bg-primary text-[0.65rem] font-bold text-primary-foreground hover:opacity-80" :title="`Открыть карточку «${poiName(poi)}»`" @click="openDetail(poi)">
                    {{ stopNumber(poi) }}
                  </button>
                  <button class="max-w-[100px] truncate text-xs font-medium text-foreground hover:underline" :title="`Открыть карточку «${poiName(poi)}»`" @click="openDetail(poi)">
                    {{ poiName(poi) }}
                  </button>
                  <div class="flex flex-col gap-px">
                    <button v-if="idx > 0" type="button" class="text-muted-foreground hover:text-foreground leading-none" :title="`Переместить выше»`" @click="moveWaypointUp(idx)">
                      <ChevronUp class="size-3" />
                    </button>
                    <button v-if="idx < selectedWaypoints.length - 1" type="button" class="text-muted-foreground hover:text-foreground leading-none" :title="`Переместить ниже»`" @click="moveWaypointDown(idx)">
                      <ChevronDown class="size-3" />
                    </button>
                  </div>
                  <button type="button" class="text-muted-foreground transition hover:text-destructive" aria-label="Убрать точку" @click="removeWaypoint(poi.id)">
                    <X class="size-3.5" />
                  </button>
                </div>
                <button type="button" class="ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-destructive" @click="clearSelection">
                  <Trash2 class="size-3.5" />Сброс
                </button>
              </div>

              <div class="mt-1.5 flex flex-wrap items-center gap-1.5 px-0.5">
                <button
                  type="button"
                  class="flex flex-col items-start gap-0 rounded-lg border px-2 py-1 text-xs font-medium transition"
                  :class="optOptimize ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'"
                  @click="optOptimize = !optOptimize"
                >
                  <span class="inline-flex items-center gap-1 font-medium"><Sparkles class="size-3.5" />Оптимальный маршрут</span>
                  <span class="text-[0.55rem] leading-tight text-muted-foreground">Автовыбор порядка точек</span>
                </button>
                <button
                  type="button"
                  class="flex flex-col items-start gap-0 rounded-lg border px-2 py-1 text-xs font-medium transition"
                  :class="optLoop ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'"
                  @click="optLoop = !optLoop"
                >
                  <span class="inline-flex items-center gap-1 font-medium"><RefreshCw class="size-3.5" />Кольцевой маршрут</span>
                  <span class="text-[0.55rem] leading-tight text-muted-foreground">Возврат в точку старта</span>
                </button>
                <template v-if="(planResult?.routes?.length ?? 0) > 1">
                  <button
                    v-for="(r, i) in planResult!.routes"
                    :key="i"
                    type="button"
                    class="flex flex-col rounded-lg border px-2 py-0.5 text-left transition"
                    :class="i === activeRouteIdx ? 'border-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-accent'"
                    @click="selectVariant(i)"
                  >
                    <span class="text-[0.65rem] font-bold">Вариант {{ i + 1 }}</span>
                    <span class="text-[0.62rem]">{{ formatDistance(r.distance) }} · {{ formatDuration(r.duration) }}</span>
                  </button>
                </template>
                <span v-if="orderChanged && optOptimize" class="text-[0.65rem] font-medium text-emerald-600 dark:text-emerald-400">
                  Порядок оптимизирован
                </span>
              </div>
            </div>
          </Motion>
        </AnimatePresence>

        <!-- Discovery drawer (route summary + nearby POI cards) -->
        <Motion
          v-if="!plannerOpen && (routeCard || discovery.length || loadingPois)"
          :initial="{ opacity: 0, y: 24 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.4, ease: 'easeOut' }"
          class="pointer-events-auto"
        >
          <div class="mb-1.5 flex items-center gap-1.5 px-0.5">
            <Sparkles class="size-3.5 text-primary" />
            <span class="text-xs font-bold uppercase tracking-wide text-muted-foreground">{{ hasWaypoints ? 'По пути' : 'Ближайшие места' }}</span>
            <span v-if="discovery.length" class="text-[0.65rem] font-semibold text-muted-foreground">{{ discovery.length }}</span>
            <!-- FE-1: proper shadcn CTA into the catalog (was a blank white strip). -->
            <Button as-child variant="ghost" size="sm" class="ml-auto h-7 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              <router-link to="/catalog">Все объекты <ArrowUpRight class="size-3.5" /></router-link>
            </Button>
          </div>
          <div class="flex gap-2.5 overflow-x-auto px-4 pb-1 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style="scroll-padding-left: 1rem">
            <!-- Route summary card (near-opaque: content surfaces must be readable) -->
            <Card
              v-if="routeCard"
              class="relative w-[230px] shrink-0 overflow-hidden border-border/50 bg-card shadow-surface"
            >
              <span class="absolute inset-x-0 top-0 h-1 bg-primary" />
              <div class="p-3.5">
                <div class="flex items-center justify-between gap-2">
                  <CardTitle class="text-sm">
                    <button type="button" class="rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="fitRoute(activeRoute)">
                      {{ hasWaypoints ? 'Маршрут' : 'Приключение' }}
                    </button>
                  </CardTitle>
                  <Badge variant="soft" class="text-[0.62rem]">{{ routeCard.duration }}</Badge>
                </div>
                <div class="mt-2 flex items-center gap-3 text-sm font-semibold text-foreground">
                  <span class="inline-flex items-center gap-1"><RouteIcon class="size-4 text-primary" />{{ routeCard.distance }}</span>
                  <span v-if="routeCard.ascend" class="inline-flex items-center gap-1 text-muted-foreground"><TrendingUp class="size-4" />{{ routeCard.ascend }} м</span>
                </div>
                <RouteEvidence :quality="activeRoute?.quality ?? itinerary.draft.value?.quality" :road-facts="activeRoute?.roadFacts" :ascend="activeRoute?.ascend" :descend="activeRoute?.descend" />
                <Separator class="my-2.5" />
                <div class="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" class="h-8 gap-1 px-2 text-xs text-secondary" @click.stop="downloadGpx(activeRoute!)">
                    <Download class="size-3.5" />GPX
                  </Button>
                  <template v-if="canShareRoute">
                    <Button size="sm" variant="ghost" class="h-8 gap-1 px-2 text-xs text-secondary" :disabled="saving" @click.stop="shareCurrentRoute">
                      <Share2 class="size-3.5" />Поделиться
                    </Button>
                    <Button size="sm" variant="ghost" class="h-8 gap-1 px-2 text-xs text-secondary" :disabled="saving" @click.stop="shareToTelegram">
                      <Send class="size-3.5" />Telegram
                    </Button>
                  </template>
                  <Button v-else size="sm" variant="ghost" class="h-8 gap-1 px-2 text-xs text-secondary" @click.stop="openPublishFlow">
                    <Save class="size-3.5" />Сохранить маршрут
                  </Button>
                </div>
              </div>
            </Card>

            <!-- Skeletons while loading -->
            <template v-if="loadingPois && !pois.length">
              <Skeleton v-for="n in 3" :key="n" class="h-[112px] w-[190px] shrink-0 rounded-2xl" />
            </template>

            <!-- Nearby POI cards -->
            <AnimatePresence>
              <Motion
                v-for="(item, i) in discovery"
                :key="item.poi.id"
                :initial="{ opacity: 0, y: 14 }"
                :animate="{ opacity: 1, y: 0 }"
                :exit="{ opacity: 0, y: 14 }"
                :transition="{ duration: 0.32, delay: Math.min(i * 0.04, 0.3), ease: 'easeOut' }"
              >
                <button
                  type="button"
                  class="relative w-[190px] shrink-0 cursor-pointer overflow-hidden rounded-xl border border-border/50 bg-card text-left text-card-foreground shadow-surface transition-transform duration-150 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  :aria-label="`Открыть: ${poiName(item.poi)}`"
                  @click="openDetail(item.poi)"
                >
                  <span class="absolute inset-x-0 top-0 h-1 z-10" :style="{ background: CATEGORY_STYLES[item.poi.category].color }" />
                  <div class="relative h-[64px] w-full overflow-hidden bg-muted">
                    <img
                      v-if="item.poi.imageUrl"
                      :src="poiMediaUrlById(String(item.poi.id))"
                      :alt="poiName(item.poi)"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      class="size-full object-cover"
                    />
                    <div v-else class="grid size-full place-items-center" :style="{ background: CATEGORY_STYLES[item.poi.category].container }">
                      <component :is="poiLucideIcon(item.poi)" :stroke-width="1.75" class="size-7" :style="{ color: CATEGORY_STYLES[item.poi.category].color }" />
                    </div>
                  </div>
                  <div class="p-2.5">
                    <div class="flex items-start justify-between gap-1.5">
                      <h4 class="line-clamp-1 text-sm font-bold text-foreground">{{ poiName(item.poi) }}</h4>
                      <Badge variant="secondary" class="shrink-0 text-[0.6rem]">{{ formatDistance(item.d) }}</Badge>
                    </div>
                    <div class="mt-0.5 flex items-center justify-between gap-2">
                      <p class="line-clamp-1 text-[0.7rem] text-muted-foreground">{{ CATEGORY_STYLES[item.poi.category].labelLong }}</p>
                      <span v-if="impactEstimate(item.poi.id)" class="shrink-0 text-[0.65rem] font-bold text-primary">
                        ≈ {{ (impactEstimate(item.poi.id)?.delta.totalMinutes ?? 0) > 0 ? '+' : '' }}{{ Math.round(impactEstimate(item.poi.id)?.delta.totalMinutes ?? 0) }} мин
                      </span>
                    </div>
                  </div>
                </button>
              </Motion>
            </AnimatePresence>
          </div>
        </Motion>

        <!-- Empty state -->
        <Motion
          v-if="!plannerOpen && !pois.length && !loadingPois"
          :initial="{ opacity: 0, y: 16 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.4 }"
          class="pointer-events-auto"
        >
          <div class="flex w-[230px] shrink-0 items-center gap-2 rounded-card border border-dashed border-border bg-card p-3 shadow-surface">
            <component :is="EMPTY_STATE_ICON[emptyStateAction.icon] || Compass" class="size-6 shrink-0 text-muted-foreground" />
            <p class="flex-1 text-xs font-medium text-muted-foreground">{{ emptyStateAction.text }}</p>
            <Button size="sm" variant="ghost" class="h-8 px-2" @click="emptyStateAction.action">ОК</Button>
          </div>
        </Motion>

        <!-- Both route modes enter the same explicit conditions preflight. -->
        <Motion
          v-if="!plannerOpen && !itinerary.draft.value"
          :initial="{ opacity: 0, y: 16 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.24, ease: 'easeOut' }"
          class="pointer-events-auto mx-auto grid w-full max-w-[400px] grid-cols-[1fr_auto] gap-2"
        >
          <Button class="min-h-12 min-w-0 justify-between rounded-full px-4 shadow-float" @click="openPlanner('auto')">
            <span class="inline-flex min-w-0 items-center gap-2"><Sparkles data-icon="inline-start" /><span class="truncate font-bold">Подобрать маршрут</span></span>
            <span class="shrink-0 text-xs font-medium text-primary-foreground/80">{{ timeLabel }}</span>
          </Button>
          <Button variant="outline" class="min-h-12 rounded-full bg-card px-4 shadow-card" @click="openPlanner('manual')"><MapPin data-icon="inline-start" />Места</Button>
        </Motion>

        <!-- ═══ ROUTE WORKSPACE — context-replacing auto composer ═══ -->
        <Motion
          v-if="plannerOpen && (!itinerary.draft.value || (!itinerary.draft.value.route && !itinerary.draft.value.places.length))"
          :initial="{ opacity: 0, y: 28 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.32, delay: 0.12, ease: 'easeOut' }"
          class="pointer-events-auto"
        >
          <section>
          <h2 ref="plannerHeading" tabindex="-1" class="sr-only">Планировщик маршрута</h2>
          <p v-if="plannerSuccess" role="status" class="sr-only">{{ plannerSuccess }}</p>
          <RouteWorkspace
            :route-mode="routeMode"
            :profile="profile"
            :locating="locating"
            :start-label="start ? startLabel : undefined"
            :finish-label="finishLabel || undefined"
            :picking-finish="mapPickTarget === 'finish'"
            :time-minutes="timeMinutes"
            :time-label="timeLabel"
            :distance-hint="distanceHint"
            :budget-mode="preflightBudgetMode"
            :loop="optLoop"
            :preset="draftPreset"
            :active-categories="Array.from(activeCategories)"
            :route-scope-label="routeScopeLabel"
            :hidden-category-count="hiddenCategoryCount"
            :selected-waypoint-count="selectedWaypoints.length"
            :can-adventure="canAdventure"
            :routing-status="ghReady === null ? 'checking' : ghReady ? 'ready' : 'unavailable'"
            :available-profiles="availableProfiles"
            :loading="loading"
            :summary-loading="summaryLoading"
            @locate="useMyLocation"
            @profile="onProfileChange"
            @retry-routing="checkHealth"
            @route-mode="setRouteMode"
            @toggle-category="toggleCategory"
            @pick-finish="pickFinishOnMap"
            @clear-finish="clearFinish"
            @update:time-minutes="timeMinutes = $event"
            @update:budget-mode="preflightBudgetMode = $event"
            @update:loop="setDraftTopology"
            @update:preset="draftPreset = $event"
            @build="prepareTrip"
            @close="plannerOpen = false"
          />
          </section>
        </Motion>

        <p v-if="displayError" class="pointer-events-auto mx-auto max-w-2xl rounded-xl bg-destructive/10 px-3 py-1.5 text-center text-xs font-medium text-destructive">
          {{ displayError }}
        </p>
      </div>

      <!-- ═══ LAYERS PANEL (Sheet) ═══ -->
      <Sheet v-model:open="showLayerPanel">
        <SheetContent :side="layersSide" class="w-full gap-0 p-0 sm:max-w-xs">
          <SheetHeader class="border-b border-border px-5 py-4">
            <SheetTitle>Слои карты</SheetTitle>
            <SheetDescription>Внешний вид карты и технические оверлеи</SheetDescription>
          </SheetHeader>

          <div class="flex-1 overflow-y-auto p-5">
            <p class="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Оформление</p>
            <div class="flex flex-col gap-1">
              <button type="button" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-accent" @click="styleConfig = { ...styleConfig, base: 'light' }; setTheme('light')">
                <Sun class="size-5 text-primary" /><span class="flex-1 font-medium">Светлая карта</span>
                <CheckIcon v-if="styleConfig.base === 'light'" class="size-5 text-primary" />
              </button>
              <button type="button" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-accent" @click="styleConfig = { ...styleConfig, base: 'dark' }; setTheme('dark')">
                <Moon class="size-5 text-primary" /><span class="flex-1 font-medium">Тёмная карта</span>
                <CheckIcon v-if="styleConfig.base === 'dark'" class="size-5 text-primary" />
              </button>
              <button type="button" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-accent" @click="styleConfig = { ...styleConfig, overlays: { ...styleConfig.overlays, hillshade: !styleConfig.overlays.hillshade } }">
                <Mountain class="size-5 text-primary" /><span class="flex-1 font-medium">Затенение рельефа</span>
                <CheckIcon v-if="styleConfig.overlays.hillshade" class="size-5 text-primary" />
              </button>
              <button type="button" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-accent" @click="styleConfig = { ...styleConfig, overlays: { ...styleConfig.overlays, contours: !styleConfig.overlays.contours } }">
                <TrendingUp class="size-5 text-primary" /><span class="flex-1 font-medium">Контуры высот</span>
                <CheckIcon v-if="styleConfig.overlays.contours" class="size-5 text-primary" />
              </button>
              <!-- FE-3: independent isochrone (reachable-area) visibility toggle. -->
              <button type="button" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-accent" @click="showIsochrone = !showIsochrone">
                <Radar class="size-5 text-primary" /><span class="flex-1 font-medium">Зона доступности</span>
                <CheckIcon v-if="showIsochrone" class="size-5 text-primary" />
              </button>
            </div>

            <Separator class="my-4" />

            <p class="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Категории в маршрут</p>
            <p class="mb-2 text-[0.7rem] leading-snug text-muted-foreground">Отметьте интересы для авто-подбора. Эти же категории видны на карте и в нижней панели.</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="cat in CATEGORY_ORDER"
                :key="cat"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-chip border px-3 py-1.5 text-sm font-medium transition"
                :class="isCatOn(cat) ? 'border-transparent text-white' : 'border-border text-muted-foreground hover:bg-accent'"
                :style="isCatOn(cat) ? { background: CATEGORY_STYLES[cat].color } : {}"
                @click="toggleCategory(cat)"
              >
                <component :is="CATEGORY_ICON[cat]" class="size-4" />{{ CATEGORY_STYLES[cat].label }}
              </button>
            </div>
            <!-- FE: clarify that category visibility also scopes the auto-route. -->
            <p class="mt-3 flex items-start gap-1.5 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-[0.7rem] leading-snug text-muted-foreground">
              <Sparkles class="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>Скрытые категории исключаются из авто-маршрута. Отметьте те, по которым должно строиться путешествие.</span>
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <!-- ═══ POI DETAIL (Sheet) ═══ -->
      <Sheet :open="!!selectedPoi" @update:open="(v: boolean) => !v && closeDetail()">
        <SheetContent :side="detailSide" class="gap-0 p-0 sm:max-w-md">
          <template v-if="selectedPoi">
            <!-- `:key` forces a clean remount on POI switch so the motion-v
                 entrance choreography replays for every newly-opened card. -->
            <div :key="selectedPoi.id" class="flex h-full flex-col">
              <!-- Hero image (scale-in on open) -->
              <Motion
                :initial="{ opacity: 0, scale: 1.08 }"
                :animate="{ opacity: 1, scale: 1 }"
                :transition="{ duration: 0.45, ease: 'easeOut' }"
                class="relative h-36 w-full shrink-0 overflow-hidden bg-muted sm:h-52"
              >
                <img
                  v-if="selectedPoi.imageUrl"
                  :src="poiMediaUrlById(String(selectedPoi.id))"
                  :alt="poiName(selectedPoi)"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  class="size-full object-cover"
                />
                <div v-else class="grid size-full place-items-center" :style="{ background: CATEGORY_STYLES[selectedPoi.category].container }">
                  <component
                    :is="poiLucideIcon(selectedPoi)"
                    :stroke-width="1.5"
                    class="size-12"
                    :style="{ color: CATEGORY_STYLES[selectedPoi.category].color }"
                  />
                </div>
                <div class="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
                <Motion
                  :initial="{ opacity: 0, y: -8 }"
                  :animate="{ opacity: 1, y: 0 }"
                  :transition="{ duration: 0.4, delay: 0.12, ease: 'easeOut' }"
                >
                  <Badge
                    class="absolute left-4 top-4 gap-1.5 border-transparent text-white shadow-card"
                    :style="{ background: CATEGORY_STYLES[selectedPoi.category].color }"
                  >
                    <component :is="poiLucideIcon(selectedPoi)" class="size-3.5" />
                    {{ CATEGORY_STYLES[selectedPoi.category].label }}
                  </Badge>
                </Motion>
              </Motion>

              <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-4 sm:pt-5">
                <!-- Title -->
                <Motion :initial="{ opacity: 0, y: 10 }" :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.4, delay: 0.16, ease: 'easeOut' }">
                  <SheetHeader class="space-y-1 p-0 text-left">
                    <SheetTitle class="text-xl font-extrabold leading-tight tracking-tight">{{ poiName(selectedPoi) }}</SheetTitle>
                    <SheetDescription class="flex items-center gap-1.5">
                      <component :is="poiLucideIcon(selectedPoi)" class="size-3.5" />
                      {{ CATEGORY_STYLES[selectedPoi.category].labelLong }}
                    </SheetDescription>
                  </SheetHeader>
                </Motion>

                <!-- Description -->
                <Motion :initial="{ opacity: 0, y: 10 }" :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.4, delay: 0.22, ease: 'easeOut' }">
                  <p v-if="selectedPoi.descRu" class="mt-4 text-sm leading-relaxed text-foreground/90">{{ selectedPoi.descRu }}</p>
                  <p v-else class="mt-4 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2.5 text-center text-xs italic text-muted-foreground">Описание появится позже — данные дополняются сообществом.</p>
                </Motion>

                <!-- Meta tags: heritage (ОКН) + source attribution -->
                <Motion :initial="{ opacity: 0, y: 10 }" :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.4, delay: 0.28, ease: 'easeOut' }">
                  <div v-if="selectedPoi.heritageSignificance || selectedPoi.is_protected || poiAttribution(selectedPoi)" class="mt-4 flex flex-wrap gap-1.5">
                    <Badge v-if="selectedPoi.heritageSignificance || selectedPoi.is_protected" variant="soft" class="gap-1">
                      <Landmark class="size-3" />ОКН<template v-if="HERITAGE_LABELS[selectedPoi.heritageSignificance!]"> · {{ HERITAGE_LABELS[selectedPoi.heritageSignificance!] }}</template>
                    </Badge>
                    <Badge v-for="(attr, key) in poiAttribution(selectedPoi)" :key="key" variant="outline" class="gap-1 font-normal">
                      <a v-if="attr.url" :href="attr.url" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1">{{ SOURCE_LABELS[key] || key }}<ArrowUpRight class="size-3 text-muted-foreground" /></a>
                      <template v-else>{{ SOURCE_LABELS[key] || key }}</template>
                    </Badge>
                  </div>
                </Motion>

                <!-- External links (site / community / article / wikidata) -->
                <Motion :initial="{ opacity: 0, y: 10 }" :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.4, delay: 0.34, ease: 'easeOut' }">
                  <div v-if="poiHasExternalLinks(selectedPoi)" class="mt-4 grid grid-cols-2 gap-2">
                    <a v-if="selectedPoi.officialUrl" :href="selectedPoi.officialUrl" target="_blank" rel="noopener noreferrer" class="group flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-accent hover:shadow-soft">
                      <Globe class="size-4 shrink-0 text-primary" /><span class="flex-1">Сайт</span><ArrowUpRight class="size-3.5 text-muted-foreground transition group-hover:text-foreground" />
                    </a>
                    <a v-if="selectedPoi.socialUrl" :href="selectedPoi.socialUrl" target="_blank" rel="noopener noreferrer" class="group flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-accent hover:shadow-soft">
                      <span v-if="isVkUrl(selectedPoi.socialUrl)" class="grid size-4 shrink-0 place-items-center rounded bg-[#0077FF] text-[0.5rem] font-bold text-white">VK</span>
                      <Link2 v-else class="size-4 shrink-0 text-primary" /><span class="flex-1">Сообщество</span><ArrowUpRight class="size-3.5 text-muted-foreground transition group-hover:text-foreground" />
                    </a>
                    <a v-if="selectedPoi.articleUrl" :href="selectedPoi.articleUrl" target="_blank" rel="noopener noreferrer" class="group flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-accent hover:shadow-soft">
                      <BookOpen class="size-4 shrink-0 text-primary" /><span class="flex-1">Подробнее</span><ArrowUpRight class="size-3.5 text-muted-foreground transition group-hover:text-foreground" />
                    </a>
                    <a v-if="selectedPoi.wikidataQid" :href="`https://www.wikidata.org/wiki/${selectedPoi.wikidataQid}`" target="_blank" rel="noopener noreferrer" class="group flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-accent hover:shadow-soft">
                      <BadgeCheck class="size-4 shrink-0 text-primary" /><span class="flex-1">Wikidata</span><ArrowUpRight class="size-3.5 text-muted-foreground transition group-hover:text-foreground" />
                    </a>
                  </div>
                </Motion>

                <!-- Explicit image credits and separately-labelled legacy source context. -->
                <div v-if="selectedPoi.imageUrl && (selectedPoi.imageAttribution || selectedPoi.imageSourceNotice)" class="mt-3 text-[0.65rem] leading-snug text-muted-foreground">
                  <template v-if="selectedPoi.imageAttribution">
                    <p v-if="selectedPoi.imageAttribution.artist || selectedPoi.imageAttribution.credit">
                      Фото: {{ selectedPoi.imageAttribution.artist || selectedPoi.imageAttribution.credit }}
                    </p>
                    <p v-else-if="selectedPoi.imageAttribution.source">
                      Источник изображения: {{ selectedPoi.imageAttribution.source }}
                    </p>
                    <p v-if="selectedPoi.imageAttribution.license">
                      Лицензия:
                      <a v-if="selectedPoi.imageAttribution.licenseUrl" :href="selectedPoi.imageAttribution.licenseUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ selectedPoi.imageAttribution.license }}</a>
                      <span v-else>{{ selectedPoi.imageAttribution.license }}</span>
                    </p>
                    <p v-if="selectedPoi.imageAttribution.notice">{{ selectedPoi.imageAttribution.notice }}</p>
                  </template>
                  <template v-if="selectedPoi.imageSourceNotice">
                    <p v-if="selectedPoi.imageSourceNotice.source">Источник изображения: {{ selectedPoi.imageSourceNotice.source }}</p>
                    <p v-if="selectedPoi.imageSourceNotice.notice">Сведения об источнике: {{ selectedPoi.imageSourceNotice.notice }}</p>
                  </template>
                </div>

                <section class="mt-4 rounded-xl border border-border bg-secondary/35 p-3" aria-live="polite" aria-label="Влияние точки на маршрут">
                  <div class="flex items-start gap-3">
                    <Loader2 v-if="itinerary.impactLoading.value" class="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                    <Clock v-else class="mt-0.5 size-4 shrink-0 text-primary" />
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-bold">{{ itinerary.draft.value?.route ? 'Оценка до добавления' : 'Влияние на маршрут' }}</p>
                      <p v-if="itinerary.impactLoading.value" class="mt-1 text-xs text-muted-foreground">Считаем дорогу и время на месте…</p>
                      <template v-else-if="selectedPoiImpact?.estimate">
                        <p class="mt-1 text-sm font-semibold">
                          ≈ +{{ Math.ceil(selectedPoiImpact.estimate.detourMinutes) }} мин в пути · ≈ {{ Math.ceil(selectedPoiImpact.estimate.dwellMinutes) }} мин на месте
                        </p>
                        <p class="mt-1 text-xs" :class="selectedPoiImpact.estimate.previewTotals.feasible ? 'text-primary' : 'text-destructive'">
                          {{ selectedPoiImpact.estimate.previewTotals.feasible ? `Останется ${Math.round(selectedPoiImpact.estimate.previewTotals.remainingMinutes ?? 0)} мин` : `Превышение на ${Math.round(selectedPoiImpact.estimate.previewTotals.overBudgetMinutes)} мин` }}
                        </p>
                        <p class="mt-1 text-[0.65rem] text-muted-foreground">Предварительно. После добавления маршрут перестроится и покажет точное время.</p>
                      </template>
                      <p v-else class="mt-1 text-xs text-muted-foreground">
                        {{ itinerary.draft.value?.route ? 'Не удалось оценить заранее. Точку всё равно можно добавить.' : 'После первой построенной точки здесь появится оценка дороги и остановки.' }}
                      </p>
                    </div>
                  </div>
                </section>
              </div>

              <!-- Sticky actions: a destination is a fast path, while adding keeps the user in the POI shop. -->
              <SheetFooter class="shrink-0 border-t border-border p-3 sm:p-4">
                <Motion :initial="{ opacity: 0, y: 14 }" :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.4, delay: 0.4, ease: 'easeOut' }" class="flex w-full flex-col gap-2">
                  <div class="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      class="min-h-11 gap-2"
                      :disabled="!start || loading"
                      @click="goToDestination(selectedPoi!)"
                    >
                      <Navigation data-icon="inline-start" />Поехать сюда
                    </Button>
                    <Button
                      v-if="!selectedWaypoints.some((w) => w.id === selectedPoi!.id)"
                      class="min-h-11 gap-2"
                      :disabled="!start || loading"
                      @click="addToRoute(selectedPoi!)"
                    >
                      <Plus data-icon="inline-start" />В маршрут
                    </Button>
                    <Button v-else variant="secondary" class="min-h-11 gap-2" @click="removeWaypoint(selectedPoi!.id)">
                      <Check data-icon="inline-start" />Убрать
                    </Button>
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <Button variant="ghost" size="sm" class="min-h-11 gap-1.5 text-muted-foreground" @click="startFromHere(selectedPoi!)">
                      <MapPin data-icon="inline-start" />Начать отсюда
                    </Button>
                    <Button variant="ghost" size="sm" class="min-h-11 gap-1.5 text-muted-foreground" @click="lookNearby(selectedPoi!)">
                      <Radar data-icon="inline-start" />Посмотреть рядом
                    </Button>
                  </div>
                </Motion>
              </SheetFooter>
            </div>
          </template>
        </SheetContent>
      </Sheet>

      <Dialog v-model:open="restartConfirmOpen">
        <DialogContent role="alertdialog" class="max-w-md">
          <DialogHeader>
            <DialogTitle>Начать новый маршрут?</DialogTitle>
            <DialogDescription>Текущий черновик и несохранённые изменения будут удалены. Сохранённые маршруты не затронуты.</DialogDescription>
          </DialogHeader>
          <p v-if="itinerary.loading.value" role="status" class="text-sm text-muted-foreground">Удаляем черновик…</p>
          <div class="flex justify-end gap-2">
            <Button variant="outline" :disabled="itinerary.loading.value" @click="restartConfirmOpen = false">Отмена</Button>
            <Button variant="destructive" :disabled="itinerary.loading.value" @click="confirmDiscardDraft">Удалить черновик и начать</Button>
          </div>
        </DialogContent>
      </Dialog>

      <!-- ═══ TRIP SUMMARY (Dialog) ═══ -->
      <Dialog :open="showTripSummary && !!summaryRoute" @update:open="(v: boolean) => !v && cancelTrip()">
        <DialogContent class="flex max-h-[100dvh] w-[100dvw] max-w-none flex-col gap-0 overflow-hidden rounded-t-2xl border-0 p-0 sm:max-h-[92dvh] sm:max-w-lg sm:rounded-2xl sm:border" hide-close>
          <template v-if="summaryRoute">
            <DialogHeader class="flex-row items-center justify-between gap-2 border-b border-border px-5 py-4 space-y-0">
              <div>
                <DialogTitle class="text-xl">Ваше путешествие</DialogTitle>
                <DialogDescription class="flex items-center gap-1.5">
                  <span class="inline-flex items-center gap-1"><Bike v-if="profile.startsWith('bike') || profile.startsWith('mtb')" class="size-3.5" /><Footprints v-else-if="profile.startsWith('foot')" class="size-3.5" /><Car v-else class="size-3.5" />{{ profileLabel }}</span>
                </DialogDescription>
              </div>
              <Button variant="ghost" size="icon" class="rounded-full" aria-label="Закрыть" @click="cancelTrip"><X class="size-5" /></Button>
            </DialogHeader>

            <div class="flex-1 overflow-y-auto overscroll-contain">
              <!-- Mini map -->
              <div ref="summaryMapEl" class="h-44 w-full bg-muted" />

              <!-- Stats -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
                <div class="flex flex-col items-center gap-0.5 bg-card px-2 py-3">
                  <RouteIcon class="size-4 text-primary" />
                  <span class="text-base font-extrabold text-foreground">{{ formatDistance(summaryRoute.distance) }}</span>
                  <span class="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">Дистанция</span>
                </div>
                <div class="flex flex-col items-center gap-0.5 bg-card px-2 py-3">
                  <Clock class="size-4 text-secondary" />
                  <span class="text-base font-extrabold text-foreground">{{ formatDuration(summaryRoute.duration) }}</span>
                  <span class="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">Время</span>
                </div>
                <div class="flex flex-col items-center gap-0.5 bg-card px-2 py-3">
                  <TrendingUp class="size-4 text-emerald-600 dark:text-emerald-400" />
                  <span class="text-base font-extrabold text-foreground">{{ summaryRoute.ascend ? Math.round(summaryRoute.ascend) + ' м' : '—' }}</span>
                  <span class="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">Набор высоты</span>
                </div>
                <div class="flex flex-col items-center gap-0.5 bg-card px-2 py-3">
                  <TrendingDown class="size-4 text-orange-600 dark:text-orange-400" />
                  <span class="text-base font-extrabold text-foreground">{{ summaryRoute.descend ? Math.round(summaryRoute.descend) + ' м' : '—' }}</span>
                  <span class="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">Спуск</span>
                </div>
              </div>

              <div class="flex items-center gap-2 px-5 py-2.5 text-sm">
                <Badge :variant="difficultyOf(summaryRoute.distance).tone === 'error' ? 'destructive' : 'soft'" class="gap-1">
                  <SlidersHorizontal class="size-3" />{{ difficultyOf(summaryRoute.distance).label }}
                </Badge>
                <span v-if="summaryPois.length" class="text-xs text-muted-foreground">{{ summaryPois.length }} точек по пути</span>
              </div>
              <div class="px-5 pb-2"><RouteEvidence :quality="summaryRoute.quality ?? itinerary.draft.value?.quality" :road-facts="summaryRoute.roadFacts" :ascend="summaryRoute.ascend" :descend="summaryRoute.descend" /></div>

              <!-- POIs by category -->
              <div v-if="groupedSummaryPois.length" class="flex flex-col gap-3 px-5 pb-3">
                <div v-for="group in groupedSummaryPois" :key="group.key">
                  <div class="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-foreground">
                    <component :is="CATEGORY_ICON[group.key]" class="size-4" :style="{ color: CATEGORY_STYLES[group.key]?.color }" />
                    {{ group.label }}
                    <Badge variant="secondary" class="ml-auto text-[0.6rem]">{{ group.pois.length }}</Badge>
                  </div>
                  <DragRail>
                    <button
                      v-for="p in group.pois.slice(0, 12)"
                      :key="p.id"
                      type="button"
                      class="w-[170px] shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card text-left transition hover:-translate-y-0.5 hover:shadow-card"
                      @click="openDetail(p)"
                    >
                      <div class="h-20 w-full overflow-hidden bg-muted">
                        <img v-if="p.imageUrl" :src="poiMediaUrlById(String(p.id))" :alt="poiName(p)" loading="lazy" referrerpolicy="no-referrer" class="size-full object-cover" />
                        <div v-else class="grid size-full place-items-center" :style="{ background: CATEGORY_STYLES[p.category]?.container }">
                          <component :is="poiLucideIcon(p)" :stroke-width="1.75" class="size-8" :style="{ color: CATEGORY_STYLES[p.category]?.color }" />
                        </div>
                      </div>
                      <p class="line-clamp-2 px-2 py-1.5 text-xs font-semibold text-foreground">{{ poiName(p) }}</p>
                    </button>
                  </DragRail>
                </div>
              </div>
              <p v-else class="px-5 pb-4 text-center text-sm text-muted-foreground">В выбранных слоях нет точек поблизости. Включите больше категорий или увеличьте время.</p>

              <!-- Suggested POIs (enrichment) -->
              <div v-if="suggestedPois.length" class="border-t border-border px-5 py-3">
                <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Рядом с маршрутом</p>
                <DragRail>
                  <button
                    v-for="sp in suggestedPois"
                    :key="sp.id"
                    type="button"
                    class="flex w-[160px] shrink-0 items-center gap-2 rounded-xl border border-border/60 bg-card p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-card"
                    @click="addSuggestedPoi(sp)"
                  >
                    <component :is="CATEGORY_ICON[sp.category as PoiCategory] || MapPin" class="size-4 shrink-0" :style="{ color: CATEGORY_STYLES[sp.category as PoiCategory]?.color }" />
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-semibold text-foreground">{{ sp.name }}</p>
                      <p class="text-xs text-muted-foreground">+{{ sp.detourMinutes }} мин объезд</p>
                    </div>
                    <Plus class="size-4 shrink-0 text-primary" />
                  </button>
                </DragRail>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex flex-col gap-2 border-t border-border bg-card p-4 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.1)]">
              <Button size="lg" class="w-full gap-2" @click="downloadThenConfirm">
                <Download class="size-5" />Скачать маршрут (GPX)
              </Button>
              <div class="flex gap-2">
                <template v-if="canShareSummary">
                  <Button variant="secondary" class="flex-1 gap-2" :disabled="saving" @click="shareRoute">
                    <Share2 class="size-4" />Поделиться
                  </Button>
                  <Button variant="secondary" class="flex-1 gap-2" :disabled="saving" @click="shareSummaryToTelegram">
                    <Send class="size-4" />Telegram
                  </Button>
                </template>
                <Button v-else-if="itinerary.draft.value" variant="secondary" class="flex-1 gap-2" :disabled="saving" @click="publishDraft">
                  <Save class="size-4" />Сохранить маршрут
                </Button>
                <Button v-else variant="secondary" class="flex-1 gap-2" @click="openPublishFlow">
                  <Save class="size-4" />Открыть планировщик
                </Button>
                <Button variant="outline" class="flex-1 gap-2" @click="cancelTrip">
                  <X class="size-4" />Закрыть
                </Button>
              </div>
            </div>
          </template>
        </DialogContent>
      </Dialog>
      <!-- ═══ RESTORE MAP CHROME ═══ -->
      <Button
        v-if="!showMapChrome"
        variant="outline"
        size="icon"
        class="pointer-events-auto fixed right-4 top-[max(1rem,env(safe-area-inset-top))] z-50 rounded-full border-border/50 bg-card/85 shadow-card backdrop-blur-xl"
        aria-label="Показать панели"
        @click="toggleMapChrome"
      >
        <Minimize2 class="size-5" />
      </Button>
    </div>
</template>

<style scoped>
.nv-skip {
  position: absolute;
  top: -100%;
  left: 1rem;
  z-index: 100;
  padding: 0.5rem 1rem;
  background: rgb(var(--nv-primary));
  color: rgb(var(--nv-on-primary));
  border-radius: 0.5rem;
  font-weight: 600;
  font-size: 0.9rem;
  text-decoration: none;
  transition: top 0.2s ease;
}
.nv-skip:focus {
  top: 1rem;
}

/* Bottom controls must never overlap the map's top-right zoom control. The
   sheet/drawer live in the bottom zone; the zoom control sits top-right. */
:deep(.maplibregl-ctrl-top-right) {
  margin-top: 4.5rem;
  margin-right: 0.5rem;
}
</style>
