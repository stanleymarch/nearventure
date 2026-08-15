<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import LandingHero from '@/components/landing/LandingHero.vue';
import LandingPopularPois from '@/components/landing/LandingPopularPois.vue';
import Icon from '@/components/Icon.vue';
import { getPoiCount } from '@/api/pois';

const router = useRouter();
const visible = ref(false);
/** Live POI count from /api/pois/count — keeps the landing copy honest after
 *  data refreshes instead of drifting to a hardcoded number. */
const poiCount = ref<number | null>(null);

onMounted(async () => {
  try {
    const { total } = await getPoiCount();
    poiCount.value = total;
  } catch {
    // Keep the copy readable even if the API is unavailable.
  }
});
/** ru-RU grouping ("30 455") for display. */
const poiCountLabel = () => poiCount.value?.toLocaleString('ru-RU') ?? null;

onMounted(() => {
  setTimeout(() => { visible.value = true; }, 50);
});

function startAdventure() {
  router.push('/map');
}

function scrollToAbout() {
  document.querySelector('#about')?.scrollIntoView({ behavior: 'smooth' });
}

// IntersectionObserver for fade-in sections
onMounted(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('opacity-100', 'translate-y-0');
          entry.target.classList.remove('opacity-0', 'translate-y-8');
        }
      });
    },
    { threshold: 0.1 }
  );
  document.querySelectorAll('.section-animate').forEach((el) => observer.observe(el));
});
</script>

