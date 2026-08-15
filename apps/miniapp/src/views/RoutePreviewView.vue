<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Landmark, Medal, Mountain, Church, TreePine, Building2,
  ChevronRight, Share2, Route,
} from 'lucide-vue-next';
import { useTelegram } from '@/composables/useTelegram';
import { useBotShortcut } from '@/composables/useBotShortcut';
import type { BuiltRoute } from '@/composables/useBuiltRoute';
import { fetchGpx, startGuideFromMiniApp, getRoutingHealth, VISIT_MIN_PER_POI, type RoutingHealth } from '@/composables/useRouting';
import { createLatestRequestGate, isRoutingProfileAvailable } from '@shared/api/routing-contracts';
import { useItineraryDraft } from '@/composables/useItineraryDraft';
import { fmtDistance, fmtDuration } from '@/composables/useGeo';
import { categoryStyle } from '@/lib/poi-categories';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PreviewMap from '@/components/PreviewMap.vue';
import ItinerarySummary from '@/components/itinerary/ItinerarySummary.vue';
import RouteEvidence from '@shared/components/route/RouteEvidence.vue';

const route = useRoute();
const router = useRouter();
const { showBackButton, setMainButton, hideMainButton, mainButtonProgress, haptic, alert } =
  useTelegram();
useBotShortcut('start');
const itinerary = useItineraryDraft();
const routingHealth = ref<RoutingHealth | null>(null);
const routingStatus = ref<'checking' | 'ready' | 'unavailable'>('checking');
const canRequestRouting = computed(() => {
  const draft = itinerary.draft.value;
  return routingStatus.value === 'ready' && !!draft && isRoutingProfileAvailable(draft.profile as any, routingHealth.value);
});
itinerary.setRoutingGuard(
  () => canRequestRouting.value,
  () => { void alert(routingStatus.value === 'unavailable' ? 'Маршрутизатор недоступен. Повторите проверку и попробуйте снова.' : 'Проверяем маршрутизатор. Подождите немного.'); },
);
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
  } catch {
    if (!healthRequestGate.isCurrent(token)) return;
    routingHealth.value = { available: false, profiles: [] };
    routingStatus.value = 'unavailable';
  }
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

const r = ref<BuiltRoute | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const draftId = ref<string | null>(null);

let backCleanup: (() => void) | undefined;
let mainCleanup: (() => void) | undefined;

onMounted(async () => {
  backCleanup = showBackButton(() => window.history.back());
  await Promise.all([init(), checkRoutingHealth()]);
});
onUnmounted(() => {
  backCleanup?.();
  mainCleanup?.();
  hideMainButton();
});

async function init() {
  // An explicit draft id is authoritative. Never replace a failed requested
  // route with a previous in-memory route from another trip.
  const routeDraftId = route.params.id as string | undefined;
  const q = route.query;
  const requestedDraftId = routeDraftId || String(q.draftId || '').trim();
  if (requestedDraftId) {
    draftId.value = requestedDraftId;
    const hydrated = await itinerary.hydrate(requestedDraftId);
    if (hydrated?.route) {
      buildFromDraft(hydrated);
      setupMain();
      loading.value = false;
      return;
    }
    loading.value = false;
    error.value = 'Запрошенный маршрут не найден или больше недоступен.';
    return;
  }
  // Preview actions require a canonical draft id. A legacy in-memory route or
  // chat cache is deliberately not loaded here: it cannot identify the route
  // that guide/share must operate on.
  // Legacy inputs may prefill conditions, but they never bypass the explicit
  // transport/time/topology preflight.
  if (q.lat && q.lon) {
    await router.replace({ name: 'wizard', query: { ...q, mode: 'auto' } });
    loading.value = false;
    return;
  }
  loading.value = false;
  error.value = 'Маршрут не найден. Откройте или соберите маршрут заново, чтобы сохранить его в плане.';
}

