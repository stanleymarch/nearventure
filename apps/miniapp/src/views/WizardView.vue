<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, type Component } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  Landmark, Medal, Mountain, Church, TreePine, Building2,
  CheckCircle, PlusCircle, X, MapPin, Infinity as InfinityIcon, Compass, Flag, Sparkles,
} from 'lucide-vue-next';
import { useTelegram } from '@/composables/useTelegram';
import { useBotShortcut } from '@/composables/useBotShortcut';
import { fetchPois, fetchRegionAt, fetchPoiById, type PoiRow } from '@/composables/usePois';
import { useCart } from '@/composables/useCart';
import { poiMediaUrlById } from '@/api/poi-types';
import {
  fetchIsochrone,
  fetchGpx,
  getRoutingHealth,
  planRoute,
  VISIT_MIN_PER_POI,
  type RoutingProfile,
  type Point,
  type PlanResult,
  type RoutingHealth,
} from '@/composables/useRouting';
import { isRoutingProfileAvailable, preserveRoutingProfile, routingProfileFromQuery, ROUTING_PROFILE_LABELS, createLatestRequestGate } from '@shared/api/routing-contracts';
import { fmtDistance, fmtDuration, haversine, estExtraMinutes } from '@/composables/useGeo';
import {
  ALL_CATEGORIES,
  CATEGORY_STYLES,
  DEFAULT_ACTIVE_CATEGORIES,
  type PoiCategory,
} from '@/lib/poi-categories';
import { categoryStyle } from '@/lib/poi-categories';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import WizardMap from '@/components/WizardMap.vue';
import ItineraryDraftSheet from '@/components/itinerary/ItineraryDraftSheet.vue';
import { useItineraryDraft } from '@/composables/useItineraryDraft';
import { migrateCartToDraft, migrationDraftId } from '@/composables/migrateCartToDraft';
import { replanManualDraftIfRouteMissing } from '@/composables/replanManualDraftIfRouteMissing';
import type { AutoFillPreset, ItineraryDraft } from '@/api/itineraries';

const router = useRouter();
const route = useRoute();
const { showBackButton, setMainButton, hideMainButton, mainButtonProgress, haptic, alert } =
  useTelegram();
useBotShortcut('route');
const cart = useCart();
const itinerary = useItineraryDraft();
const activePreset = ref<AutoFillPreset>('balanced');
type WizardStage = 'conditions' | 'preferences' | 'shop';
const wizardStage = ref<WizardStage>('conditions');
const routeMode = ref<'auto' | 'manual'>('manual');
const pendingPoiId = ref('');
const choosingFinish = ref(false);
const finish = ref<Point | null>(null);
const serverSource = ref(false);
const showDraftSheet = ref(false);
const hasBuiltDraft = computed(() =>
  serverSource.value && !!itinerary.draft.value?.route && itinerary.draft.value.places.length > 0,
);

