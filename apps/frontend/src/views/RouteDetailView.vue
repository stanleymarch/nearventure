<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import maplibregl from 'maplibre-gl';
import { extractLineCoordinates, unwrapGeometry } from '../lib/geojson-utils';
import { CATEGORY_STYLES } from '@/lib/poi-categories';
import { formatDistance, formatDuration } from '@/lib/utils';
import ShareButton from '@/components/ShareButton.vue';
import Icon from '@/components/Icon.vue';
import { getPois, poiMediaUrlById, poiName } from '@/api/pois';

const route = useRoute();
const router = useRouter();

const routeId = route.params.id as string;
const currentUrl = ref('');
const loading = ref(true);
const error = ref<string | null>(null);

// Route data structure
interface RouteDetail {
  id: string;
  title: string | null;
  routeData: {
    geojson: any;
    distance: number;
    duration: number;
    ascend: number;
    descend: number;
  };
  pois: {
    id: string;
    name: string;
    category: string;
    lat: number;
    lon: number;
    hasMedia?: boolean;
    descRu: string | null;
  }[];
  profile: 'bike' | 'foot' | 'car';
  startPoint: { lat: number; lon: number };
  createdAt: string;
  options: { loop: boolean | null; optimize: boolean };
  expiresAt?: string | null;
}

const detail = ref<RouteDetail | null>(null);

/** Suggested POIs near the route's start point — fetched on load so the
 * user can extend the route by tapping a card (opens the miniapp wizard
 * with the POI pre-added via `?poi=<uuid>`). */
interface NearbyPoi {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  imageUrl: string | null;
  descRu: string | null;
}
const nearbyPois = ref<NearbyPoi[]>([]);
const nearbyLoading = ref(false);
const unavailableRouteMediaIds = ref(new Set<string>());

function routePoiMediaUrl(poi: RouteDetail['pois'][number]): string | null {
  return poi.hasMedia === true && !unavailableRouteMediaIds.value.has(poi.id)
    ? poiMediaUrlById(poi.id)
    : null;
}

function hideRoutePoiMedia(id: string) {
  unavailableRouteMediaIds.value = new Set([...unavailableRouteMediaIds.value, id]);
}

function miniappLink(poi: NearbyPoi): string {
  const sp = detail.value?.startPoint;
  const params = new URLSearchParams();
  params.set('poi', poi.id);
  if (sp) {
    params.set('lat', String(sp.lat));
    params.set('lon', String(sp.lon));
  }
  if (detail.value?.profile) params.set('profile', detail.value.profile);
  return `${window.location.origin}/tg/#/wizard?${params.toString()}`;
}

function mapPoiLink(poi: RouteDetail['pois'][number]): string {
  const params = new URLSearchParams({
    poi: poi.id,
    lat: String(poi.lat),
    lng: String(poi.lon),
  });
  return `/#/map?${params.toString()}`;
}

// Mini-map on the route detail page
const mapContainer = ref<HTMLDivElement | null>(null);
let routeMap: maplibregl.Map | null = null;



const profileLabels: Record<string, string> = {
  bike: 'Велосипед',
  foot: 'Пешком',
  car: 'Авто',
};

const profileIcons: Record<string, string> = {
  bike: 'directions_bike',
  foot: 'directions_walk',
  car: 'directions_car',
};

function difficultyLabel(distance: number): string {
  if (distance < 10000) return 'Лёгкий';
  if (distance < 30000) return 'Средний';
  return 'Сложный';
}

function difficultyColor(distance: number): string {
  if (distance < 10000) return 'rgb(var(--nv-tertiary))';
  if (distance < 30000) return 'rgb(var(--nv-primary))';
  return 'rgb(var(--nv-error))';
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return dateStr; }
}

function categoryStyle(cat: string) {
  return CATEGORY_STYLES[cat as keyof typeof CATEGORY_STYLES];
}

function downloadGpx() {
  // TODO: call GET /api/routes/:id/gpx
  window.open(`/api/routes/${routeId}/gpx`, '_blank');
}

function goBack() {
  router.back();
}

/** Share the current route (native API or clipboard fallback). */
async function shareTelegram() {
  if (!detail.value) return;
  const botLink = `https://t.me/nearventure_bot?start=route_${routeId}`;
  window.open(botLink, '_blank', 'noopener,noreferrer');
}