<template>
  <div class="landing-page" :class="{ 'landing-page--mounted': visible }">
    <a href="#main-content" class="skip-link">Перейти к содержимому</a>

    <!-- Hero (asymmetric split) -->
    <LandingHero :poi-count="poiCount" />

    <main id="main-content">
      <!-- ============================================================ -->
      <!-- КАК ЭТО РАБОТАЕТ — one compact horizontal flow, not 2 cards  -->
      <!-- ============================================================ -->
      <section id="about" class="section-animate py-20 md:py-28 opacity-0 translate-y-8 transition-all duration-700">
        <div class="max-w-[1200px] mx-auto px-6 md:px-16">
          <h2 class="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-3" style="color: rgb(var(--nv-on-surface))">
            Как это работает
          </h2>
          <p class="text-base mb-12 max-w-2xl" style="color: rgb(var(--nv-on-surface-variant))">
            Два режима, один результат — готовый маршрут с GPX.
          </p>

          <!-- 3-step horizontal flow (different from the card grids below) -->
          <div class="flex flex-col md:flex-row gap-8 md:gap-4 items-stretch max-w-4xl">
            <div class="flex-1 flex flex-col gap-3">
              <span class="inline-flex items-center justify-center w-10 h-10 rounded-control text-sm font-bold" style="background: rgb(var(--nv-primary)); color: rgb(var(--nv-on-primary))">
                <Icon name="clock" filled class="text-lg" />
              </span>
              <h3 class="font-bold text-lg" style="color: rgb(var(--nv-on-surface))">Укажите время</h3>
              <p class="text-sm leading-relaxed" style="color: rgb(var(--nv-on-surface-variant))">
                Сколько свободных часов — от получаса до полного дня.
              </p>
            </div>
            <div class="hidden md:grid place-items-center pt-5">
              <Icon name="arrow_forward" filled class="text-2xl" style="color: rgb(var(--nv-outline-variant))" />
            </div>
            <div class="flex-1 flex flex-col gap-3">
              <span class="inline-flex items-center justify-center w-10 h-10 rounded-control text-sm font-bold" style="background: rgb(var(--nv-secondary)); color: rgb(var(--nv-on-secondary))">
                <Icon name="layers" filled class="text-lg" />
              </span>
              <h3 class="font-bold text-lg" style="color: rgb(var(--nv-on-surface))">Выберите, что интересно</h3>
              <p class="text-sm leading-relaxed" style="color: rgb(var(--nv-on-surface-variant))">
                Озёра, церкви, усадьбы, смотровые — или отметьте точки сами.
              </p>
            </div>
            <div class="hidden md:grid place-items-center pt-5">
              <Icon name="arrow_forward" filled class="text-2xl" style="color: rgb(var(--nv-outline-variant))" />
            </div>
            <div class="flex-1 flex flex-col gap-3">
              <span class="inline-flex items-center justify-center w-10 h-10 rounded-control text-sm font-bold" style="background: rgb(var(--nv-tertiary)); color: rgb(var(--nv-on-tertiary))">
                <Icon name="route" filled class="text-lg" />
              </span>
              <h3 class="font-bold text-lg" style="color: rgb(var(--nv-on-surface))">Скачайте GPX</h3>
              <p class="text-sm leading-relaxed" style="color: rgb(var(--nv-on-surface-variant))">
                Готовый маршрут — в навигатор, на Garmin или в телефон.
              </p>
            </div>
          </div>

          <div class="mt-10">
            <button class="btn-primary px-8 py-3 text-base" @click="startAdventure">
              <Icon name="map" filled />
              Попробовать на карте
            </button>
          </div>
        </div>
      </section>

      <!-- ============================================================ -->
      <!-- ПОПУЛЯРНЫЕ МЕСТА — photo grid (different composition)         -->
      <!-- ============================================================ -->
      <LandingPopularPois />

      <!-- ============================================================ -->
      <!-- ПОВЕРХНОСТИ — split layout (web + telegram, not equal cards) -->
      <!-- ============================================================ -->
      <section class="section-animate py-20 md:py-28 opacity-0 translate-y-8 transition-all duration-700">
        <div class="max-w-[1200px] mx-auto px-6 md:px-16">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
            <!-- Left (2 cols): web -->
            <div class="md:col-span-2 space-y-4">
              <h2 class="text-3xl md:text-4xl font-display font-extrabold tracking-tight" style="color: rgb(var(--nv-on-surface))">
                В браузере и в Telegram
              </h2>
              <p class="text-base md:text-lg leading-relaxed max-w-xl" style="color: rgb(var(--nv-on-surface-variant))">
                Полная карта с слоями и планированием — на сайте.
                Telegram-бот отправляет готовый маршрут и GPX прямо в чат.
              </p>
              <div class="flex flex-wrap gap-3 pt-2">
                <button class="btn-primary px-6 py-2.5" @click="startAdventure">
                  <Icon name="open_in_new" filled />
                  Открыть карту
                </button>
                <a
                  href="https://t.me/nearventure_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn-secondary px-6 py-2.5"
                  style="display: inline-flex"
                >
                  <Icon name="send" />
                  @nearventure_bot
                </a>
              </div>
            </div>
            <!-- Right (1 col): compact surface indicator -->
            <div class="space-y-3">
              <div class="surface-muted p-5 flex items-center gap-3">
                <div class="w-10 h-10 rounded-control grid place-items-center flex-shrink-0" style="background: rgb(var(--nv-primary) / 0.12)">
                  <Icon name="language" filled class="text-xl" style="color: rgb(var(--nv-primary))" />
                </div>
                <div>
                  <p class="font-bold text-sm" style="color: rgb(var(--nv-on-surface))">Веб-приложение</p>
                  <p class="text-xs" style="color: rgb(var(--nv-on-surface-variant))">Карта, слои, изохрона, GPX</p>
                </div>
              </div>
              <div class="surface-muted p-5 flex items-center gap-3">
                <div class="w-10 h-10 rounded-control grid place-items-center flex-shrink-0" style="background: rgb(var(--nv-secondary) / 0.12)">
                  <Icon name="send" filled class="text-xl" style="color: rgb(var(--nv-secondary))" />
                </div>
                <div>
                  <p class="font-bold text-sm" style="color: rgb(var(--nv-on-surface))">Telegram-бот</p>
                  <p class="text-xs" style="color: rgb(var(--nv-on-surface-variant))">Геолокация → маршрут → GPX</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============================================================ -->
      <!-- ОТКРЫТЫЕ ДАННЫЕ — separate block (per user request)           -->
      <!-- ============================================================ -->
      <section class="section-animate py-20 md:py-28 opacity-0 translate-y-8 transition-all duration-700">
        <div class="max-w-[900px] mx-auto px-6 md:px-16">
          <h2 class="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-6" style="color: rgb(var(--nv-on-surface))">
            Откуда данные
          </h2>
          <div class="space-y-5 text-base md:text-lg leading-relaxed" style="color: rgb(var(--nv-on-surface-variant))">
            <p>
              В основе каталога — только <strong style="color: rgb(var(--nv-on-surface))">открытые данные</strong>.
              Мы собираем их из четырёх источников и объединяем в одну карточку на объект:
            </p>
          </div>
          <div class="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="surface-muted p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-control grid place-items-center flex-shrink-0" style="background: rgb(var(--nv-tertiary) / 0.12)">
                <Icon name="public" filled class="text-lg" style="color: rgb(var(--nv-tertiary))" />
              </div>
              <div>
                <p class="font-bold text-sm" style="color: rgb(var(--nv-on-surface))">OpenStreetMap</p>
                <p class="text-xs" style="color: rgb(var(--nv-on-surface-variant))">Туризм, история, природа, инфраструктура</p>
              </div>
            </div>
            <div class="surface-muted p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-control grid place-items-center flex-shrink-0" style="background: rgb(var(--nv-secondary) / 0.12)">
                <Icon name="menu_book" filled class="text-lg" style="color: rgb(var(--nv-secondary))" />
              </div>
              <div>
                <p class="font-bold text-sm" style="color: rgb(var(--nv-on-surface))">Wikivoyage + Wikidata</p>
                <p class="text-xs" style="color: rgb(var(--nv-on-surface-variant))">Описания, фото, координаты, связи</p>
              </div>
            </div>
            <div class="surface-muted p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-control grid place-items-center flex-shrink-0" style="background: rgb(var(--nv-primary) / 0.12)">
                <Icon name="account_balance" filled class="text-lg" style="color: rgb(var(--nv-primary))" />
              </div>
              <div>
                <p class="font-bold text-sm" style="color: rgb(var(--nv-on-surface))">ЕГРКН (Минкульт)</p>
                <p class="text-xs" style="color: rgb(var(--nv-on-surface-variant))">Объекты культурного наследия</p>
              </div>
            </div>
            <div class="surface-muted p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-control grid place-items-center flex-shrink-0" style="background: rgb(var(--nv-tertiary) / 0.12)">
                <Icon name="photo_camera" filled class="text-lg" style="color: rgb(var(--nv-tertiary))" />
              </div>
              <div>
                <p class="font-bold text-sm" style="color: rgb(var(--nv-on-surface))">Wikimedia Commons</p>
                <p class="text-xs" style="color: rgb(var(--nv-on-surface-variant))">Фотографии под свободной лицензией</p>
              </div>
            </div>
          </div>
          <p class="mt-6 text-base leading-relaxed" style="color: rgb(var(--nv-on-surface-variant))">
            Карточки сохраняют источник и атрибуцию. Вклад путешественников в проверку объектов и добавление фото
            запланирован для следующего этапа проекта.
          </p>
        </div>
      </section>

      <!-- ============================================================ -->
      <!-- О ПРОЕКТЕ — text + region block (not centered cards)         -->
      <!-- ============================================================ -->
      <section class="section-animate py-20 md:py-28 opacity-0 translate-y-8 transition-all duration-700" style="background: rgb(var(--nv-surface-lowest) / 0.5)">
        <div class="max-w-[800px] mx-auto px-6 md:px-16">
          <h2 class="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-6" style="color: rgb(var(--nv-on-surface))">
            О проекте
          </h2>
          <div class="space-y-5 text-base md:text-lg leading-relaxed" style="color: rgb(var(--nv-on-surface-variant))">
            <p>
              <strong style="color: rgb(var(--nv-on-surface))">Nearventure</strong> — сервис для микро-путешествий.
              Он помогает за пару минут придумать маршрут на велосипеде или пешком,
              когда есть несколько свободных часов и желание увидеть что-то новое.
            </p>
            <p>
              Проект родился в Кировской области (Вятке) — отсюда название и любовь к краеведению.
              Сейчас работает по всему Приволжскому федеральному округу: 14 субъектов<span v-if="poiCountLabel()"> и <strong style="color: rgb(var(--nv-on-surface))">{{ poiCountLabel() }}</strong> объектов в каталоге</span>.
            </p>
            <p>
              Каталог собран из открытых источников. Как именно мы объединяем OpenStreetMap, ЕГРКН, Wikidata,
              Wikivoyage и Commons, описано в блоке выше.
            </p>
          </div>
        </div>
      </section>

      <!-- ============================================================ -->
      <!-- ФИНАЛЬНЫЙ CTA                                                 -->
      <!-- ============================================================ -->
      <section class="section-animate py-20 md:py-28 opacity-0 translate-y-8 transition-all duration-700">
        <div class="max-w-[800px] mx-auto px-6 md:px-16 text-center">
          <h2 class="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-4" style="color: rgb(var(--nv-on-surface))">
            Готовы отправиться?
          </h2>
          <p class="text-base mb-8" style="color: rgb(var(--nv-on-surface-variant))">
            Карта работает прямо в браузере. Ничего устанавливать не нужно.
          </p>
          <button class="btn-primary px-10 py-4 text-lg" @click="startAdventure">
            <Icon name="directions_bike" filled />
            Создать маршрут
          </button>
        </div>
      </section>
    </main>

    <!-- ============================================================ -->
    <!-- FOOTER                                                        -->
    <!-- ============================================================ -->
    <footer class="pt-12 pb-8" style="background: rgb(var(--nv-surface-lowest)); border-top: 1px solid rgb(var(--nv-outline-variant) / 0.3)">
      <div class="max-w-[1200px] mx-auto px-6 md:px-16">
        <div class="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
          <div class="flex items-center gap-3">
            <Icon name="explore" filled class="text-2xl" style="color: rgb(var(--nv-primary))" />
            <span class="font-display font-extrabold text-lg tracking-tight" style="color: rgb(var(--nv-on-surface))">Nearventure</span>
          </div>
          <div class="flex flex-wrap gap-6 text-sm font-semibold" style="color: rgb(var(--nv-on-surface-variant))">
            <a href="https://github.com/stanleymarch/nearventure" target="_blank" rel="noopener noreferrer" class="hover:underline">GitHub</a>
            <a href="#about" class="hover:underline" @click.prevent="scrollToAbout">О проекте</a>
            <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer" class="hover:underline">OpenStreetMap</a>
          </div>
        </div>
        <p class="text-center text-xs" style="color: rgb(var(--nv-on-surface-variant))">
          © 2026 Nearventure. Данные © OpenStreetMap contributors.
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

/* Entry animation */
.landing-page {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.landing-page--mounted {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .landing-page,
  .section-animate {
    transition: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
</style>
