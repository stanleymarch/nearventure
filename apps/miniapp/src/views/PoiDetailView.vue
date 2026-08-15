<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTelegram } from '@/composables/useTelegram';
import { useBotShortcut } from '@/composables/useBotShortcut';
import { api } from '@/api';
import type { PoiDetail } from '@/api/poi-types';
import { applyPublicImagePolicy, poiDisplayName, poiMediaUrlById, sourceEntries, HERITAGE_LABELS } from '@/api/poi-types';
import { Globe, ExternalLink, Landmark, Loader2, MapPin, Plus } from 'lucide-vue-next';
import { formatYearCentury, formatLocation } from '@shared/lib/poi-meta';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { categoryStyle } from '@/lib/poi-categories';

const route = useRoute();
const router = useRouter();
const { showBackButton, setMainButton, hideMainButton, haptic, openLink } = useTelegram();
useBotShortcut('start');

function categoryLabel(cat: string): string {
  try { return categoryStyle(cat).label; } catch { return cat; }
}

const poi = ref<PoiDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
let backCleanup: (() => void) | undefined;
let mainCleanup: (() => void) | undefined;

async function load(id: string) {
  loading.value = true;
  error.value = null;
  try {
    // Raw fetch to get the full PoiRow (the shared getPois types are legacy).
    const res = await api.get<PoiDetail>(`/api/pois/${id}`);
    poi.value = applyPublicImagePolicy(res.data);
  } catch (e: any) {
    error.value = e?.response?.data?.message || 'Не удалось загрузить объект.';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  const id = String(route.params.id);
  backCleanup = showBackButton(() => window.history.back());
  await load(id);
  setupMainButton();
});

watch(
  () => route.params.id,
  async (id) => {
    if (id) {
      await load(String(id));
      setupMainButton();
    }
  },
);

onUnmounted(() => {
  backCleanup?.();
  mainCleanup?.();
  hideMainButton();
});

function setupMainButton() {
  mainCleanup?.();
  if (!poi.value) return;
  mainCleanup = setMainButton({
    text: 'Добавить в маршрут',
    onClick: addToRouteBuilder,
  });
}

function addToRouteBuilder() {
  if (!poi.value) return;
  haptic.impact('medium');
  router.push({ name: 'wizard', query: { poi: poi.value.id } });
}