/** Initialise the mini route map on the detail page. */
function initRouteMap() {
  if (!mapContainer.value || !detail.value?.routeData?.geojson) return;
  // Destroy previous map instance (re-run on data update)
  if (routeMap) {
    routeMap.remove();
    routeMap = null;
  }
  const data = detail.value.routeData;

  // Collect route coordinates [lng, lat] for bounds + line layer.
  // Handles both bare geometry and Feature wrapper (API returns Feature).
  const routeCoords = extractLineCoordinates(data.geojson);

  const hasCoords = routeCoords.length >= 2;
  const center: [number, number] = hasCoords ? routeCoords[0] : [49.6679, 58.6035];

  const map = new maplibregl.Map({
    container: mapContainer.value!,
    style: {
      version: 8,
      sources: {
        cyclosm: {
          type: 'raster',
          tiles: ['https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 20,
        },
      },
      layers: [{ id: 'cyclosm', type: 'raster', source: 'cyclosm' }],
    },
    center,
    zoom: 13,
    interactive: true,
    scrollZoom: false, // prevent accidental zoom on scroll-through
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));

  map.on('load', () => {
    // Route line
    if (hasCoords) {
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: routeCoords }, properties: {} },
      });
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#9b4500', 'line-width': 4, 'line-opacity': 0.85 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      });
    }

    // POI markers
    if (detail.value?.pois) {
      for (const poi of detail.value.pois) {
        const s = categoryStyle(poi.category);
        const color = (s?.color as string) || '#888';
        const el = document.createElement('div');
        el.style.cssText = `display:flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);`;
        new maplibregl.Marker({ element: el }).setLngLat([poi.lon, poi.lat]).addTo(map);
        routeCoords.push([poi.lon, poi.lat]);
      }
    }

    // Fit viewport
    if (routeCoords.length >= 2) {
      const bounds = routeCoords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(routeCoords[0], routeCoords[1]),
      );
      map.fitBounds(bounds, { padding: 40 });
    }
  });

  routeMap = map;
}

// ── Feedback (POST /api/routes/:id/feedback) ──────────────────────────────
// Public, no login. Dedup is by a stable per-browser anonymousId stored in
// localStorage (one review per visitor per route → 409 on the second attempt).
const feedbackRating = ref(0);
const feedbackHover = ref(0);
const feedbackComment = ref('');
const feedbackOsm = ref<boolean | null>(null);
const feedbackOsmNote = ref('');
const feedbackSubmitting = ref(false);
const feedbackSubmitted = ref(false);
const feedbackError = ref<string | null>(null);

function getAnonymousId(): string {
  const KEY = 'nv_anonymous_id';
  const existing = localStorage.getItem(KEY);
  if (existing) return existing;
  const c = (crypto as any);
  const id = c?.randomUUID
    ? c.randomUUID()
    : 'a' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(KEY, id);
  return id;
}

