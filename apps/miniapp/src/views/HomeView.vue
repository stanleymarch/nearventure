<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useTelegram } from '@/composables/useTelegram';
import { useBotShortcut } from '@/composables/useBotShortcut';
import { getPoiCount } from '@/api';
import { Route, Navigation, Compass } from 'lucide-vue-next';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';

const router = useRouter();
const { user, haptic, hideBackButton } = useTelegram();
useBotShortcut('start');

const poiCount = ref<number | null>(null);

onMounted(async () => {
  // At the SPA root there's no "back" to go to — hiding the native back
  // button is the honest UX (otherwise tapping it does nothing and users
  // only see "Close").
  hideBackButton();
  try {
    poiCount.value = (await getPoiCount()).total;
  } catch {
    poiCount.value = null;
  }
});

function go(name: string) {
  haptic.impact('light');
  router.push({ name });
}
</script>

<template>
  <div class="space-y-5">
    <!-- Hero greeting -->
    <header class="pt-2">
      <p class="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
        Nearventure
      </p>
      <h1 class="text-2xl font-display font-semibold text-foreground mt-1">
        {{ user?.first_name ? `Привет, ${user.first_name}!` : 'Готовы к микро-приключению?' }}
      </h1>
      <p class="text-sm text-muted-foreground mt-2">
        Пара свободных часов — построим вело- или пеший маршрут по местам, которые вы ещё не видели.
      </p>
      <p v-if="poiCount != null" class="text-sm text-muted-foreground mt-1">
        В базе {{ poiCount.toLocaleString('ru-RU') }} мест в Вятском крае.
      </p>
    </header>

    <!-- Primary action -->
    <Card
      class="w-full cursor-pointer active:scale-[0.99] transition p-5 flex items-center gap-4"
      style="background-color: rgb(var(--nv-primary)); border-color: transparent"
      role="button"
      tabindex="0"
      @click="go('wizard')"
      @keydown.enter="go('wizard')"
    >
      <Route class="size-8 text-primary-foreground shrink-0" />
      <div class="flex-1">
        <CardTitle class="text-primary-foreground text-lg">Построить маршрут</CardTitle>
        <CardDescription class="text-primary-foreground/80">Точка старта и время — остальное подберём</CardDescription>
      </div>
    </Card>

    <!-- Secondary actions -->
    <div class="grid grid-cols-2 gap-3">
      <Card class="cursor-pointer active:scale-[0.98] transition p-4" role="button" tabindex="0" @click="go('nearby')" @keydown.enter="go('nearby')">
        <Navigation class="size-7 text-nv-secondary" />
        <CardTitle class="mt-2 text-base font-medium">Что рядом</CardTitle>
        <CardDescription>Объекты вокруг вас</CardDescription>
      </Card>
      <RouterLink
        :to="{ name: 'catalog' }"
        class="block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nv-tertiary focus-visible:ring-offset-2"
        @click="haptic.impact('light')"
      >
        <Card class="h-full p-4 transition active:scale-[0.98]">
          <Compass class="size-7 text-nv-tertiary" />
          <CardTitle class="mt-2 text-base font-medium">Открыть каталог</CardTitle>
          <CardDescription>Все места</CardDescription>
        </Card>
      </RouterLink>
    </div>

  </div>
</template>