function buildFromDraft(draft: { quality?: BuiltRoute['quality']; route?: { geojson: { type: 'Feature'; geometry: { type: string; coordinates: number[][] } | null; properties: Record<string, unknown> }; distance: number; duration: number; ascend: number; descend: number; profile: string; bbox?: [number, number, number, number]; quality?: BuiltRoute['quality']; roadFacts?: BuiltRoute['roadFacts'] }; places: { name: string; pois: { id: string; name: string; category: string; lat: number; lon: number }[] }[] }) {
  if (!draft.route) return;
  r.value = {
    geojson: draft.route.geojson,
    distance: draft.route.distance,
    duration: draft.route.duration,
    ascend: draft.route.ascend,
    descend: draft.route.descend,
    profile: draft.route.profile,
    bbox: draft.route.bbox,
    quality: draft.route.quality ?? draft.quality,
    roadFacts: draft.route.roadFacts,
    pois: draft.places.flatMap((place, idx) =>
      place.pois.map(poi => ({ id: poi.id, name: poi.name, category: poi.category, lat: poi.lat, lon: poi.lon, order: idx }))
    ),
  };
}

function setupMain() {
  mainCleanup?.();
  if (!r.value) return;
  mainCleanup = setMainButton({ text: '⬇ Скачать GPX', onClick: downloadGpx });
}