async function submitFeedback() {
  if (!feedbackRating.value || feedbackSubmitting.value) return;
  feedbackSubmitting.value = true;
  feedbackError.value = null;
  try {
    const res = await fetch(`/api/routes/${routeId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: feedbackRating.value,
        comment: feedbackComment.value.trim() || undefined,
        osmContributor: feedbackOsm.value ?? undefined,
        osmContributionNote: feedbackOsmNote.value.trim() || undefined,
        anonymousId: getAnonymousId(),
      }),
    });
    if (res.status === 409) {
      feedbackError.value = 'Вы уже оставляли отзыв на этот маршрут.';
      feedbackSubmitted.value = true; // treat as done
    } else if (res.status === 404) {
      feedbackError.value = 'Маршрут не найден — проверить ссылку?';
    } else if (!res.ok) {
      feedbackError.value = 'Не удалось отправить отзыв. Попробуйте позже.';
    } else {
      feedbackSubmitted.value = true;
    }
  } catch {
    feedbackError.value = 'Сеть недоступна — проверьте подключение.';
  } finally {
    feedbackSubmitting.value = false;
  }
}

/** Склонение «звезда» для 1..5. */
function pluralStar(n: number): string {
  if (n === 1) return 'звезда';
  if (n >= 2 && n <= 4) return 'звезды';
  return 'звёзд';
}

/** Извлечение высот из координат GeoJSON для графика профиля. */
const elevationData = computed(() => {
  const data = detail.value?.routeData;
  if (!data?.geojson) return null;
  // Unwrap Feature wrapper and extract raw coordinates.
  const geom = unwrapGeometry(data.geojson);
  if (!geom?.coordinates || !Array.isArray(geom.coordinates)) return null;
  const coords = geom.coordinates as number[][];
  const elevations: number[] = [];
  for (const c of coords) {
    if (c.length >= 3 && c[2] != null && typeof c[2] === 'number' && !isNaN(c[2])) {
      elevations.push(c[2]);
    }
  }
  if (elevations.length < 2) return null;
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const peakIdx = elevations.indexOf(max);
  return { values: elevations, min, max, start: elevations[0], end: elevations[elevations.length - 1], peakIdx };
});

/** SVG path для профиля высот (viewBox 400×140). */
const elevationProfilePath = computed(() => {
  const d = elevationData.value;
  if (!d) return '';
  const { values, min, max } = d;
  const range = Math.max(max - min, 1);
  const w = 400, h = 140, pad = 5;
  const step = w / (values.length - 1);
  return values.map((v, i) => {
    const x = i * step;
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
});

/** X/Y-координаты вершины (для метки пика). */
const peakPoint = computed(() => {
  const d = elevationData.value;
  if (!d) return { x: 0, y: 0 };
  const { values, min, max } = d;
  const range = Math.max(max - min, 1);
  const w = 400, h = 140, pad = 5;
  const step = w / (values.length - 1);
  const x = d.peakIdx * step;
  const y = h - pad - ((max - min) / range) * (h - 2 * pad);
  return { x, y };
});

onMounted(async () => {
  try {
    // Fetch route from API
    const res = await fetch(`/api/routes/${routeId}`);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const json = await res.json();
    // API returns { route: RouteEntity, anonymousId } — normalise to RouteDetail
    const r = json.route || json;
    if (r && r.id) {
      detail.value = {
        id: r.id,
        title: r.title || null,
        routeData: {
          geojson: r.geojson || { type: 'LineString', coordinates: [] },
          distance: r.distance || 0,
          duration: r.duration || 0,
          ascend: r.ascend || 0,
          descend: r.descend || 0,
        },
        pois: (r.pois || []).map((p: any) => ({
          id: p.id,
          name: p.name || 'Без названия',
          category: p.category || 'sights',
          lat: p.lat,
          lon: p.lon,
          hasMedia: p.hasMedia === true,
          descRu: p.description || p.descRu || null,
        })),
        profile: r.transport || 'bike',
        // Route entity has no startPoint column — derive from the first
        // coordinate of the stored geometry so the mini-map, elevation graph
        // and the "nearby" section use the real origin (not a hardcoded city).
        startPoint: (() => {
          const c = extractLineCoordinates(r.geojson)[0]; // [lng, lat]
          return r.startPoint || (c ? { lat: c[1], lon: c[0] } : { lat: 58.6, lon: 49.68 });
        })(),
        createdAt: r.createdAt || new Date().toISOString(),
        expiresAt: r.expiresAt || null,
        options: {
          loop: typeof r.options?.loop === 'boolean'
            ? r.options.loop
            : typeof r.loop === 'boolean'
              ? r.loop
              : null,
          optimize: r.options?.optimize === true,
        },
      };
    } else {
      throw new Error('Invalid route data');
    }
  } catch (e: any) {
    detail.value = null;
    error.value = e?.status === 404
      ? 'Маршрут не найден или ссылка истекла.'
      : 'Не удалось загрузить маршрут. Проверьте соединение и попробуйте позже.';
  } finally {
    currentUrl.value = window.location.href;
    loading.value = false;
    // Only real server data may unlock the map, nearby suggestions and route actions.
    if (!detail.value) return;
    await nextTick();
    initRouteMap();
    // Fetch nearby POIs around the route's start point (suggested
    // extensions). Best-effort — silently ignored on failure.
    const sp = detail.value.startPoint;
    if (sp) {
      nearbyLoading.value = true;
      const d = 0.04; // ~4.5 km
      const bbox = `${(sp.lon - d).toFixed(5)},${(sp.lat - d).toFixed(5)},${(sp.lon + d).toFixed(5)},${(sp.lat + d).toFixed(5)}`;
      getPois({ bbox, limit: 6, sort: 'popularity' })
        .then((res) => {
          nearbyPois.value = (res.items || []).map((p) => ({
            id: p.id,
            name: poiName(p),
            category: p.category,
            lat: p.lat,
            lon: p.lon,
            imageUrl: p.imageUrl || null,
            descRu: p.descRu || null,
          }));
        })
        .catch(() => {})
        .finally(() => { nearbyLoading.value = false; });
    }
  }
});
</script>

<template>
  <div class="route-detail-page">
    <a href="#main-content" class="skip-link">Перейти к содержимому</a>

    <!-- Nav -->
    <header
      class="sticky top-0 z-50 backdrop-blur-xl border-b"
      style="background: rgb(var(--nv-surface-lowest) / 0.8); border-color: rgb(var(--nv-outline-variant) / 0.3)"
    >
      <div class="max-w-[1200px] mx-auto px-6 md:px-16 py-3 flex items-center justify-between">
        <button class="flex items-center gap-2 text-sm font-semibold" style="color: rgb(var(--nv-on-surface-variant))" @click="goBack">
          <Icon name="arrow_back" />
          Назад
        </button>
        <div v-if="detail" class="flex items-center gap-2">
          <button class="flex items-center gap-2 px-3 py-2 rounded-full text-sm font-semibold" style="background: rgb(var(--nv-surface-low) / 0.8); border: 1px solid rgb(var(--nv-outline-variant)); color: rgb(var(--nv-on-surface))" @click="downloadGpx">
            <Icon name="download" filled style="color: rgb(var(--nv-primary))" />
            GPX
          </button>
          <ShareButton
            :url="currentUrl"
            :title="detail?.title || 'Маршрут Nearventure'"
            :text="`${detail?.title || 'Маршрут'} — ${detail ? formatDistance(detail.routeData.distance) : ''} · ${detail ? formatDuration(detail.routeData.duration) : ''}`"
            label="Поделиться"
          />
        </div>
      </div>
    </header>

    <main id="main-content">
      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center min-h-[50vh]">
        <div class="flex flex-col items-center gap-3">
          <Icon name="progress_activity" filled class="text-3xl animate-spin" style="color: rgb(var(--nv-primary))" />
          <p class="text-sm font-semibold" style="color: rgb(var(--nv-on-surface-variant))">Загружаем маршрут…</p>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="flex items-center justify-center min-h-[50vh]">
        <div class="text-center">
          <Icon name="error" filled class="text-4xl" style="color: rgb(var(--nv-error))" />
          <p class="mt-3 font-semibold" style="color: rgb(var(--nv-on-surface))">{{ error }}</p>
          <button class="btn-primary mt-6" @click="goBack">Вернуться</button>
        </div>
      </div>

      <!-- Route detail -->
      <template v-else-if="detail">
        <div class="max-w-[1200px] mx-auto px-6 md:px-16 pt-8">
          <!-- Route title & meta (no hero) -->
          <div class="flex items-center gap-3 mb-8">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider" style="background: rgb(var(--nv-primary) / 0.12); color: rgb(var(--nv-primary))">
              <Icon :name="profileIcons[detail.profile]" filled class="text-sm" />
              {{ profileLabels[detail.profile] }} · {{ difficultyLabel(detail.routeData.distance) }}
            </div>
            <h1 class="text-3xl md:text-4xl font-extrabold leading-tight" style="color: rgb(var(--nv-on-surface))">
              {{ detail.title || 'Маршрут' }}
            </h1>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-12 gap-8">
            <!-- Left column: Stats + Actions -->
            <div class="md:col-span-4 space-y-4">
              <!-- Stats card -->
              <div class="surface-card p-6 space-y-4">
                <h3 class="font-bold flex items-center gap-2" style="color: rgb(var(--nv-primary))">
                  <Icon name="analytics" filled />
                  Параметры маршрута
                </h3>

                <div class="space-y-2">
                  <div class="flex items-center justify-between px-4 py-3 rounded-xl" style="background: rgb(var(--nv-surface-low) / 0.6)">
                    <div class="flex items-center gap-2 text-sm" style="color: rgb(var(--nv-on-surface-variant))">
                      <Icon name="schedule" />
                      <span>Время</span>
                    </div>
                    <span class="font-bold text-sm" style="color: rgb(var(--nv-on-surface))">{{ formatDuration(detail.routeData.duration) }}</span>
                  </div>
                  <div class="flex items-center justify-between px-4 py-3 rounded-xl" style="background: rgb(var(--nv-surface-low) / 0.6)">
                    <div class="flex items-center gap-2 text-sm" style="color: rgb(var(--nv-on-surface-variant))">
                      <Icon name="route" />
                      <span>Дистанция</span>
                    </div>
                    <span class="font-bold text-sm" style="color: rgb(var(--nv-on-surface))">{{ formatDistance(detail.routeData.distance) }}</span>
                  </div>
                  <div class="flex items-center justify-between px-4 py-3 rounded-xl" style="background: rgb(var(--nv-surface-low) / 0.6)">
                    <div class="flex items-center gap-2 text-sm" style="color: rgb(var(--nv-on-surface-variant))">
                      <Icon name="trending_up" />
                      <span>Набор высоты</span>
                    </div>
                    <span class="font-bold text-sm text-emerald-700 dark:text-emerald-400">+{{ Math.round(detail.routeData.ascend) }} м</span>
                  </div>
                  <div class="flex items-center justify-between px-4 py-3 rounded-xl" style="background: rgb(var(--nv-surface-low) / 0.6)">
                    <div class="flex items-center gap-2 text-sm" style="color: rgb(var(--nv-on-surface-variant))">
                      <Icon name="trending_down" />
                      <span>Спуск</span>
                    </div>
                    <span class="font-bold text-sm text-orange-600 dark:text-orange-400">−{{ Math.round(detail.routeData.descend) }} м</span>
                  </div>
                  <div class="flex items-center justify-between px-4 py-3 rounded-xl" style="background: rgb(var(--nv-surface-low) / 0.6)">
                    <div class="flex items-center gap-2 text-sm" style="color: rgb(var(--nv-on-surface-variant))">
                      <Icon name="signal_cellular_alt" />
                      <span>Сложность</span>
                    </div>
                    <span
                      class="px-3 py-0.5 rounded-full text-xs font-bold"
                      :style="{
                        background: difficultyColor(detail.routeData.distance) + '20',
                        color: difficultyColor(detail.routeData.distance)
                      }"
                    >
                      {{ difficultyLabel(detail.routeData.distance) }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Action buttons -->
              <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button class="btn-primary flex-1 sm:flex-none sm:min-w-[9rem]" @click="downloadGpx">
                  <Icon name="download" filled />
                  <span class="sm:inline">Скачать GPX</span>
                </button>
                <button class="btn-primary flex-1 sm:flex-none sm:min-w-[9rem]" @click="shareTelegram">
                  <Icon name="send" filled style="color: #0088cc" />
                  <span class="sm:inline">В Telegram</span>
                </button>
              </div>

              <!-- Expiry notice -->
              <p v-if="detail.expiresAt" class="mt-2 text-[11px] leading-snug" style="color: rgb(var(--nv-on-surface-variant))">
                <Icon name="schedule" class="inline size-3 -mt-0.5" />
                Ссылка активна до {{ formatDate(detail.expiresAt) }}
                После этого маршрут будет удалён, GPX у вас останется.
              </p>
            </div>

            <!-- Right column: Description + POIs + Map -->
            <div class="md:col-span-8 space-y-8">
              <!-- About -->
              <section>
                <h2 class="text-2xl font-extrabold mb-4" style="color: rgb(var(--nv-on-surface))">О маршруте</h2>
                <p class="text-base leading-relaxed" style="color: rgb(var(--nv-on-surface-variant))">
                  Маршрут построен <strong style="color: rgb(var(--nv-on-surface))">{{ formatDate(detail.createdAt) }}</strong>
                  для {{ profileLabels[detail.profile]?.toLowerCase() }}.
                  {{ detail.options.loop === true ? 'Кольцевой маршрут, возвращает в точку старта.' : detail.options.loop === false ? 'Линейный маршрут.' : 'Тип маршрута не указан.' }}
                  {{ detail.options.optimize ? 'Порядок точек оптимизирован.' : '' }}
                </p>
              </section>

              <!-- POIs -->
              <section v-if="detail.pois.length">
                <h3 class="text-xl font-bold mb-4 flex items-center gap-2" style="color: rgb(var(--nv-on-surface))">
                  <Icon name="location_on" filled style="color: rgb(var(--nv-primary))" />
                  Точки интереса
                </h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <a
                    v-for="poi in detail.pois"
                    :key="poi.id"
                    :href="mapPoiLink(poi)"
                    target="_blank"
                    rel="noopener"
                    class="surface-card overflow-hidden group block focus:outline-none focus:ring-2 focus:ring-primary"
                    :aria-label="`Открыть «${poi.name}» на полной карте`"
                  >
                    <div class="relative aspect-[4/3] overflow-hidden">
                      <img
                        v-if="routePoiMediaUrl(poi)"
                        :src="routePoiMediaUrl(poi)!"
                        :alt="poi.name"
                        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                        @error="hideRoutePoiMedia(poi.id)"
                      />
                      <div
                        v-else
                        class="w-full h-full flex items-center justify-center"
                        :style="{ background: (categoryStyle(poi.category)?.container || 'rgb(var(--nv-surface-variant))') }"
                      >
                        <Icon :name="(categoryStyle(poi.category)?.icon || 'place')" filled class="text-3xl" :style="{ color: (categoryStyle(poi.category)?.color || 'rgb(var(--nv-outline))') }" />
                      </div>
                    </div>
                    <div class="p-4">
                      <div class="flex items-center gap-1.5 mb-1">
                        <Icon :name="(categoryStyle(poi.category)?.icon || 'place')" filled class="text-xs" :style="{ color: (categoryStyle(poi.category)?.color || 'rgb(var(--nv-primary))') }" />
                        <span class="text-xs" style="color: rgb(var(--nv-on-surface-variant))">{{ categoryStyle(poi.category)?.label || poi.category }}</span>
                      </div>
                      <h4 class="font-bold" style="color: rgb(var(--nv-on-surface))">{{ poi.name }}</h4>
                      <p v-if="poi.descRu" class="text-xs mt-1 line-clamp-2" style="color: rgb(var(--nv-on-surface-variant))">{{ poi.descRu }}</p>
                    </div>
                  </a>
                </div>
              </section>

              <!-- Suggested POIs near the start point (addable via miniapp) -->
              <section v-if="nearbyPois.length || nearbyLoading">
                <h3 class="text-xl font-bold mb-4 flex items-center gap-2" style="color: rgb(var(--nv-on-surface))">
                  <Icon name="compass" filled style="color: rgb(var(--nv-primary))" />
                  Рядом с началом маршрута
                </h3>
                <p class="text-sm mb-4" style="color: rgb(var(--nv-on-surface-variant))">
                  Точки, которые можно добавить в свой маршрут — откроется мини-приложение с этой точкой в корзине.
                </p>
                <div v-if="nearbyLoading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div v-for="i in 3" :key="i" class="surface-card overflow-hidden">
                    <div class="aspect-[4/3] animate-pulse" style="background: rgb(var(--nv-surface-variant))" />
                    <div class="p-4 space-y-2">
                      <div class="h-4 w-2/3 rounded animate-pulse" style="background: rgb(var(--nv-surface-variant))" />
                      <div class="h-3 w-full rounded animate-pulse" style="background: rgb(var(--nv-surface-variant))" />
                    </div>
                  </div>
                </div>
                <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <a
                    v-for="sp in nearbyPois"
                    :key="sp.id"
                    :href="miniappLink(sp)"
                    class="surface-card overflow-hidden group block focus:outline-none focus:ring-2 focus:ring-primary"
                    target="_blank"
                    rel="noopener"
                    :aria-label="`Добавить «${sp.name}» в свой маршрут (откроется в Telegram)`"
                  >
                    <div class="relative aspect-[4/3] overflow-hidden" style="background: rgb(var(--nv-surface-variant))">
                      <img
                        v-if="sp.imageUrl"
                        :src="poiMediaUrlById(sp.id)"
                        :alt="sp.name"
                        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                      <div
                        v-else
                        class="w-full h-full flex items-center justify-center"
                        :style="{ background: (CATEGORY_STYLES[sp.category as keyof typeof CATEGORY_STYLES]?.container || 'rgb(var(--nv-surface-variant))') }"
                      >
                        <Icon name="map-pin" filled class="text-3xl" :style="{ color: (CATEGORY_STYLES[sp.category as keyof typeof CATEGORY_STYLES]?.color || 'rgb(var(--nv-primary))') }" />
                      </div>
                    </div>
                    <div class="p-4">
                      <h4 class="font-bold text-sm truncate" style="color: rgb(var(--nv-on-surface))">{{ sp.name }}</h4>
                      <p v-if="sp.descRu" class="text-xs mt-1 line-clamp-2" style="color: rgb(var(--nv-on-surface-variant))">{{ sp.descRu }}</p>
                      <span class="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold" style="color: rgb(var(--nv-primary))">
                        <Icon name="plus" class="size-3" />
                        Открыть в приложении
                      </span>
                    </div>
                  </a>
                </div>
              </section>

              <!-- Mini route map (MapLibre GL) -->
              <section>
                <div class="surface-card p-5">
                  <div class="flex items-center justify-between mb-3">
                    <h3 class="font-bold flex items-center gap-2" style="color: rgb(var(--nv-on-surface))">
                      <Icon name="map" filled style="color: rgb(var(--nv-primary))" />
                      Карта маршрута
                    </h3>
                    <button
                      class="text-xs font-semibold hover:underline"
                      style="color: rgb(var(--nv-secondary))"
                      @click="router.push('/map')"
                    >Открыть на полной карте</button>
                  </div>
                  <div
                    ref="mapContainer"
                    class="route-mini-map"
                    style="background: rgb(var(--nv-surface-variant))"
                  />
                </div>
              </section>

              <!-- Elevation profile (SVG inline) -->
              <section v-if="elevationData">
                <div class="surface-card p-5">
                  <div class="flex items-center justify-between mb-3">
                    <h3 class="font-bold flex items-center gap-2" style="color: rgb(var(--nv-on-surface))">
                      <Icon name="show_chart" filled style="color: rgb(var(--nv-primary))" />
                      Профиль высот
                    </h3>
                  </div>
                  <div class="relative w-full" style="height: 140px">
                    <svg
                      viewBox="0 0 400 140"
                      class="w-full h-full"
                      preserveAspectRatio="none"
                      style="overflow: visible"
                    >
                      <!-- Grid lines -->
                      <line x1="0" y1="0" x2="400" y2="0" stroke="rgb(var(--nv-outline-variant) / 0.25)" stroke-width="0.5" />
                      <line x1="0" y1="40" x2="400" y2="40" stroke="rgb(var(--nv-outline-variant) / 0.25)" stroke-width="0.5" />
                      <line x1="0" y1="80" x2="400" y2="80" stroke="rgb(var(--nv-outline-variant) / 0.25)" stroke-width="0.5" />
                      <line x1="0" y1="120" x2="400" y2="120" stroke="rgb(var(--nv-outline-variant) / 0.4)" stroke-width="0.5" />
                      <!-- Elevation line -->
                      <path
                        :d="elevationProfilePath"
                        fill="none"
                        stroke="rgb(var(--nv-primary))"
                        stroke-width="2"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                      />
                      <!-- Y-axis: Max elevation (top left) -->
                      <text x="2" y="8" font-size="9" fill="rgb(var(--nv-primary))" font-weight="bold" font-family="system-ui">{{ elevationData.max }} м</text>
                      <!-- Y-axis: Min elevation (bottom left) -->
                      <text x="2" y="134" font-size="8" fill="rgb(var(--nv-on-surface-variant))" font-family="system-ui">{{ elevationData.min }} м</text>
                      <!-- X-axis: Start distance (bottom left) -->
                      <text x="0" y="134" font-size="8" fill="rgb(var(--nv-on-surface-variant))" font-family="system-ui">0 км</text>
                      <!-- X-axis: End distance (bottom right) -->
                      <text x="400" y="134" font-size="8" text-anchor="end" fill="rgb(var(--nv-on-surface-variant))" font-family="system-ui">{{ (detail!.routeData.distance / 1000).toFixed(1) }} км</text>
                    </svg>
                  </div>

                </div>
              </section>
            </div>
          </div>
        </div>

        <!-- Feedback -->
        <section class="max-w-[1200px] mx-auto px-6 md:px-16 mt-12 md:mt-16 pb-16">
          <div class="surface-card p-6 md:p-10 max-w-3xl mx-auto">
            <h2 class="text-2xl md:text-3xl font-extrabold mb-2 flex items-center gap-3" style="color: rgb(var(--nv-on-surface))">
              <Icon name="reviews" filled style="color: rgb(var(--nv-primary))" />
              Как вам маршрут?
            </h2>
            <p class="text-sm md:text-base mb-6" style="color: rgb(var(--nv-on-surface-variant))">
              Поделитесь впечатлением — это поможет другим путешественникам и сделает проект лучше. Без регистрации.
            </p>

            <!-- Success -->
            <div v-if="feedbackSubmitted && !feedbackError" class="rounded-2xl p-6 text-center" style="background: rgb(var(--nv-tertiary-container) / 0.3); border: 1px solid rgb(var(--nv-tertiary) / 0.35)">
              <Icon name="check_circle" filled class="text-4xl" style="color: rgb(var(--nv-tertiary))" />
              <p class="font-bold mt-2" style="color: rgb(var(--nv-on-surface))">Спасибо за отзыв!</p>
              <p class="text-sm mt-1" style="color: rgb(var(--nv-on-surface-variant))">Мы учли вашу оценку.</p>
            </div>

            <!-- Already reviewed / dedup -->
            <div v-else-if="feedbackError && feedbackSubmitted" class="rounded-2xl p-6 text-center" style="background: rgb(var(--nv-surface-low))">
              <Icon name="how_to_reg" filled class="text-3xl" style="color: rgb(var(--nv-secondary))" />
              <p class="font-semibold mt-2" style="color: rgb(var(--nv-on-surface))">{{ feedbackError }}</p>
            </div>

            <!-- Form -->
            <form v-else @submit.prevent="submitFeedback" class="space-y-5">
              <!-- Stars -->
              <div>
                <p class="text-sm font-semibold mb-2" style="color: rgb(var(--nv-on-surface))">Оценка</p>
                <div class="flex gap-1">
                  <button
                    v-for="n in 5"
                    :key="n"
                    type="button"
                    class="nv-star"
                    :class="{ 'nv-star--on': n <= (feedbackHover || feedbackRating) }"
                    :aria-label="`${n} ${pluralStar(n)}`"
                    @click="feedbackRating = n"
                    @mouseenter="feedbackHover = n"
                    @mouseleave="feedbackHover = 0"
                  >
                    <Icon name="star" :filled="n <= (feedbackHover || feedbackRating)" />
                  </button>
                </div>
              </div>

              <!-- Comment -->
              <div>
                <label class="block text-sm font-semibold mb-2" style="color: rgb(var(--nv-on-surface))" for="fb-comment">
                  Комментарий <span style="color: rgb(var(--nv-outline))">(необязательно)</span>
                </label>
                <textarea
                  id="fb-comment"
                  v-model="feedbackComment"
                  rows="3"
                  maxlength="4000"
                  class="input-base resize-y"
                  placeholder="Что понравилось, что стоит улучшить…"
                />
              </div>

              <!-- OSM contribution -->
              <div>
                <p class="text-sm font-semibold mb-2" style="color: rgb(var(--nv-on-surface))">Уже правили открытые данные (OpenStreetMap и др.)?</p>
                <div class="flex gap-2">
                  <button type="button" class="chip" :data-active="feedbackOsm === true" @click="feedbackOsm = feedbackOsm === true ? null : true">
                    <Icon name="check" :filled="feedbackOsm === true" />Да
                  </button>
                  <button type="button" class="chip" :data-active="feedbackOsm === false" @click="feedbackOsm = feedbackOsm === false ? null : false">
                    <Icon name="close" :filled="feedbackOsm === false" />Нет
                  </button>
                </div>
                <textarea
                  v-if="feedbackOsm === true"
                  v-model="feedbackOsmNote"
                  rows="2"
                  maxlength="1000"
                  class="input-base resize-y mt-3"
                  placeholder="Чем планируете делиться? (необязательно)"
                />
              </div>

              <p v-if="feedbackError" class="text-sm font-semibold" style="color: rgb(var(--nv-error))">{{ feedbackError }}</p>

              <button type="submit" class="btn-primary w-full md:w-auto px-8 py-3" :disabled="feedbackSubmitting || !feedbackRating">
                <Icon :name="feedbackSubmitting ? 'progress_activity' : 'send'" :filled="!feedbackSubmitting" :class="feedbackSubmitting ? 'animate-spin' : ''" />
                {{ feedbackSubmitting ? 'Отправляю…' : 'Отправить отзыв' }}
              </button>
            </form>
          </div>
        </section>
      </template>
    </main>

    <!-- Footer -->
    <footer class="pt-10 pb-6 mt-12" style="background: rgb(var(--nv-surface-lowest)); border-top: 1px solid rgb(var(--nv-outline-variant) / 0.3)">
      <div class="max-w-[1200px] mx-auto px-6 md:px-16 flex flex-col md:flex-row items-center justify-between gap-4">
        <div class="flex items-center gap-2 text-sm font-bold" style="color: rgb(var(--nv-on-surface-variant))">
          <Icon name="explore" filled style="color: rgb(var(--nv-primary))" />
          Nearventure
        </div>
        <p class="text-xs" style="color: rgb(var(--nv-on-surface-variant))">
          © 2026 Nearventure · Данные © OpenStreetMap contributors
        </p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.skip-link {
  position: absolute;
  top: -100%;
  left: 1rem;
  padding: 0.5rem 1rem;
  background: rgb(var(--nv-primary));
  color: rgb(var(--nv-on-primary));
  border-radius: 0.5rem;
  z-index: 100;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
  transition: top 0.2s ease;
}
.skip-link:focus {
  top: 1rem;
}

.route-detail-page {
  min-height: 100vh;
  /* Ensure the page scrolls naturally even with sticky header + tall content */
  overflow-y: auto;
  overflow-x: hidden;
}

/* Ensure the main content area scrolls if route-detail-page is constrained */
.route-detail-page > main {
  overflow-y: visible;
}

/* Mini route map */
.route-mini-map {
  width: 100%;
  height: 320px;
  border-radius: 0.75rem;
  overflow: hidden;
}

/* Prevent map from trapping scroll events — scrollZoom:false in JS is not enough
   if the map canvas captures pointer events. Allow native wheel scroll through. */
.route-mini-map canvas.maplibregl-canvas {
  touch-action: pan-x pan-y;
}

/* ⭐ feedback stars */
.nv-star {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 9999px;
  color: rgb(var(--nv-outline));
  cursor: pointer;
  transition: transform 0.1s, color 0.15s, background 0.15s;
  border: none; background: transparent;
}
.nv-star:hover .ms-icon { transform: scale(1.12); }
.nv-star--on { color: rgb(var(--nv-primary)) !important; background: rgb(var(--nv-primary) / 0.1); }
.nv-star .ms-icon { font-size: 32px; display: inline-flex; transition: transform 0.15s; }

@media (prefers-reduced-motion: reduce) {
  .skip-link {
    transition: none;
  }
}
</style>