function showOnMap() {
  if (!poi.value || poi.value.lat == null || poi.value.lon == null) return;
  haptic.impact('light');
  // Open the POI on an external map (OpenStreetMap). sendData was a
  // placeholder that sent data to the bot and closed the app with no
  // visible result — openLink shows the POI on a real map reliably.
  const { lat, lon } = poi.value;
  openLink(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`);
}

function openSource(url?: string) {
  if (!url) return;
  haptic.impact('light');
  openLink(url);
}
</script>

<template>
  <!-- Loading state -->
  <div v-if="loading" class="flex flex-col items-center justify-center py-20">
    <Loader2 class="size-6 text-muted-foreground animate-spin" />
    <p class="text-sm text-muted-foreground mt-3">Загружаем объект…</p>
  </div>

  <!-- Error state -->
  <Card v-else-if="error" class="p-6 text-center space-y-3">
    <CardDescription>{{ error }}</CardDescription>
    <Button variant="outline" @click="load(String(route.params.id))">Попробовать снова</Button>
  </Card>

  <!-- Main content -->
  <article v-else-if="poi" class="space-y-4 pb-4">
    <!-- Hero photo -->
    <Card v-if="poi.imageUrl || poi.imageAttribution || poi.imageSourceNotice" class="overflow-hidden">
      <img
        v-if="poi.imageUrl"
        :src="poiMediaUrlById(poi.id)"
        :alt="poiDisplayName(poi)"
        class="w-full h-56 object-cover"
        loading="lazy"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <div
        v-if="poi.imageAttribution || poi.imageSourceNotice"
        class="px-4 py-2 flex items-center gap-1 flex-wrap text-xs text-muted-foreground"
      >
        <template v-if="poi.imageAttribution">
          <span v-if="poi.imageAttribution.artist || poi.imageAttribution.credit">
            Фото: {{ poi.imageAttribution.artist || poi.imageAttribution.credit }}
          </span>
          <span v-else-if="poi.imageAttribution.source">Источник изображения: {{ poi.imageAttribution.source }}</span>
          <Button
            v-if="poi.imageAttribution.licenseUrl"
            variant="link"
            class="inline p-0 h-auto underline text-muted-foreground"
            @click="openLink(poi.imageAttribution!.licenseUrl!)"
          >
            {{ poi.imageAttribution.license || 'Лицензия' }}
          </Button>
          <span v-else-if="poi.imageAttribution.license">Лицензия: {{ poi.imageAttribution.license }}</span>
          <span v-if="poi.imageAttribution.notice" class="w-full">{{ poi.imageAttribution.notice }}</span>
        </template>
        <template v-if="poi.imageSourceNotice">
          <span v-if="poi.imageSourceNotice.source">Источник изображения: {{ poi.imageSourceNotice.source }}</span>
          <span v-if="poi.imageSourceNotice.notice" class="w-full">Сведения об источнике: {{ poi.imageSourceNotice.notice }}</span>
        </template>
      </div>
    </Card>

    <!-- Title block -->
    <header>
      <Badge variant="secondary" class="mb-2">{{ categoryLabel(poi.category) }}</Badge>
      <h1 class="text-2xl font-display font-semibold text-foreground leading-tight">
        {{ poiDisplayName(poi) }}
      </h1>
      <Badge
        v-if="poi.heritageSignificance && HERITAGE_LABELS[poi.heritageSignificance]"
        variant="outline"
        class="mt-2 gap-1.5 text-xs font-normal"
      >
        <Landmark class="size-3.5" />
        {{ HERITAGE_LABELS[poi.heritageSignificance] }}
      </Badge>
    </header>

    <!-- Description -->
    <Card v-if="poi.description">
      <CardContent class="p-4">
        <p class="text-sm text-foreground leading-relaxed">{{ poi.description }}</p>
      </CardContent>
    </Card>

    <!-- Location + construction date -->
    <Card>
      <CardContent class="p-4 flex flex-col gap-1.5">
        <div v-if="formatYearCentury(poi.year, poi.year_end)" class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">Год постройки</span>
          <span class="text-sm font-semibold text-foreground">{{ formatYearCentury(poi.year, poi.year_end) }}</span>
        </div>
        <div v-if="formatLocation(poi.region, poi.district, poi.city)" class="flex items-center justify-between gap-2">
          <span class="text-sm text-muted-foreground shrink-0">Регион</span>
          <span class="text-xs text-foreground text-right">{{ formatLocation(poi.region, poi.district, poi.city) }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">Координаты</span>
          <code class="text-xs text-foreground">{{ poi.lat.toFixed(5) }}, {{ poi.lon.toFixed(5) }}</code>
        </div>
      </CardContent>
    </Card>

    <!-- ── Full attribution (the signature section) ── -->
    <Card>
      <CardHeader class="p-4 pb-2">
        <CardDescription class="text-xs uppercase tracking-wider font-semibold">Источники данных</CardDescription>
      </CardHeader>
      <CardContent class="p-4 pt-0 space-y-0.5">
        <Button
          v-for="s in sourceEntries(poi)"
          :key="s.key"
          variant="ghost"
          class="w-full justify-between h-auto py-2 px-2"
          :disabled="!s.url"
          @click="openSource(s.url)"
        >
          <span class="flex items-center gap-2">
            <Globe class="size-4 text-nv-secondary shrink-0" />
            <span class="text-sm text-foreground">{{ s.label }}</span>
          </span>
          <ExternalLink v-if="s.url" class="size-4 text-muted-foreground shrink-0" />
        </Button>
        <p v-if="sourceEntries(poi).length === 0" class="text-xs text-muted-foreground px-2 py-2">
          Данные собраны из открытых источников. Детальная атрибуция будет добавлена.
        </p>
      </CardContent>
    </Card>

    <div class="grid grid-cols-2 gap-2">
      <Button class="min-h-12" @click="addToRouteBuilder">
        <Plus data-icon="inline-start" />Добавить
      </Button>
      <Button variant="outline" class="min-h-12" @click="showOnMap">
        <MapPin data-icon="inline-start" />На карте
      </Button>
    </div>

    <!-- Explicit image attribution and separately-labelled legacy source context. -->
    <Card v-if="poi.imageAttribution || poi.imageSourceNotice">
      <CardHeader class="p-4 pb-2">
        <CardDescription class="text-xs uppercase tracking-wider font-semibold">Фото</CardDescription>
      </CardHeader>
      <CardContent class="p-4 pt-0 space-y-1">
        <template v-if="poi.imageAttribution">
          <p v-if="poi.imageAttribution.artist || poi.imageAttribution.credit" class="text-sm text-foreground">
            Фото: {{ poi.imageAttribution.artist || poi.imageAttribution.credit }}
          </p>
          <p v-else-if="poi.imageAttribution.source" class="text-sm text-foreground">
            Источник изображения: {{ poi.imageAttribution.source }}
          </p>
          <p v-if="poi.imageAttribution.license" class="text-xs text-muted-foreground">
            Лицензия:
            <Button
              v-if="poi.imageAttribution.licenseUrl"
              variant="link"
              class="inline ml-1 p-0 h-auto underline text-muted-foreground"
              @click="openLink(poi.imageAttribution!.licenseUrl!)"
            >
              {{ poi.imageAttribution.license }}
            </Button>
            <span v-else>{{ poi.imageAttribution.license }}</span>
          </p>
          <p v-if="poi.imageAttribution.notice" class="text-xs text-muted-foreground">
            {{ poi.imageAttribution.notice }}
          </p>
        </template>
        <template v-if="poi.imageSourceNotice">
          <p v-if="poi.imageSourceNotice.source" class="text-sm text-foreground">
            Источник изображения: {{ poi.imageSourceNotice.source }}
          </p>
          <p v-if="poi.imageSourceNotice.notice" class="text-xs text-muted-foreground">
            Сведения об источнике: {{ poi.imageSourceNotice.notice }}
          </p>
        </template>
      </CardContent>
    </Card>
  </article>
</template>