async function downloadGpx() {
  if (!r.value) return;
  haptic.impact('light');
  mainButtonProgress(true);
  try {
    const name = `Nearventure — ${fmtDistance(r.value.distance)}`;
    const blob = await fetchGpx(r.value, name);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nearventure-${Math.round(r.value.distance / 1000)}km.gpx`;
    a.click();
    URL.revokeObjectURL(url);
    haptic.notify('success');
  } catch (e: any) {
    haptic.notify('error');
    await alert('Не удалось собрать GPX. Попробуйте ещё раз.');
  } finally {
    mainButtonProgress(false);
  }
}

async function startGuide() {
  const draft = itinerary.draft.value;
  if (!draftId.value || !draft || !draft.route || !draft.totals.feasible || !draft.places.length) {
    await alert('Экскурсия доступна только для готового сохранённого плана. Откройте маршрут из списка и дождитесь расчёта.');
    return;
  }
  haptic.impact('light');
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) {
    await alert('Не удалось получить данные Telegram. Откройте мини-приложение из чата с ботом.');
    return;
  }
  try {
    const result = await startGuideFromMiniApp(initData, draftId.value, draft.version);
    if (!result.ok) {
      haptic.notify('error');
      await alert(result.error === 'unready-route'
        ? 'Маршрут изменён или ещё не готов. Обновите план и дождитесь расчёта.'
        : 'Не удалось запустить экскурсию. Обновите план и попробуйте ещё раз.');
      return;
    }
    haptic.notify('success');
    await alert('🚶 Экскурсия запущена!\n\nОткройте чат с ботом — первая координата уже ждёт.');
    window.Telegram?.WebApp?.close();
  } catch (e: any) {
    haptic.notify('error');
    const message = e?.response?.data?.message;
    await alert(message === 'stale-draft' ? 'План был изменён. Обновите экран и запустите экскурсию снова.' : 'Не удалось запустить экскурсию. Попробуйте ещё раз.');
  }
}

async function share() {
  const draft = itinerary.draft.value;
  if (!draft?.publishedRouteId) {
    await alert('Сначала сохраните готовый маршрут кнопкой «Сохранить». После этого появится публичная ссылка для отправки.');
    return;
  }
  haptic.impact('light');
  // Public routes are immutable read models. Never put an owner-scoped draft
  // id in a link a recipient can open.
  const url = `${window.location.origin}/#/route/${draft.publishedRouteId}`;
  const text = `Маршрут Nearventure — ${fmtDistance(r.value?.distance || 0)}, ${fmtDuration(r.value?.duration || 0)}`;
  if (navigator.share) {
    navigator.share({ title: 'Nearventure', text, url }).catch(() => navigator.clipboard?.writeText(`${text}\n${url}`));
  } else {
    navigator.clipboard?.writeText(`${text}\n${url}`);
    await alert('Скопировано в буфер обмена.');
  }
}

async function publish() {
  const draft = itinerary.draft.value;
  if (!draft?.route || !draft.totals.feasible || draft.publishedRouteId) return;
  const published = await itinerary.publish();
  if (published?.publishedRouteId) {
    haptic.notify('success');
    await alert('Маршрут сохранён. Теперь его можно отправить по публичной ссылке.');
  } else if (itinerary.error.value) {
    haptic.notify('error');
    await alert(itinerary.error.value);
  }
}

const ascend = computed(() => r.value?.ascend || 0);
const visitMin = computed(() => (r.value?.pois.length ?? 0) * VISIT_MIN_PER_POI);
</script>

<template>
  <div class="pb-24">
    <!-- Loading skeleton -->
    <Card v-if="loading" class="p-8 text-center">
      <div class="mx-auto mb-2 size-6 animate-spin rounded-full border-2 border-nv-primary border-t-transparent" />
      <p class="nv-hint">Строим маршрут…</p>
    </Card>

    <!-- Error -->
    <Card v-else-if="error" class="p-6 text-center space-y-3">
      <p class="nv-hint">{{ error }}</p>
      <Button variant="outline" @click="init">🔁 Попробовать снова</Button>
      <button class="block w-full font-medium text-nv-primary" @click="router.push({ name: 'catalog' })">
        В каталог
      </button>
    </Card>

    <!-- Empty state: no route found (opened standalone or route expired) -->
    <Card v-else-if="!r" class="p-6 text-center">
      <p class="text-base font-medium text-nv-on-surface">Маршрут не найден</p>
      <p class="nv-hint mt-2">
        Постройте маршрут в чате с ботом — кнопкой «🗺 Построить маршрут».
        Потом вернитесь сюда, и я покажу превью с картой и точками.
      </p>
      <div class="mt-4 flex flex-col gap-2">
        <Button @click="router.push({ name: 'wizard' })" class="w-full">
          🧭 Собрать маршрут вручную
        </Button>
        <Button variant="outline" @click="router.push({ name: 'home' })" class="w-full">
          В начало
        </Button>
      </div>
    </Card>

    <template v-else-if="r">
      <!-- Map (Leaflet — keep as-is per task) -->
      <PreviewMap :route="r" />

      <!-- Stats grid -->
      <div class="mt-3.5 grid grid-cols-4 gap-2">
        <Card class="p-2.5 text-center">
          <span class="block text-[15px] font-bold text-nv-on-surface">{{ fmtDistance(r.distance) }}</span>
          <span class="mt-0.5 block text-[11px] text-nv-on-surface-variant">дистанция</span>
        </Card>
        <Card class="p-2.5 text-center">
          <span class="block text-[15px] font-bold text-nv-on-surface">{{ fmtDuration(r.duration) }}</span>
          <span class="mt-0.5 block text-[11px] text-nv-on-surface-variant">в пути</span>
          <span v-if="visitMin" class="block text-[10px] text-nv-on-surface-variant/70">+{{ visitMin }} мин осмотр</span>
        </Card>
        <Card class="p-2.5 text-center">
          <span class="block text-[15px] font-bold text-nv-on-surface">↑{{ Math.round(ascend) }} м</span>
          <span class="mt-0.5 block text-[11px] text-nv-on-surface-variant">набор</span>
        </Card>
        <Card class="p-2.5 text-center">
          <span class="block text-[15px] font-bold text-nv-on-surface">{{ r.pois.length || '—' }}</span>
          <span class="mt-0.5 block text-[11px] text-nv-on-surface-variant">точек</span>
        </Card>
      </div>

      <RouteEvidence :quality="r.quality" :road-facts="r.roadFacts" :ascend="r.ascend" :descend="r.descend" />

      <!-- POI stops (hidden once the draft editor is mounted: it lists the same
           POIs and keeps them tappable via `view-poi`, so the flat duplicate
           would only waste the first screen). -->
      <section v-if="r.pois.length && !itinerary.draft.value" class="mt-4">
        <p class="nv-eyebrow mb-2">Точки маршрута</p>
        <ol class="space-y-2">
          <li
            v-for="(p, index) in r.pois"
            :key="p.id"
            class="flex cursor-pointer items-center gap-2.5 rounded-xl border border-nv-outline-variant/60 bg-nv-surface-lowest p-2.5"
            @click="haptic.impact('light'); router.push({ name: 'poi-detail', params: { id: p.id } })"
          >
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full border-2 bg-white/96 text-xs font-bold"
              :style="{ borderColor: categoryStyle(p.category).color, color: categoryStyle(p.category).color }"
            >{{ (p.order ?? index) + 1 }}</span>
            <component :is="catIcon(p.category)" class="size-[18px] shrink-0" :style="{ color: categoryStyle(p.category).color }" />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-nv-on-surface">{{ p.name }}</span>
              <span class="nv-hint block text-xs">{{ categoryStyle(p.category).label }}</span>
            </span>
            <ChevronRight class="size-4 shrink-0 text-nv-on-surface-variant" />
          </li>
        </ol>
      </section>

      <!-- Draft-based itinerary summary (when hydrated from draftId) -->
      <section v-if="itinerary.draft.value" class="mt-4">
        <p class="mb-2 text-xs text-nv-on-surface-variant" role="status" aria-live="polite">{{ routingStatus === 'checking' ? 'Проверяем маршрутизатор…' : routingStatus === 'unavailable' ? 'Маршрутизатор недоступен. Изменение маршрута временно недоступно.' : '' }}</p>
        <Button v-if="routingStatus === 'unavailable'" variant="outline" class="mb-2 min-h-11" @click="checkRoutingHealth">Повторить проверку маршрутизатора</Button>
        <ItinerarySummary
          :draft="itinerary.draft.value"
          :loading="itinerary.loading.value"
          :error="itinerary.error.value"
          @mode="(placeId, mode, custom) => itinerary.setVisitMode(placeId, mode, custom)"
          @lock="(placeId, locked) => itinerary.setLocked(placeId, locked)"
          @remove="(placeId) => itinerary.removePlace(placeId)"
          @budget-mode="mode => itinerary.updateSettings({ budgetMode: mode })"
          @apply-smart-fix="(suggestionId) => itinerary.applySmartFix(suggestionId)"
          @accept-addition="(suggestionId) => itinerary.acceptAddition(suggestionId)"
          @replace-place="(placeId) => itinerary.replacePlace(placeId)"
          @accept-replacement="(suggestionId) => itinerary.acceptReplacement(suggestionId)"
          @select-alternative="(alternativeId) => itinerary.selectAlternative(alternativeId)"
          @auto-fill="(categories, seed, preset) => itinerary.autoFill(categories, seed, preset)"
          @undo="() => itinerary.undo()"
          @publish="publish"
          @view-poi="(poiId) => { haptic.impact('light'); router.push({ name: 'poi-detail', params: { id: poiId } }); }"
        />
      </section>

      <!-- Secondary actions -->
      <div class="mt-4 grid grid-cols-2 gap-2.5">
        <Button variant="outline" class="flex flex-col gap-1 py-3.5 text-xs" @click="share">
          <Share2 class="size-5" />
          Поделиться
        </Button>
        <Button variant="outline" class="flex flex-col gap-1 py-3.5 text-xs" @click="startGuide">
          <Route class="size-5" />
          Экскурсия
        </Button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* All styles via Tailwind utilities */
</style>
