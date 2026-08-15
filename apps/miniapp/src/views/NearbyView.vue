<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useTelegram } from '@/composables/useTelegram';
import { useBotShortcut } from '@/composables/useBotShortcut';
import { api } from '@/api';
import { applyPublicImagePolicy, poiDisplayName, poiMediaUrlById } from '@/api/poi-types';
import type { PoiDetail } from '@/api/poi-types';
import { MapPin, Loader2 } from 'lucide-vue-next';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const { showBackButton, haptic } = useTelegram();
useBotShortcut('start');

const loading = ref(false);
const error = ref<string | null>(null);
const items = ref<Array<PoiDetail & { _dist?: number }>>([]);
const offset = ref(0);
const total = ref(0);
const PAGE = 8;
const RADIUS = 5000;
const loc = ref<{ lat: number; lon: number } | null>(null);
let backCleanup: (() => void) | undefined;

onMounted(() => {
  backCleanup = showBackButton(() => window.history.back());
  requestLocation();
});
onUnmounted(() => backCleanup?.());

async function requestLocation() {
  loading.value = true;
  error.value = null;
  try {
    const pos = await getPosition();
    loc.value = { lat: pos.lat, lon: pos.lon };
    await loadPage(0);
  } catch (e: any) {
    error.value = e?.message || 'Не удалось получить геолокацию.';
  } finally {
    loading.value = false;
  }
}

function getPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Геолокация недоступна в этом браузере.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(locError(e))),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

function locError(e: GeolocationPositionError): string {
  if (e.code === 1) return 'Доступ к геолокации запрещён. Разрешите его в настройках.';
  return 'Не удалось определить местоположение.';
}

async function loadPage(pageOffset: number) {
  if (!loc.value) return;
  loading.value = true;
  try {
    const res = await api.get<{ items: any[]; total: number }>('/api/pois', {
      params: {
        lat: loc.value.lat,
        lng: loc.value.lon,
        radius: RADIUS,
        sort: 'popularity',
        limit: PAGE,
        offset: pageOffset,
      },
    });
    const page = (res.data.items as any[]).map((p) => enrich(p, loc.value!));
    // Backend only supports sort=popularity. Sort the fetched page by
    // actual distance so the nearest objects appear first.
    page.sort((a, b) => (a._dist ?? Infinity) - (b._dist ?? Infinity));
    if (pageOffset === 0) items.value = page;
    else items.value = [...items.value, ...page];
    offset.value = pageOffset + page.length;
    total.value = res.data.total;
    if (page.length) haptic.selection();
  } catch (e: any) {
    error.value = e?.response?.data?.message || 'Ошибка загрузки объектов.';
  } finally {
    loading.value = false;
  }
}

function enrich(p: any, from: { lat: number; lon: number }): PoiDetail & { _dist?: number } {
  return { ...applyPublicImagePolicy(p), _dist: haversine(from, { lat: p.lat, lon: p.lon }) };
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} км` : `${Math.round(m)} м`;
}

function openPoi(id: string) {
  haptic.impact('light');
  window.location.hash = `#/poi/${id}`;
}

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
</script>

<template>
  <header class="mb-3">
    <p class="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Что рядом</p>
    <h1 class="text-xl font-display font-semibold text-foreground">В радиусе {{ RADIUS / 1000 }} км</h1>
  </header>

  <!-- Error state -->
  <Card v-if="error" class="p-5">
    <CardDescription>{{ error }}</CardDescription>
    <Button variant="link" class="mt-3 h-auto p-0" @click="requestLocation">Повторить</Button>
  </Card>

  <!-- Empty state -->
  <Card v-else-if="!loading && items.length === 0" class="p-6">
    <CardDescription>Поблизости ничего не нашлось. Попробуйте другой район или увеличьте радиус.</CardDescription>
  </Card>

  <!-- Skeleton loaders (initial load) -->
  <div v-if="loading && items.length === 0" class="space-y-3">
    <div
      v-for="n in 3"
      :key="n"
      class="rounded-lg border bg-card text-card-foreground shadow-sm animate-pulse flex overflow-hidden"
    >
      <div class="w-24 h-24 bg-muted flex-shrink-0" />
      <div class="p-3 flex-1 space-y-2">
        <div class="flex items-baseline justify-between gap-2">
          <div class="h-4 bg-muted rounded w-3/4" />
          <div class="h-3 bg-muted rounded w-12" />
        </div>
        <div class="h-3 bg-muted rounded w-1/3" />
        <div class="h-3 bg-muted rounded w-full" />
      </div>
    </div>
  </div>

  <!-- POI cards -->
  <div class="space-y-3">
    <Card
      v-for="p in items"
      :key="p.id"
      class="w-full cursor-pointer overflow-hidden flex active:scale-[0.99] transition"
      role="button"
      tabindex="0"
      :aria-label="`Открыть ${p.name}`"
      @click="openPoi(p.id)"
      @keydown.enter="openPoi(p.id)"
    >
      <!-- Image or placeholder -->
      <img
        v-if="p.imageUrl"
        :src="poiMediaUrlById(p.id)"
        :alt="poiDisplayName(p)"
        class="w-24 h-24 object-cover flex-shrink-0"
        loading="lazy"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <div v-else class="w-24 h-24 flex-shrink-0 bg-muted flex items-center justify-center">
        <MapPin class="size-7 text-muted-foreground" />
      </div>
      <div class="p-3 flex-1 min-w-0">
        <div class="flex items-baseline justify-between gap-2">
          <CardTitle class="text-sm font-medium truncate">{{ poiDisplayName(p) }}</CardTitle>
          <span v-if="p._dist != null" class="text-xs text-nv-secondary shrink-0">{{
            fmtDist(p._dist)
          }}</span>
        </div>
        <Badge variant="secondary" class="mt-1 text-[0.65rem] px-1.5 py-0">{{ p.category }}</Badge>
        <CardDescription v-if="p.description" class="mt-1 line-clamp-2">{{ p.description }}</CardDescription>
      </div>
    </Card>
  </div>

  <!-- Load more -->
  <Button
    v-if="offset < total"
    variant="ghost"
    class="w-full py-6 mt-2"
    :disabled="loading"
    @click="loadPage(offset)"
  >
    <Loader2 v-if="loading" class="size-4 animate-spin" />
    {{ loading ? 'Загрузка…' : 'Загрузить ещё' }}
  </Button>

  <p v-if="items.length > 0" class="text-center text-xs text-muted-foreground mt-4">
    Показано {{ items.length }} из {{ total }}
  </p>
</template>
