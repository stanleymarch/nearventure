<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { getPois, poiMediaUrlById, poiName, type Poi } from '@/api/pois';
import { CATEGORY_STYLES } from '@/lib/poi-categories';
import Icon from '@/components/Icon.vue';

const router = useRouter();
const pois = ref<Poi[]>([]);
const loading = ref(true);
const visible = ref(false);

onMounted(async () => {
  try {
    const res = await getPois({ sort: 'popularity', limit: 6 });
    pois.value = res.items;
  } catch {
    // silent
  } finally {
    loading.value = false;
    setTimeout(() => { visible.value = true; }, 100);
  }
});

function categoryStyle(cat: string): { icon: string; color: string; label: string; labelLong?: string } {
  return (CATEGORY_STYLES as any)[cat] || { icon: 'place', color: 'rgb(var(--nv-primary))', label: 'Точка' };
}

function goToPoi(poi: Poi) {
  router.push({ path: '/map', query: { poi: poi.id } });
}
</script>

<template>
  <section
    class="py-20 md:py-28 overflow-hidden transition-all duration-700"
    style="background: rgb(var(--nv-surface-lowest) / 0.5)"
    :class="visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'"
  >
    <div class="max-w-[1200px] mx-auto px-6 md:px-16">
      <div class="flex flex-col md:flex-row justify-between items-end gap-6 mb-12">
        <div>
          <h2 class="text-3xl md:text-4xl font-extrabold tracking-tight" style="color: rgb(var(--nv-on-surface))">
            Популярные места
          </h2>
          <p class="text-base mt-3" style="color: rgb(var(--nv-on-surface-variant))">
            Любимые точки интереса наших путешественников
          </p>
        </div>
      </div>

      <!-- Loading state -->
      <div v-if="loading" class="grid grid-cols-1 md:grid-cols-3 gap-5 min-h-[300px]">
        <div v-for="i in 6" :key="i"
          class="rounded-xl animate-pulse aspect-[4/3]"
          style="background: rgb(var(--nv-surface-variant))"
        />
      </div>

      <div
        v-else-if="pois.length"
        class="grid grid-cols-1 md:grid-cols-3 gap-5"
      >
        <div
          v-for="poi in pois"
          :key="poi.id"
          class="relative group rounded-xl overflow-hidden cursor-pointer aspect-[4/3]"
          style="box-shadow: 0 10px 30px -10px rgba(155, 69, 0, 0.15);"
          @click="goToPoi(poi)"
        >
          <!-- Background image or fallback gradient -->
          <div
            v-if="poi.imageUrl"
            class="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
            :style="{ backgroundImage: `url(${poiMediaUrlById(poi.id)})` }"
          />
          <div
            v-else
            class="absolute inset-0 transition-transform duration-500 group-hover:scale-105"
            :style="{
              background: `linear-gradient(135deg, ${categoryStyle(poi.category).color}44, ${categoryStyle(poi.category).color}22)`
            }"
          />

          <!-- Dark overlay at bottom -->
          <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

          <!-- Content -->
          <div class="absolute bottom-0 p-5 w-full">
            <div class="flex items-center gap-2 mb-1.5">
              <Icon
                :name="categoryStyle(poi.category).icon"
                filled
                class="text-sm"
                :style="{ color: categoryStyle(poi.category).color }"
              />
              <span class="text-white/80 text-xs font-bold uppercase tracking-wider">
                {{ (categoryStyle(poi.category) as any).labelLong || categoryStyle(poi.category).label }}
              </span>
            </div>
            <h3 class="text-white font-bold text-base truncate">{{ poiName(poi) }}</h3>
            <p v-if="poi.descRu" class="text-white/60 text-xs mt-1 line-clamp-1">{{ poi.descRu }}</p>
            <!-- Explicit image credits and separately-labelled legacy source context. -->
            <div
              v-if="poi.imageAttribution || poi.imageSourceNotice"
              class="text-white/55 text-[0.6rem] mt-2 leading-tight line-clamp-2"
            >
              <template v-if="poi.imageAttribution">
                <p v-if="poi.imageAttribution.artist || poi.imageAttribution.credit">
                  Фото: {{ poi.imageAttribution.artist || poi.imageAttribution.credit }}
                </p>
                <p v-else-if="poi.imageAttribution.source">Источник изображения: {{ poi.imageAttribution.source }}</p>
                <p v-if="poi.imageAttribution.license">
                  Лицензия:
                  <a
                    v-if="poi.imageAttribution.licenseUrl"
                    :href="poi.imageAttribution.licenseUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline hover:text-white/80"
                  >{{ poi.imageAttribution.license }}</a>
                  <span v-else>{{ poi.imageAttribution.license }}</span>
                </p>
                <p v-if="poi.imageAttribution.notice">{{ poi.imageAttribution.notice }}</p>
              </template>
              <template v-if="poi.imageSourceNotice">
                <p v-if="poi.imageSourceNotice.source">Источник изображения: {{ poi.imageSourceNotice.source }}</p>
                <p v-if="poi.imageSourceNotice.notice">Сведения об источнике: {{ poi.imageSourceNotice.notice }}</p>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="text-center py-12" style="color: rgb(var(--nv-on-surface-variant))">
        <Icon name="explore" filled class="text-4xl" style="color: rgb(var(--nv-outline))" />
        <p class="mt-3">Популярные места появятся здесь после первого сбора данных</p>
      </div>
    </div>
  </section>
</template>