// Helper functions to avoid TypeScript inference issues with inline handlers.
// `noBudget` is the visual shortcut; budgetMode preserves the selected limited rule.
function handleBudgetMode(mode: 'whole_trip' | 'travel_only' | 'unlimited') {
  noBudget.value = mode === 'unlimited';
  if (mode !== 'unlimited') budgetMode.value = mode;
}
function handleTopology(loop: boolean) {
  loopEnabled.value = loop;
  if (loop) choosingFinish.value = false;
}
function handlePickFinish() {
  loopEnabled.value = false;
  showDraftSheet.value = false;
  choosingFinish.value = true;
}
function handleClearFinish() {
  finish.value = null;
  choosingFinish.value = false;
}
function handleSmartFix(suggestionId: string) {
  itinerary.applySmartFix(suggestionId);
  showDraftSheet.value = false;
}
function handleAlternative(alternativeId: string) {
  itinerary.selectAlternative?.(alternativeId);
  showDraftSheet.value = false;
}
function handleAutoFill(categories: string[], seed: number | undefined, preset: AutoFillPreset | undefined) {
  activePreset.value = preset ?? 'balanced';
  itinerary.autoFill(categories, seed, preset);
  showDraftSheet.value = false;
}
function handleUndo() {
  itinerary.undo();
  showDraftSheet.value = false;
}
async function handlePublish() {
  if (!itinerary.draft.value?.route || !itinerary.draft.value?.totals.feasible || itinerary.draft.value.publishedRouteId) return;
  const p = await itinerary.publish();
  if (p?.publishedRouteId) {
    haptic.notify('success');
    router.push({ name: 'draft', params: { id: p.id } });
  } else if (p === null && itinerary.error.value) {
    haptic.notify('error');
    await alert(itinerary.error.value);
  }
}
async function handleDownloadGpx() {
  const d = itinerary.draft.value;
  if (!d?.route) return;
  haptic.impact('light');
  const r = { geojson: d.route.geojson, distance: d.route.distance, duration: d.route.duration, ascend: d.route.ascend, descend: d.route.descend, profile: d.route.profile };
  const blob = await fetchGpx(r as any, `Nearventure — ${fmtDistance(r.distance)}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nearventure-${Math.round(r.distance / 1000)}km.gpx`;
  a.click();
  URL.revokeObjectURL(url);
}

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
function togglePreference(category: PoiCategory) {
  const next = new Set(active.value);
  next.has(category) ? next.delete(category) : next.add(category);
  active.value = next;
  haptic.selection();
}

// ── Inputs (from bot query or defaults) ──────────────────────
const start = ref<Point | null>(null);
const profile = ref<RoutingProfile>('foot');
const routingHealth = ref<RoutingHealth | null>(null);
const routingStatus = ref<'checking' | 'ready' | 'unavailable'>('checking');
const profileAvailable = computed(() => routingStatus.value !== 'unavailable' && isRoutingProfileAvailable(profile.value, routingHealth.value));
const canRequestRouting = computed(() => routingStatus.value === 'ready' && profileAvailable.value);
itinerary.setRoutingGuard(
  () => canRequestRouting.value,
  () => { void alert(routingStatus.value === 'unavailable' ? 'Маршрутизатор недоступен. Нажмите «Повторить» и попробуйте снова.' : 'Проверяем маршрутизатор. Подождите немного.'); },
);
function profileOptionAvailable(value: RoutingProfile): boolean {
  return routingStatus.value !== 'unavailable' && isRoutingProfileAvailable(value, routingHealth.value);
}
const healthRequestGate = createLatestRequestGate();
async function checkRoutingHealth() {
  const token = healthRequestGate.begin();
  routingStatus.value = 'checking';
  routingHealth.value = null;
  try {
    const health = await getRoutingHealth();
    if (!healthRequestGate.isCurrent(token)) return;
    routingHealth.value = health;
    routingStatus.value = health.available ? 'ready' : 'unavailable';
    const replacement = preserveRoutingProfile(profile.value, health);
    if (replacement && replacement !== profile.value) profile.value = replacement;
    if (wizardStage.value === 'shop') await loadShop();
  } catch {
    if (!healthRequestGate.isCurrent(token)) return;
    routingHealth.value = { available: false, profiles: [] };
    routingStatus.value = 'unavailable';
  }
}
const budgetMin = ref(60);
/**
 * Whether the route returns to the start point (closed loop) or ends at the
 * last POI (linear). A loop is the default (matches the bot), but a linear
 * route lets you cover noticeably more ground in the same time — important
 * when the user just wants to get somewhere and back by other means.
 */
const loopEnabled = ref(true);
/**
 * When true, ignore the time budget entirely: the wizard shows every
 * POI reachable in the isochrone (or in the bbox) without the
 * "перебор на N мин" warning. The cart still works, the order button
 * still appears, but `overBudget` is suppressed.
 */
const noBudget = ref(false);
const budgetMode = ref<'whole_trip' | 'travel_only'>('whole_trip');
const active = ref<Set<PoiCategory>>(new Set(DEFAULT_ACTIVE_CATEGORIES));
/**
 * Region auto-detected from the start point. When set, the shop query
 * filters by region so we don't surface "Казань" while the user is in
 * Kirov. Set by `loadShop()` on the first call after start is known.
 */
const detectedRegion = ref<string | null>(null);
/** When true, long-press on the map drops a custom pin (addCustom). */
const pinMode = ref(false);
/** Active tab: 'all' shows all POIs sorted by distance; per-category tabs deep-dive. */
const activeTab = ref<'all' | string>('all');

const pois = ref<PoiRow[]>([]);
const isochroneApproximate = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const plan = ref<PlanResult | null>(null);
const planning = ref(false);

let backCleanup: (() => void) | undefined;
let mainCleanup: (() => void) | undefined;
let planTimer: ReturnType<typeof setTimeout> | undefined;

function applyDraftSettings(draft: ItineraryDraft) {
  profile.value = draft.profile as RoutingProfile;
  loopEnabled.value = draft.loop;
  finish.value = draft.finish ?? null;
  activePreset.value = draft.preset;
  noBudget.value = draft.budgetMode === 'unlimited';
  if (draft.budgetMode !== 'unlimited') budgetMode.value = draft.budgetMode;
  if (draft.totals.budgetMinutes != null) budgetMin.value = draft.totals.budgetMinutes;
}

async function openCanonicalSurface() {
  if (!canRequestRouting.value) {
    await alert(routingStatus.value === 'unavailable' ? 'Маршрутизатор недоступен. Повторите проверку и попробуйте снова.' : routingStatus.value === 'checking' ? 'Проверяем маршрутизатор. Подождите немного.' : 'Выберите доступный транспорт.');
    return;
  }
  if (!start.value) return;
  if (routeMode.value === 'auto' && noBudget.value) {
    noBudget.value = false;
    await alert('Автоподбору нужен конечный лимит времени.');
    return;
  }
  const intent = routeMode.value === 'auto' ? 'auto_budget' : 'manual_collection';
  const created = await itinerary.create({
    start: start.value,
    ...(!loopEnabled.value && finish.value ? { finish: finish.value } : {}),
    profile: profile.value,
    loop: loopEnabled.value,
    intent,
    stopPace: 'pass_by',
    budgetMode: routeMode.value === 'auto' ? 'whole_trip' : noBudget.value ? 'unlimited' : budgetMode.value,
    ...(routeMode.value === 'manual' && noBudget.value ? {} : { budgetMinutes: budgetMin.value }),
    preset: activePreset.value,
  });
  if (!created) return;

  if (routeMode.value === 'auto') {
    const filled = await itinerary.autoFill(Array.from(active.value), undefined, activePreset.value);
    if (filled?.route) router.push({ name: 'draft', params: { id: filled.id }, query: { version: filled.version } });
    return;
  }

  const migration = await migrateCartToDraft({ storage: localStorage, draft: created, items: cart.list.value, addPoi: itinerary.addPoi });
  serverSource.value = migration.migrated || migration.reason === 'already' || cart.list.value.length === 0;
  wizardStage.value = 'shop';
  await loadShop();
  if (pendingPoiId.value) {
    const p = await fetchPoiById(pendingPoiId.value);
    pendingPoiId.value = '';
    if (p) await addPoi(p);
  }
  await replanAfterMigrationIfRouteMissing();
  setupMainButton();
}

/**
 * `add-poi` persists the migrated manual places but never routes; the wizard
 * paths that replay the legacy cart must finish with exactly one `replan`.
 * The guard no-ops when the pending-POI addPoi → replan path already produced
 * a route, in auto mode, or for an empty draft.
 */
async function replanAfterMigrationIfRouteMissing() {
  await replanManualDraftIfRouteMissing({
    routeMode: routeMode.value,
    draft: itinerary.draft.value,
    replan: () => itinerary.replan(),
  });
}

async function advanceWizard() {
  if (wizardStage.value === 'conditions') {
    wizardStage.value = 'preferences';
    setupMainButton();
    return;
  }
  if (wizardStage.value === 'preferences') await openCanonicalSurface();
}

onMounted(async () => {
  backCleanup = showBackButton(() => window.history.back());
  readQuery();
  pendingPoiId.value = String(route.query.poi || '').trim();
  if (pendingPoiId.value) router.replace({ query: { ...route.query, poi: undefined } }).catch(() => {});
  await checkRoutingHealth();
  await initStart();

  const storedDraftId = migrationDraftId(localStorage);
  if (storedDraftId) {
    const initial = await itinerary.hydrate(storedDraftId);
    if (initial) {
      applyDraftSettings(initial);
      routeMode.value = initial.intent === 'auto_budget' ? 'auto' : 'manual';
      if (routeMode.value === 'auto' && initial.route) {
        router.push({ name: 'draft', params: { id: initial.id }, query: { version: initial.version } });
        return;
      }
      const migration = await migrateCartToDraft({ storage: localStorage, draft: initial, items: cart.list.value, addPoi: itinerary.addPoi });
      serverSource.value = migration.migrated || migration.reason === 'already' || cart.list.value.length === 0;
      wizardStage.value = 'shop';
      await loadShop();
      if (pendingPoiId.value) {
        const p = await fetchPoiById(pendingPoiId.value);
        pendingPoiId.value = '';
        if (p) await addPoi(p);
      }
      await replanAfterMigrationIfRouteMissing();
    }
  }
  setupMainButton();
});
onUnmounted(() => {
  backCleanup?.();
  mainCleanup?.();
  hideMainButton();
});

function readQuery() {
  const q = route.query;
  if (q.lat && q.lon) {
    start.value = { lat: Number(q.lat), lon: Number(q.lon) };
  }
  const queryProfile = routingProfileFromQuery(q.profile);
  if (queryProfile) profile.value = queryProfile;
  if (q.time) budgetMin.value = Math.min(480, Math.max(15, Number(q.time) || 60));
  routeMode.value = String(q.mode || q.intent) === 'auto' || String(q.intent) === 'auto_budget' ? 'auto' : 'manual';
  if (routeMode.value === 'auto') noBudget.value = false;
  if (q.loop != null) loopEnabled.value = String(q.loop) !== '0' && String(q.loop).toLowerCase() !== 'false';
  if (q.finishLat && q.finishLon) finish.value = { lat: Number(q.finishLat), lon: Number(q.finishLon) };
  if (q.region) detectedRegion.value = String(q.region);
  if (q.cat) {
    const cats = String(q.cat)
      .split(',')
      .map((c) => c.trim())
      .filter((c): c is PoiCategory => (ALL_CATEGORIES as string[]).includes(c));
    if (cats.length) active.value = new Set(cats);
  }
}

async function initStart() {
  if (!start.value) {
    // No bot handoff → request geolocation (like NearbyView).
    try {
      const pos = await getPosition();
      start.value = { lat: pos.lat, lon: pos.lon };
    } catch (e: any) {
      error.value = e?.message || 'Не удалось получить геолокацию.';
      return;
    }
  }
}

function getPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Геолокация недоступна.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === 1
              ? 'Доступ к геолокации запрещён.'
              : 'Не удалось определить местоположение.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

// ── Shop: isochrone + POI ────────────────────────────────────
async function loadShop() {
  if (!start.value || wizardStage.value !== 'shop') return;
  if (!canRequestRouting.value) {
    error.value = routingStatus.value === 'unavailable' ? 'Маршрутизатор недоступен. Повторите проверку.' : routingStatus.value === 'checking' ? 'Проверяем маршрутизатор.' : 'Выберите доступный транспорт.';
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    // Auto-detect the region the user is in (one-shot, then cached).
    // If the start point sits inside a region, we add a `region=` filter
    // to the shop query so results don't bleed across oblasts.
    if (!detectedRegion.value) {
      try {
        const r = await fetchRegionAt(start.value.lat, start.value.lon);
        detectedRegion.value = r.region;
      } catch {
        // Reverse-geocode is a best-effort: if it fails, the wizard
        // still works, just without the auto-filter.
        detectedRegion.value = null;
      }
    }
    // When "без лимита" is on, skip the isochrone and use a generous
    // bounding box (50km radius) instead. The user explicitly asked to
    // see everything, not just what fits in the time budget.
    let bbox: string;
    if (noBudget.value) {
      isochroneApproximate.value = false;
      const lat = start.value.lat;
      const lon = start.value.lon;
      const r = 0.45; // ~50km in degrees
      bbox = `${lon - r},${lat - r},${lon + r},${lat + r}`;
    } else {
      const iso = await fetchIsochrone(start.value, profile.value, budgetMin.value);
      isochroneApproximate.value = iso.approximate === true;
      const [minLon, minLat, maxLon, maxLat] = iso.bbox;
      bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
    }
    const cats = Array.from(active.value).join(',') || undefined;
    const res = await fetchPois({
      bbox,
      category: cats,
      // When "без лимита" is on, don't filter by region — the user wants
      // to see everything in the generous bbox. When budget IS limited,
      // the region filter keeps results relevant (avoids "Казань в Кирове").
      region: noBudget.value ? undefined : (detectedRegion.value ?? undefined),
      limit: 200,
      sort: 'popularity',
    });
    pois.value = res.items.filter((p) => p.lat != null && p.lon != null);
    // Drop cart items no longer in view.
    recompute();
  } catch (e: any) {
    error.value = e?.response?.data?.message || 'Не удалось загрузить объекты.';
  } finally {
    loading.value = false;
  }
}

// Group POIs by category ("departments") and sort each group by
// distance from the start point. The user complained that the previous
// version sorted by global popularity — "ничего рядом" was a real
// symptom: Kirov POIs showed up at the bottom of an Oslo-popular list.
// Now the closest items are always first, even within a category.
function catalogVibeRank(poi: PoiRow): number {
  if (activePreset.value === 'scenic') return poi.category === 'nature' || poi.category === 'sights' ? 2 : 0;
  if (activePreset.value === 'training') return poi.category === 'nature' ? 2 : 0;
  if (activePreset.value === 'more_places') return 0;
  return (poi.popularityScore ?? 0) / 100;
}

const departments = computed(() => {
  const groups = new Map<string, PoiRow[]>();
  for (const p of pois.value) {
    const arr = groups.get(p.category) || [];
    arr.push(p);
    groups.set(p.category, arr);
  }
  const startPt = start.value;
  const sortByDist = (a: PoiRow, b: PoiRow) => {
    if (!startPt) return 0;
    const da = haversine(startPt, { lat: a.lat as number, lon: a.lon as number });
    const db = haversine(startPt, { lat: b.lat as number, lon: b.lon as number });
    return catalogVibeRank(b) - catalogVibeRank(a) || da - db;
  };
  return ALL_CATEGORIES.filter((c) => groups.has(c)).map((c) => ({
    cat: c,
    style: CATEGORY_STYLES[c],
    items: groups.get(c)!.slice().sort(sortByDist),
  }));
});

/** All POIs sorted by distance from start — the "Все рядом" main tab. */
const allSortedByDistance = computed(() => {
  const startPt = start.value;
  if (!startPt) return pois.value;
  return pois.value.slice().sort((a, b) => {
    const da = haversine(startPt, { lat: a.lat as number, lon: a.lon as number });
    const db = haversine(startPt, { lat: b.lat as number, lon: b.lon as number });
    return catalogVibeRank(b) - catalogVibeRank(a) || da - db;
  });
});

/** Distance + travel-time from `start` to a POI (m, min). 0 if no start. */
function distanceFromStart(p: PoiRow): { meters: number; minutes: number } {
  if (!start.value || p.lat == null || p.lon == null) return { meters: 0, minutes: 0 };
  const meters = haversine(start.value, { lat: p.lat, lon: p.lon });
  const minutes = estExtraMinutes(meters, profile.value);
  return { meters, minutes };
}

// ── Cart + live budget ───────────────────────────────────────
const cartList = computed(() => serverSource.value && itinerary.draft.value
  ? itinerary.draft.value.places.flatMap(place => place.pois.filter(poi => poi.included).map(poi => ({ id: poi.id, poiId: poi.id, name: poi.name, category: poi.category, lat: poi.lat, lon: poi.lon, kind: 'poi' as const })))
  : cart.list.value);
const planMin = computed(() => (plan.value ? Math.round(plan.value.duration / 60) : 0));
const budgetUsedPct = computed(() =>
  noBudget.value || !planMin.value || !budgetMin.value
    ? 0
    : Math.min(100, Math.round((planMin.value / budgetMin.value) * 100)),
);
// "Без лимита" mode suppresses the over-budget warning but still shows
// the actual minutes for transparency.
const overBudget = computed(() => !noBudget.value && planMin.value > budgetMin.value);

/** Total sightseeing time across all cart stops (NOT added to the travel
 *  budget — shown separately, per the product decision). Keeps the budget
 *  bar honest about travel while still surfacing the real time cost. */
const visitMin = computed(() => cartList.value.length * VISIT_MIN_PER_POI);

// `toggleCat` removed — category chips are now tabs (switch view, not toggle).
// The `active` set still controls which categories are queried from the API.

function isInCart(id: string) {
  return serverSource.value
    ? !!itinerary.draft.value?.places.some(place => place.pois.some(poi => poi.id === id))
    : cart.has(id);
}

async function addPoi(p: PoiRow) {
  haptic.impact('light');
  if (serverSource.value && itinerary.draft.value) {
    const place = itinerary.draft.value.places.find(node => node.pois.some(poi => poi.id === p.id));
    if (place) await itinerary.removePlace(place.id);
    else await itinerary.addPoi(p.id);
    await itinerary.replan();
  } else if (cart.has(p.id)) cart.remove(p.id);
  else cart.add({ id: p.id, name: p.name || `Объект ${p.id.slice(0, 8)}`, category: p.category, lat: p.lat!, lon: p.lon!, kind: 'poi', poiId: p.id });
  recompute();
}

/** Long-press on WizardMap → add a custom waypoint. */
function onMapPin({ lat, lon }: { lat: number; lon: number }) {
  haptic.impact('light');
  cart.addCustom(lat, lon, 'Моя точка на карте');
  recompute();
}

async function removeFromCart(id: string) {
  haptic.impact('light');
  const place = itinerary.draft.value?.places.find(node => node.pois.some(poi => poi.id === id));
  if (serverSource.value && place) { await itinerary.removePlace(place.id); await itinerary.replan(); }
  else cart.remove(id);
  recompute();
}

/**
 * Capture the device's current geolocation and add it as a custom
 * waypoint in the cart. The user is opting in by tapping the button —
 * we don't request location on mount (anti-pattern: never ask without
 * a clear trigger). On permission denied or geolocation-unavailable,
 * the alert explains the situation and the cart is unchanged.
 */
function addMyLocation() {
  if (!('geolocation' in navigator)) {
    alert('Геолокация недоступна в этом браузере.');
    return;
  }
  haptic.impact('light');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      cart.addCustom(pos.coords.latitude, pos.coords.longitude, 'Моя точка');
      haptic.notify('success');
      recompute();
    },
    (err) => {
      const reason = err.code === 1
        ? 'Доступ к геолокации запрещён. Разрешите его в настройках.'
        : 'Не удалось определить местоположение.';
      alert(reason);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

// Re-plan the route through the cart (debounced).
function recompute() {
  if (planTimer) clearTimeout(planTimer);
  planTimer = setTimeout(doPlan, 500);
  setupMainButton();
}

async function doPlan() {
  if (!canRequestRouting.value) {
    plan.value = null;
    planning.value = false;
    return;
  }
  if (serverSource.value && itinerary.draft.value?.route) {
    const route = itinerary.draft.value.route;
    plan.value = { geojson: route.geojson, distance: route.distance, duration: route.duration, ascend: route.ascend, descend: route.descend, profile: route.profile, bbox: route.bbox };
    planning.value = false;
    setupMainButton();
    return;
  }
  if (!start.value || cartList.value.length === 0) {
    plan.value = null;
    planning.value = false;
    setupMainButton();
    return;
  }
  planning.value = true;
  try {
    const waypoints = cartList.value.map((p) => ({ lon: p.lon, lat: p.lat }));
    plan.value = await planRoute(start.value, waypoints, profile.value, {
      optimize: true,
      loop: loopEnabled.value,
    });
  } catch (e: any) {
    plan.value = null;
  } finally {
    planning.value = false;
    setupMainButton();
  }
}

function setupMainButton() {
  mainCleanup?.();
  if (wizardStage.value !== 'shop') {
    mainCleanup = setMainButton({
      text: wizardStage.value === 'conditions'
        ? 'Продолжить к интересам'
        : routeMode.value === 'auto' ? 'Собрать маршрут' : 'Перейти к местам',
      onClick: advanceWizard,
    });
    mainButtonProgress(itinerary.loading.value);
    return;
  }
  mainCleanup = setMainButton({
    text: hasBuiltDraft.value ? 'Посмотреть маршрут' : 'Подобрать маршрут',
    onClick: checkout,
  });
  mainButtonProgress(planning.value);
}

async function checkout() {
  if (cartList.value.length === 0 || !start.value) {
    if (!cartList.value.length) await alert('Добавьте точки, чтобы подобрать маршрут.');
    return;
  }
  // If we have a server-backed draft with a built route, navigate with draftId.
  if (serverSource.value && itinerary.draft.value?.route && itinerary.draft.value.places.length > 0) {
    haptic.notify('success');
    router.push({ name: 'draft', params: { id: itinerary.draft.value.id }, query: { version: itinerary.draft.value.version } });
    return;
  }
  // A volatile cart (for example one containing a custom pin) has no owned
  // itinerary identity. Never send its browser-only geometry to preview,
  // guide, or share; ask the user to rebuild it from canonical POIs instead.
  haptic.notify('warning');
  await alert('Не удалось перенести все точки в сохранённый план. Уберите пользовательскую метку или выберите места из каталога, затем соберите маршрут снова.');
}

function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'точка';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'точки';
  return 'точек';
}

function poiName(p: PoiRow): string {
  return p.name || `Объект ${p.id.slice(0, 8)}`;
}

// Reload shop when budget/profile/categories change. `noBudget` triggers a
// reload because it switches between isochrone bbox and generous bbox.
// When noBudget is on, we also drop the region filter ("show me everything").
watch([budgetMin, profile, noBudget], loadShop);
watch(active, loadShop, { deep: true });
watch(routeMode, (mode) => {
  if (mode === 'auto') {
    noBudget.value = false;
    budgetMode.value = 'whole_trip';
  }
  setupMainButton();
});
// Toggling loop changes topology but never keeps a hidden stale finish.
watch(loopEnabled, (loop) => {
  if (loop) {
    finish.value = null;
    choosingFinish.value = false;
  }
  recompute();
});
async function removeDraftPlace(placeId: string) { if (await itinerary.removePlace(placeId)) await itinerary.replan(); recompute(); }
let settingsTimer: ReturnType<typeof setTimeout> | undefined;
watch([budgetMin, profile, loopEnabled, noBudget, budgetMode, finish], () => {
  if (!serverSource.value || !itinerary.draft.value || !canRequestRouting.value) return;
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    const updated = await itinerary.updateSettings({
      budgetMode: noBudget.value ? 'unlimited' : budgetMode.value,
      ...(noBudget.value ? {} : { budgetMinutes: budgetMin.value }),
      profile: profile.value,
      loop: loopEnabled.value,
      finish: loopEnabled.value ? null : finish.value,
    });
    if (updated?.places.length) await itinerary.replan();
  }, 350);
});
watch(() => itinerary.draft.value?.version, setupMainButton);
</script>

<template>
  <div class="pb-40">
    <!-- Header: editable inputs -->
    <Card v-if="wizardStage === 'conditions'" class="p-4">
      <div class="flex items-center justify-between gap-2">
        <p class="nv-eyebrow">Соберите маршрут</p>
        <span v-if="start" class="text-xs text-nv-on-surface-variant">
          {{ start.lat.toFixed(3) }}, {{ start.lon.toFixed(3) }}
        </span>
      </div>
      <div class="mt-3 grid grid-cols-2 rounded-[10px] bg-nv-surface-low p-1" aria-label="Способ планирования">
        <button type="button" class="min-h-11 rounded-[8px] text-xs font-semibold" :class="routeMode === 'auto' ? 'bg-nv-surface-lowest text-nv-primary shadow-sm' : 'text-nv-on-surface-variant'" :aria-pressed="routeMode === 'auto'" @click="routeMode = 'auto'">Автоподбор</button>
        <button type="button" class="min-h-11 rounded-[8px] text-xs font-semibold" :class="routeMode === 'manual' ? 'bg-nv-surface-lowest text-nv-primary shadow-sm' : 'text-nv-on-surface-variant'" :aria-pressed="routeMode === 'manual'" @click="routeMode = 'manual'">Выбирать места</button>
      </div>
      <div class="grid grid-cols-2 gap-3 mt-3">
        <div class="block">
          <label for="routing-profile" class="nv-hint text-xs">Транспорт</label>
          <select
            id="routing-profile"
            v-model="profile"
            class="mt-1 w-full rounded-[10px] border border-nv-outline-variant bg-nv-surface-low px-2.5 py-2 text-[15px] text-nv-on-surface"
          >
            <option value="bike" :disabled="!profileOptionAvailable('bike')">{{ ROUTING_PROFILE_LABELS.bike }}</option>
            <option value="bike_touring" :disabled="!profileOptionAvailable('bike_touring')">{{ ROUTING_PROFILE_LABELS.bike_touring }}</option>
            <option value="mtb" :disabled="!profileOptionAvailable('mtb')">{{ ROUTING_PROFILE_LABELS.mtb }}</option>
            <option value="mtb_leisure" :disabled="!profileOptionAvailable('mtb_leisure')">{{ ROUTING_PROFILE_LABELS.mtb_leisure }}</option>
            <option value="foot" :disabled="!profileOptionAvailable('foot')">{{ ROUTING_PROFILE_LABELS.foot }}</option>
            <option value="foot_scenic" :disabled="!profileOptionAvailable('foot_scenic')">{{ ROUTING_PROFILE_LABELS.foot_scenic }}</option>
            <option value="car" :disabled="!profileOptionAvailable('car')">{{ ROUTING_PROFILE_LABELS.car }}</option>
          </select>
          <p class="mt-1 text-[11px] text-nv-on-surface-variant" role="status" aria-live="polite">
            {{ routingStatus === 'checking' ? 'Проверяем доступные виды транспорта…' : routingStatus === 'unavailable' ? 'Маршрутизатор недоступен.' : 'Доступность транспорта получена от маршрутизатора.' }}
          </p>
          <button v-if="routingStatus === 'unavailable'" type="button" class="mt-1 min-h-11 font-semibold text-nv-primary underline" @click="checkRoutingHealth">Повторить проверку маршрутизатора</button>
        </div>
        <label class="block">
          <div class="flex items-center justify-between">
            <span class="nv-hint text-xs">
              Бюджет: <template v-if="noBudget">без лимита</template><template v-else>{{ budgetMin }} мин</template>
            </span>
            <button
              v-if="routeMode === 'manual'"
              type="button"
              class="text-[11px] font-semibold uppercase tracking-wide"
              :class="noBudget ? 'text-nv-primary' : 'text-nv-on-surface-variant'"
              @click="noBudget = !noBudget"
              :aria-pressed="noBudget"
            >
              <InfinityIcon v-if="noBudget" class="inline size-3 -mt-0.5" />
              {{ noBudget ? 'Задать лимит' : 'Снять лимит' }}
            </button>
          </div>
          <input
            v-model.number="budgetMin"
            type="range"
            min="15"
            max="240"
            step="15"
            :disabled="noBudget"
            class="nv-range mt-2"
            :class="noBudget ? 'opacity-40' : ''"
          />
        </label>
      </div>
      <div v-if="routeMode === 'manual' && !noBudget" class="mt-3 grid grid-cols-2 rounded-[10px] bg-nv-surface-low p-1" aria-label="Как считать время">
        <button type="button" class="min-h-11 rounded-[8px] text-xs font-semibold" :class="budgetMode === 'whole_trip' && 'bg-nv-surface-lowest text-nv-primary shadow-sm'" :aria-pressed="budgetMode === 'whole_trip'" @click="budgetMode = 'whole_trip'">Всё путешествие</button>
        <button type="button" class="min-h-11 rounded-[8px] text-xs font-semibold" :class="budgetMode === 'travel_only' && 'bg-nv-surface-lowest text-nv-primary shadow-sm'" :aria-pressed="budgetMode === 'travel_only'" @click="budgetMode = 'travel_only'">Только дорога</button>
      </div>
      <!-- Loop toggle — whether the route returns to the start. A linear
           route (off) covers more ground in the same time; a loop (on) is
           the default and matches the bot. Material-style switch. -->
      <button
        type="button"
        class="mt-3 flex w-full items-center justify-between gap-2 rounded-[10px] border border-nv-outline-variant/70 bg-nv-surface-lowest px-3 py-2 text-left"
        :aria-pressed="loopEnabled"
        @click="loopEnabled = !loopEnabled; haptic.selection()"
      >
        <span class="min-w-0">
          <span class="block text-[13px] font-medium text-nv-on-surface">Вернуться в точку старта</span>
          <span class="nv-hint block text-[11px]">{{ loopEnabled ? 'кольцевой маршрут' : 'линейный — уйдёте дальше за то же время' }}</span>
        </span>
        <span
          class="relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors"
          :class="loopEnabled ? 'bg-nv-primary' : 'bg-nv-outline-variant'"
        >
          <span
            class="inline-block size-4 transform rounded-full bg-white shadow transition-transform"
            :class="loopEnabled ? 'translate-x-4' : 'translate-x-0.5'"
          />
        </span>
      </button>
      <div v-if="!loopEnabled" class="mt-3 rounded-[10px] border border-nv-outline-variant/70 bg-nv-surface-lowest p-3">
        <div class="flex items-center gap-2">
          <Flag class="size-4 text-nv-primary" />
          <div class="min-w-0 flex-1"><p class="text-[13px] font-medium">Финиш</p><p class="truncate text-[11px] text-nv-on-surface-variant">{{ finish ? `${finish.lat.toFixed(3)}, ${finish.lon.toFixed(3)}` : 'Последнее выбранное место' }}</p></div>
          <button type="button" class="min-h-11 rounded-lg px-2 text-xs font-semibold text-nv-primary" @click="choosingFinish = !choosingFinish">{{ choosingFinish ? 'Готово' : 'На карте' }}</button>
          <button v-if="finish" type="button" class="grid size-11 place-items-center rounded-lg text-nv-on-surface-variant" aria-label="Убрать финиш" @click="finish = null"><X class="size-4" /></button>
        </div>
        <WizardMap v-if="choosingFinish && start" class="mt-3" :start="start" :pois="[]" :finish-point="finish" selection-mode="finish" @finish="finish = $event; choosingFinish = false; haptic.selection()" />
      </div>
      <!-- Region badge — tells the user what the wizard filtered to.
           Without this, auto-filtering looked like a bug ("куда делись
           POI из Казани?"). One line, dismissable via "Все регионы". -->
      <p
        v-if="detectedRegion"
        class="mt-3 flex items-center gap-1.5 text-[11px] text-nv-on-surface-variant"
      >
        <span class="inline-flex items-center rounded-full bg-nv-surface-low px-2 py-0.5 font-medium">
          {{ detectedRegion }}
        </span>
        <span>· только объекты в вашем регионе</span>
        <button
          type="button"
          class="ml-auto text-nv-primary font-semibold"
          @click="detectedRegion = null; loadShop()"
        >
          Все регионы
        </button>
      </p>
    </Card>

    <Card v-else-if="wizardStage === 'preferences'" class="p-4">
      <div class="flex items-center gap-2"><Sparkles class="size-5 text-nv-primary" /><div><p class="font-semibold">Интересы и вайб</p><p class="text-xs text-nv-on-surface-variant">Они ранжируют каталог и предложения, но не добавляют места сами.</p></div></div>
      <div class="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Категории интересов">
        <button v-for="category in ALL_CATEGORIES" :key="category" type="button" class="flex min-h-11 items-center gap-2 rounded-[10px] border px-3 text-left text-xs font-semibold" :class="active.has(category) ? 'border-nv-primary bg-nv-primary/10 text-nv-primary' : 'border-nv-outline-variant/70 text-nv-on-surface-variant'" :aria-pressed="active.has(category)" @click="togglePreference(category)"><component :is="catIcon(category)" class="size-4" />{{ CATEGORY_STYLES[category].label }}</button>
      </div>
      <p class="nv-hint mt-4 text-xs">Вайб маршрута</p>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <button v-for="option in [{ value: 'balanced', label: 'Сбалансированный' }, { value: 'more_places', label: 'Больше мест' }, { value: 'scenic', label: 'Живописный' }, { value: 'training', label: 'Тренировка' }]" :key="option.value" type="button" class="min-h-11 rounded-[10px] border px-2 text-xs font-semibold" :class="activePreset === option.value ? 'border-nv-primary bg-nv-primary/10 text-nv-primary' : 'border-nv-outline-variant/70'" :aria-pressed="activePreset === option.value" @click="activePreset = option.value as AutoFillPreset; haptic.selection()">{{ option.label }}</button>
      </div>
      <div class="mt-4 grid grid-cols-3 gap-1.5 text-center text-[10px] font-semibold text-nv-on-surface-variant"><span class="rounded-lg bg-nv-surface-low p-2">{{ profile }}</span><span class="rounded-lg bg-nv-surface-low p-2">{{ noBudget ? 'без лимита' : `${budgetMin} мин` }}</span><span class="rounded-lg bg-nv-surface-low p-2">{{ loopEnabled ? 'кольцо' : 'линейный' }}</span></div>
      <button type="button" class="mt-3 min-h-11 w-full rounded-[10px] text-xs font-semibold text-nv-primary" @click="wizardStage = 'conditions'; setupMainButton()">Назад к условиям</button>
    </Card>

    <template v-if="wizardStage === 'shop'">
    <!-- Map overview — shows what's reachable + supports long-press pin drop.
         The user said the wizard should feel like a storefront: "here's the
         area, here's what's there, and you can drop a custom pin anywhere." -->
    <WizardMap
      v-if="start"
      :start="start"
      :pois="pois"
      :pin-mode="pinMode"
      :finish-point="!loopEnabled ? finish : null"
      :selection-mode="choosingFinish ? 'finish' : null"
      @pin="onMapPin"
      @finish="finish = $event; choosingFinish = false; haptic.selection()"
    />
    <p v-if="isochroneApproximate" class="mt-2 rounded-lg border border-nv-outline-variant/60 bg-nv-surface-lowest px-3 py-2 text-[11px] text-nv-on-surface-variant">Зона достижимости приблизительная; выбранные места проверяются по дорожной сети.</p>

    <!-- Pin mode toggle + hint -->
    <div v-if="start" class="mt-1.5 flex items-center justify-between gap-2 px-0.5 text-[11px]">
      <span class="text-nv-on-surface-variant">
        Карта показывает объекты в {{ budgetMin }} мин <b v-if="profile">{{ profile === 'foot' ? 'пешком' : profile === 'bike' ? 'на велосипеде' : profile === 'car' ? 'на машине' : 'пешком' }}</b> от вас
      </span>
      <button
        type="button"
        class="inline-flex items-center gap-1 font-semibold"
        :class="pinMode ? 'text-nv-primary' : 'text-nv-on-surface-variant'"
        @click="pinMode = !pinMode"
        :aria-pressed="pinMode"
      >
        {{ pinMode ? '📍 Ставлю точку' : '📍 Поставить точку' }}
      </button>
    </div>

    <!-- Category tabs — replace toggle chips with tab navigation.
         First tab "Все рядом" shows all POIs sorted by distance (the
         user's #1 ask: "основная вкладка — то что реально рядом").
         Per-category tabs let the user deep-dive into one type. -->
    <div class="mt-3 flex gap-1.5 overflow-x-auto px-4 scrollbar-none scroll-smooth" style="scroll-padding-left: 1rem">
      <!-- "All nearby" tab -->
      <button
        class="inline-flex flex-none items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors"
        :class="activeTab === 'all' ? 'border-transparent bg-nv-primary text-white' : 'border-nv-outline-variant/70 bg-nv-surface-lowest text-nv-on-surface-variant'"
        @click="activeTab = 'all'; haptic.selection()"
      >
        <Compass class="size-4 shrink-0" />
        Все рядом
      </button>
      <!-- Per-category tabs -->
      <button
        v-for="c in ALL_CATEGORIES"
        :key="c"
        class="inline-flex flex-none items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors"
        :class="activeTab === c ? 'border-transparent' : 'border-nv-outline-variant/70 bg-nv-surface-lowest text-nv-on-surface-variant'"
        :style="activeTab === c ? { background: CATEGORY_STYLES[c].container, color: CATEGORY_STYLES[c].color, borderColor: CATEGORY_STYLES[c].color } : {}"
        @click="activeTab = c; haptic.selection()"
      >
        <component :is="catIcon(c)" class="size-4 shrink-0" />
        {{ CATEGORY_STYLES[c].label }}
      </button>
    </div>

    <!-- States -->
    <Card v-if="error" class="p-5 text-center space-y-3">
      <p class="nv-hint">{{ error }}</p>
      <Button variant="outline" @click="loadShop()">🔁 Попробовать снова</Button>
      <p class="text-xs text-nv-on-surface-variant/70">Если геолокация запрещена — разрешите её в настройках Telegram.</p>
    </Card>
    <Card v-else-if="loading" class="p-6 text-center">
      <div class="mx-auto mb-2 size-6 animate-spin rounded-full border-2 border-nv-primary border-t-transparent" />
      <p class="nv-hint">Подбираем, что в досягаемости…</p>
    </Card>
    <Card v-else-if="pois.length === 0" class="p-6">
      <p class="nv-hint">В зоне досягаемости ничего нет. Увеличьте время или смените категорию.</p>
    </Card>

    <!-- "All nearby" view: all POIs sorted by distance, mixed categories -->
    <section v-if="activeTab === 'all' && !loading && !error && pois.length > 0" class="mt-4">
      <p class="nv-eyebrow mb-2">📍 Что рядом с вами</p>
      <div class="space-y-2">
        <button
          v-for="p in allSortedByDistance"
          :key="p.id"
          class="flex w-full items-stretch gap-2.5 rounded-xl border bg-nv-surface-lowest p-2 text-left transition-transform active:scale-[0.99]"
          :class="isInCart(p.id) ? 'border-nv-tertiary bg-nv-tertiary-container/15' : 'border-nv-outline-variant/60'"
          @click="addPoi(p)"
        >
          <img
            v-if="p.imageUrl"
            :src="poiMediaUrlById(p.id)"
            :alt="poiName(p)"
            class="size-14 flex-none rounded-[10px] object-cover"
            loading="lazy"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <div v-else class="flex size-14 flex-none items-center justify-center rounded-[10px] bg-nv-surface-low">
            <component :is="catIcon(p.category)" class="size-6" :style="{ color: categoryStyle(p.category).color }" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate font-medium text-nv-on-surface">{{ poiName(p) }}</span>
            </div>
            <p
              v-if="start && p.lat != null && p.lon != null"
              class="mt-0.5 text-[11px] text-nv-on-surface-variant"
            >
              <span>≈ {{ distanceFromStart(p).minutes }} мин</span>
              <span class="opacity-60"> · </span>
              <span>{{ fmtDistance(distanceFromStart(p).meters) }} от вас</span>
            </p>
          </div>
          <span class="flex flex-none items-center">
            <CheckCircle v-if="isInCart(p.id)" class="size-5 text-nv-tertiary" />
            <PlusCircle v-else class="size-5 text-nv-on-surface-variant" />
          </span>
        </button>
      </div>
    </section>

    <!-- Per-category departments (shown when a specific tab is selected) -->
    <section v-for="d in departments" v-show="activeTab === d.cat" :key="d.cat" class="mt-4">
      <p class="nv-eyebrow mb-2 flex items-center gap-1">
        <component :is="catIcon(d.cat)" class="size-3.5 shrink-0" :style="{ color: d.style.color }" />
        {{ d.style.labelLong }} · {{ d.items.length }}
      </p>
      <div class="space-y-2">
        <button
          v-for="p in d.items"
          :key="p.id"
          class="flex w-full items-stretch gap-2.5 rounded-xl border bg-nv-surface-lowest p-2 text-left transition-transform active:scale-[0.99]"
          :class="isInCart(p.id) ? 'border-nv-tertiary bg-nv-tertiary-container/15' : 'border-nv-outline-variant/60'"
          @click="addPoi(p)"
        >
          <img
            v-if="p.imageUrl"
            :src="poiMediaUrlById(p.id)"
            :alt="poiName(p)"
            class="size-14 flex-none rounded-[10px] object-cover"
            loading="lazy"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <div v-else class="flex size-14 flex-none items-center justify-center rounded-[10px] bg-nv-surface-low">
            <component :is="catIcon(d.cat)" class="size-6" :style="{ color: d.style.color }" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate font-medium text-nv-on-surface">{{ poiName(p) }}</span>
              <span v-if="p.popularityScore" class="flex-shrink-0 text-xs text-nv-secondary">★ {{ Math.round(p.popularityScore) }}</span>
            </div>
            <p v-if="p.description" class="nv-hint mt-0.5 line-clamp-2 text-xs">{{ p.description }}</p>
            <!-- Distance + travel-time hint. The user complained that the
                 previous version felt like "items dropped in randomly" —
                 a concrete "≈ 12 мин / 1.0 км от вас" anchors each item
                 to the start and gives the wizard a "storefront" feel. -->
            <p
              v-if="start && p.lat != null && p.lon != null"
              class="mt-0.5 text-[11px] text-nv-on-surface-variant"
            >
              <span>≈ {{ distanceFromStart(p).minutes }} мин</span>
              <span class="opacity-60"> · </span>
              <span>{{ fmtDistance(distanceFromStart(p).meters) }} от вас</span>
            </p>
          </div>
          <span class="flex flex-none items-center">
            <CheckCircle v-if="isInCart(p.id)" class="size-5 text-nv-tertiary" />
            <PlusCircle v-else class="size-5 text-nv-on-surface-variant" />
          </span>
        </button>
      </div>
    </section>

    <button v-if="serverSource && itinerary.draft.value" type="button" class="fixed bottom-[calc(76px+var(--safe-bottom))] left-1/2 z-40 min-h-11 -translate-x-1/2 rounded-full bg-nv-primary px-5 font-semibold text-nv-on-primary shadow-lg" aria-label="Открыть план путешествия" @click="showDraftSheet = true">План · {{ itinerary.draft.value.places.length }}</button>
    <ItineraryDraftSheet
      v-model:open="showDraftSheet"
      :draft="itinerary.draft.value"
      :preferred-categories="Array.from(active)"
      editable-topology
      :loading="itinerary.loading.value"
      :error="itinerary.error.value"
      @mode="(placeId, mode, custom) => itinerary.setVisitMode(placeId, mode, custom)"
      @lock="(placeId, locked) => itinerary.setLocked(placeId, locked)"
      @remove="removeDraftPlace"
      @budget-mode="handleBudgetMode"
      @topology="handleTopology"
      @pick-finish="handlePickFinish"
      @clear-finish="handleClearFinish"
      @apply-smart-fix="handleSmartFix"
      @accept-addition="(id) => itinerary.acceptAddition(id)"
      @replace-place="(id) => itinerary.replacePlace(id)"
      @accept-replacement="(id) => itinerary.acceptReplacement(id)"
      @select-alternative="handleAlternative"
      @auto-fill="handleAutoFill"
      @undo="handleUndo"
      @publish="handlePublish"
      @download-gpx="handleDownloadGpx"
    />

    <!-- Legacy cart stays only as a safe fallback when custom pins cannot migrate. -->
    <transition name="slide-up">
    <div v-if="!serverSource && cartList.length > 0" class="cart-drawer max-h-[65dvh] overflow-y-auto">
      <div class="flex gap-1.5 overflow-x-auto px-4 scrollbar-none scroll-smooth" style="scroll-padding-left: 1rem">
        <span
          v-for="p in cartList"
          :key="p.id"
          class="inline-flex flex-none cursor-pointer items-center gap-1 rounded-full border border-nv-tertiary/50 bg-nv-tertiary-container/40 px-2.5 py-1.5 text-xs text-nv-on-surface"
          @click="removeFromCart(p.id)"
        >
          <component :is="catIcon(p.category)" class="size-3.5 shrink-0" />
          {{ p.name }}
          <X class="size-3.5 shrink-0" />
        </span>
      </div>
      <!-- "Add my location" button — quick way to drop a custom waypoint
           in the cart without picking from the catalog. Uses the device's
           current geolocation. -->
      <button
        v-if="!serverSource"
        class="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-dashed border-nv-outline-variant/60 px-3 py-1.5 text-xs font-medium text-nv-on-surface-variant hover:border-nv-primary/60 hover:text-nv-primary"
        @click="addMyLocation"
      >
        <MapPin class="size-3.5" />
        Добавить мою геолокацию
      </button>

      <!-- Budget bar -->
      <div v-if="!serverSource" class="mt-2 h-1 overflow-hidden rounded-full bg-nv-outline-variant/50">
        <div
          class="h-full rounded-full transition-[width] duration-300"
          :class="overBudget ? 'bg-nv-error' : 'bg-nv-tertiary'"
          :style="{ width: budgetUsedPct + '%' }"
        ></div>
      </div>
      <p
        v-if="!serverSource"
        class="mt-1.5 text-center text-xs"
        :class="overBudget ? 'text-nv-error' : 'text-nv-on-surface-variant'"
      >
        <template v-if="planning">Считаем маршрут…</template>
        <template v-else-if="plan">
          {{ fmtDistance(plan.distance) }} · {{ fmtDuration(plan.duration) }}
          <span v-if="overBudget"> · перебор на {{ planMin - budgetMin }} мин</span>
        </template>
        <template v-else>{{ cart.count.value }} в корзине · бюджет {{ budgetMin }} мин</template>
      </p>
      <!-- Sightseeing time — shown separately from the travel budget so the
           bar stays honest about travel, but the user still sees the real
           total (e.g. «+25 мин на 5 остановок»). Only when there are stops
           and we're not in the planning spinner state. -->
      <p
        v-if="!serverSource && visitMin > 0 && !planning"
        class="mt-0.5 text-center text-[11px] text-nv-on-surface-variant/80"
      >
        +{{ visitMin }} мин на {{ cart.count.value }} {{ plural(cart.count.value) }} (осмотр)
      </p>
    </div>
    </transition>
    </template>
  </div>
</template>

<style scoped>
/* Fixed cart drawer — Tailwind can't easily handle fixed+max-width */
.cart-drawer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 600;
  background: rgb(var(--nv-surface-lowest) / 0.97);
  backdrop-filter: blur(12px);
  border-top: 1px solid rgb(var(--nv-outline-variant) / 0.6);
  padding: 10px 12px calc(88px + var(--safe-bottom));
  max-width: 640px;
  margin: 0 auto;
}
.scrollbar-none {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 250ms ease, opacity 200ms ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
