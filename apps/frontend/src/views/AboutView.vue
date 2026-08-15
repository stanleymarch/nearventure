<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Icon from '@/components/Icon.vue';

const isMounted = ref(false);

onMounted(() => {
  setTimeout(() => {
    isMounted.value = true;
  }, 50);
});

const team = [
  {
    name: 'Станислав Ермоленко',
    role: 'Создатель проекта',
    telegram: 'https://t.me/staniverse',
    description: 'Разрабатывает Nearventure как открытый сервис для исследования Вятского края',
  },
];

const attributions = [
  {
    name: 'OpenStreetMap',
    url: 'https://www.openstreetmap.org',
    description: 'Базовая карта и данные о дорогах',
    icon: 'public',
  },
  {
    name: 'GraphHopper',
    url: 'https://www.graphhopper.com',
    description: 'Сервис маршрутизации',
    icon: 'route',
  },
  {
    name: 'Wikidata',
    url: 'https://www.wikidata.org',
    description: 'Структурированные данные о достопримечательностях',
    icon: 'dataset',
  },
  {
    name: 'Wikimedia Commons',
    url: 'https://commons.wikimedia.org',
    description: 'Фотографии достопримечательностей',
    icon: 'photo_library',
  },
  {
    name: 'ЕГРКН',
    url: 'https://culture.gov.ru',
    description: 'Единый государственный реестр объектов культурного наследия',
    icon: 'account_balance',
  },
];

const features = [
  {
    icon: 'code',
    title: 'Открытый исходный код',
    description: 'Проект доступен на GitHub под лицензией MIT',
  },
  {
    icon: 'offline_bolt',
    title: 'Автономная работа',
    description: 'Можете разместить приложение у себя на сервере',
  },
  {
    icon: 'nature_people',
    title: 'Локальный фокус',
    description: 'Специально разработан для Вятского региона',
  },
  {
    icon: 'privacy_tip',
    title: 'Приватность',
    description: 'Никакой отслеживания, данные остаются у вас',
  },
];

const contributeWays = [
  {
    icon: 'edit',
    title: 'Редактировать OSM',
    description: 'Добавляйте или обновляйте данные об объектах в OpenStreetMap',
    url: 'https://www.openstreetmap.org/edit',
  },
  {
    icon: 'photo_camera',
    title: 'Загружать фото',
    description: 'Добавляйте фотографии достопримечательностей в Wikimedia Commons',
    url: 'https://commons.wikimedia.org',
  },
  {
    icon: 'bug_report',
    title: 'Сообщать о проблемах',
    description: 'Сообщайте о багах и предлагайте улучшения на GitHub',
    url: 'https://github.com/vyatkatrails/nearventure/issues',
  },
  {
    icon: 'translate',
    title: 'Помогать с переводами',
    description: 'Добавляйте переводы на другие языки',
    url: 'https://github.com/vyatkatrails/nearventure',
  },
];
</script>

<template>
  <div class="about-page" :class="{ 'about-page--mounted': isMounted }">
    <!-- Skip link -->
    <a href="#main-content" class="skip-link">Перейти к содержимому</a>

    <!-- Header -->
    <header class="about-header">
      <nav class="about-nav">
        <a href="/" class="about-nav__brand">
          <Icon name="explore" filled />
          <span>Nearventure</span>
        </a>
        <a href="/" class="about-nav__link">
          <Icon name="arrow_back" />
          На главную
        </a>
      </nav>
    </header>

    <!-- Main content -->
    <main id="main-content">
      <!-- Hero -->
      <section class="about-hero">
        <div class="container">
          <h1 class="about-hero__title">О проекте Nearventure</h1>
          <p class="about-hero__subtitle">
            Открытый сервис для планирования веломаршрутов и пешеходных прогулок по Вятскому региону
          </p>
        </div>
      </section>

      <!-- What is Nearventure -->
      <section class="about-section">
        <div class="container">
          <div class="about-content">
            <div class="about-text">
              <h2 class="about-section__title">Что такое Nearventure</h2>
              <p class="about-paragraph">
                Nearventure — это открытый сервис для планирования веломаршрутов и пешеходных прогулок
                по всему ПФО (Приволжскому федеральному округу). Приложение использует открытые данные OpenStreetMap и локальные источники
                для построения маршрутов через исторические памятники и природные достопримечательности.
              </p>
              <p class="about-paragraph">
                Проект создан для любителей исследования Вятского края. Бесплатный сервис с открытым исходным кодом. 
                Работает локально — можете разместить у себя на сервере.
              </p>
            </div>
            <div class="about-features">
              <div v-for="feature in features" :key="feature.icon" class="about-feature">
                <div class="about-feature__icon">
                  <Icon :name="feature.icon" filled />
                </div>
                <h3 class="about-feature__title">{{ feature.title }}</h3>
                <p class="about-feature__description">{{ feature.description }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Team -->
      <section class="about-section about-section--alt">
        <div class="container">
          <div class="section-header">
            <h2 class="about-section__title">Создатель</h2>
            <p class="section-subtitle">О человеке за проектом</p>
          </div>
          <div class="team-grid">
            <article v-for="member in team" :key="member.name" class="team-card">
              <div class="team-card__avatar">
                <Icon name="person" filled />
              </div>
              <h3 class="team-card__name">{{ member.name }}</h3>
              <p class="team-card__role">{{ member.role }}</p>
              <p class="team-card__description">{{ member.description }}</p>
              <a v-if="member.telegram" :href="member.telegram" target="_blank" rel="noopener noreferrer" class="team-card__link">
                <Icon name="telegram" />
                Telegram
              </a>
            </article>
          </div>
        </div>
      </section>

      <!-- Data sources -->
      <section class="about-section">
        <div class="container">
          <div class="section-header">
            <h2 class="about-section__title">Источники данных</h2>
            <p class="section-subtitle">Nearventure использует открытые данные</p>
          </div>
          <div class="attributions-grid">
            <article v-for="attr in attributions" :key="attr.name" class="attribution-card">
              <div class="attribution-card__icon">
                <Icon :name="attr.icon" filled />
              </div>
              <h3 class="attribution-card__name">
                <a :href="attr.url" target="_blank" rel="noopener noreferrer">
                  {{ attr.name }}
                  <Icon name="open_in_new" />
                </a>
              </h3>
              <p class="attribution-card__description">{{ attr.description }}</p>
            </article>
          </div>
        </div>
      </section>

      <!-- Contribute -->
      <section class="about-section about-section--alt">
        <div class="container">
          <div class="section-header">
            <h2 class="about-section__title">Как внести вклад</h2>
            <p class="section-subtitle">Присоединяйтесь к развитию проекта</p>
          </div>
          <div class="contribute-grid">
            <article v-for="way in contributeWays" :key="way.title" class="contribute-card">
              <div class="contribute-card__icon">
                <Icon :name="way.icon" filled />
              </div>
              <h3 class="contribute-card__title">{{ way.title }}</h3>
              <p class="contribute-card__description">{{ way.description }}</p>
              <a :href="way.url" target="_blank" rel="noopener noreferrer" class="contribute-card__link">
                <Icon name="arrow_forward" />
                Перейти
              </a>
            </article>
          </div>
        </div>
      </section>

      <!-- Tech stack -->
      <section class="about-section">
        <div class="container">
          <div class="section-header">
            <h2 class="about-section__title">Технологии</h2>
            <p class="section-subtitle">На чём построен Nearventure</p>
          </div>
          <div class="tech-grid">
            <div class="tech-item">
              <Icon name="code" filled />
              <div>
                <strong>Frontend</strong>
                <p>Vue.js 3, TypeScript, Tailwind CSS</p>
              </div>
            </div>
            <div class="tech-item">
              <Icon name="layers" filled />
              <div>
                <strong>Карты</strong>
                <p>Leaflet, OpenStreetMap</p>
              </div>
            </div>
            <div class="tech-item">
              <Icon name="route" filled />
              <div>
                <strong>Маршрутизация</strong>
                <p>GraphHopper API</p>
              </div>
            </div>
            <div class="tech-item">
              <Icon name="storage" filled />
              <div>
                <strong>Backend</strong>
                <p>Nest.js, SQLite/PostgreSQL</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- License -->
      <section class="about-section about-section--alt">
        <div class="container">
          <div class="license-card">
            <Icon name="verified" filled class="license-card__icon" />
            <h3 class="license-card__title">Лицензия</h3>
            <p class="license-card__description">
              Исходный код проекта доступен под лицензией MIT. Вы можете использовать,
              модифицировать и распространять код с соблюдением условий лицензии.
            </p>
            <a href="https://github.com/vyatkatrails/nearventure" target="_blank" rel="noopener noreferrer" class="license-card__link">
              <Icon name="code" />
              Исходный код на GitHub
            </a>
          </div>
        </div>
      </section>
    </main>

    <!-- Footer -->
    <footer class="about-footer">
      <div class="container">
        <div class="footer-content">
          <div class="footer-brand">
            <Icon name="explore" filled />
            <span>Nearventure</span>
          </div>
          <div class="footer-links">
            <a href="/" class="footer-link">На главную</a>
            <a href="https://github.com/vyatkatrails/nearventure" target="_blank" rel="noopener noreferrer" class="footer-link">
              GitHub
            </a>
          </div>
        </div>
        <p class="footer-copyright">
          © 2025 Nearventure. Данные © OpenStreetMap contributors.
        </p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Skip link */
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
.about-page {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.about-page--mounted {
  opacity: 1;
  transform: translateY(0);
}

/* Header */
.about-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgb(var(--nv-surface-lowest) / 0.8);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgb(var(--nv-outline-variant) / 0.3);
}

.about-nav {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0.75rem 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.about-nav__brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
  font-weight: 800;
  font-size: 1.1rem;
  color: rgb(var(--nv-on-surface));
}

.about-nav__brand .ms-icon {
  font-size: 24px;
  color: rgb(var(--nv-primary));
}

.about-nav__link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 0.75rem;
  background: rgb(var(--nv-surface-low) / 0.8);
  border: 1px solid rgb(var(--nv-outline-variant));
  color: rgb(var(--nv-on-surface));
  text-decoration: none;
  font-weight: 600;
  transition: all 0.15s;
}

.about-nav__link:hover {
  background: rgb(var(--nv-primary) / 0.08);
  border-color: rgb(var(--nv-primary) / 0.3);
  color: rgb(var(--nv-primary));
}

/* Container */
.container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 0 2rem;
}

/* Section */
.about-section {
  padding: 5rem 0;
}

.about-section--alt {
  background: rgb(var(--nv-surface-lowest) / 0.5);
}

.section-header {
  text-align: center;
  margin-bottom: 3rem;
}

.about-section__title {
  font-size: 2rem;
  font-weight: 800;
  color: rgb(var(--nv-on-surface));
  margin: 0 0 0.75rem;
}

.section-subtitle {
  font-size: 1rem;
  color: rgb(var(--nv-on-surface-variant));
  margin: 0;
}

/* Hero */
.about-hero {
  padding: 4rem 0 5rem;
  background: linear-gradient(135deg, rgb(var(--nv-bg)), rgb(var(--nv-surface-low)));
}

.about-hero__title {
  font-size: 2.5rem;
  font-weight: 800;
  color: rgb(var(--nv-on-surface));
  margin: 0 0 1rem;
  text-align: center;
  letter-spacing: -0.02em;
}

.about-hero__subtitle {
  font-size: 1.1rem;
  color: rgb(var(--nv-on-surface-variant));
  text-align: center;
  margin: 0;
  max-width: 65ch;
  margin: 0 auto;
}

/* Content */
.about-content {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 3rem;
}

.about-text {
  max-width: 65ch;
}

.about-paragraph {
  font-size: 1rem;
  line-height: 1.7;
  color: rgb(var(--nv-on-surface-variant));
  margin: 0 0 1.5rem;
}

/* Features */
.about-features {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.about-feature {
  padding: 1.25rem;
  border-radius: 1rem;
  background: rgb(var(--nv-surface-lowest));
  border: 1px solid rgb(var(--nv-outline-variant) / 0.5);
}

.about-feature__icon {
  width: 40px;
  height: 40px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, rgb(var(--nv-primary) / 0.15), rgb(var(--nv-secondary) / 0.1));
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.75rem;
}

.about-feature__icon .ms-icon {
  font-size: 20px;
  color: rgb(var(--nv-primary));
}

.about-feature__title {
  font-size: 1rem;
  font-weight: 700;
  color: rgb(var(--nv-on-surface));
  margin: 0 0 0.5rem;
}

.about-feature__description {
  font-size: 0.9rem;
  color: rgb(var(--nv-on-surface-variant));
  margin: 0;
  line-height: 1.5;
}

/* Team */
.team-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 2rem;
  justify-content: center;
}

.team-card {
  padding: 2rem;
  border-radius: 1.25rem;
  background: rgb(var(--nv-surface-lowest));
  border: 1px solid rgb(var(--nv-outline-variant) / 0.5);
  text-align: center;
}

.team-card__avatar {
  width: 64px;
  height: 64px;
  margin: 0 auto 1rem;
  border-radius: 9999px;
  background: linear-gradient(135deg, rgb(var(--nv-primary) / 0.15), rgb(var(--nv-secondary) / 0.1));
  display: flex;
  align-items: center;
  justify-content: center;
}

.team-card__avatar .ms-icon {
  font-size: 32px;
  color: rgb(var(--nv-primary));
}

.team-card__name {
  font-size: 1.25rem;
  font-weight: 700;
  color: rgb(var(--nv-on-surface));
  margin: 0 0 0.5rem;
}

.team-card__role {
  font-size: 0.9rem;
  color: rgb(var(--nv-secondary));
  font-weight: 600;
  margin: 0 0 0.75rem;
}

.team-card__description {
  font-size: 0.9rem;
  color: rgb(var(--nv-on-surface-variant));
  margin: 0 0 1rem;
  line-height: 1.5;
}

.team-card__link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 0.75rem;
  background: rgb(var(--nv-secondary) / 0.1);
  color: rgb(var(--nv-secondary));
  text-decoration: none;
  font-weight: 600;
  transition: all 0.15s;
}

.team-card__link:hover {
  background: rgb(var(--nv-secondary) / 0.2);
}

.team-card__link .ms-icon {
  font-size: 18px;
}

/* Attributions */
.attributions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
}

.attribution-card {
  padding: 1.5rem;
  border-radius: 1rem;
  background: rgb(var(--nv-surface-lowest));
  border: 1px solid rgb(var(--nv-outline-variant) / 0.5);
}

.attribution-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 0.75rem;
  background: rgb(var(--nv-surface-variant));
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.attribution-card__icon .ms-icon {
  font-size: 20px;
  color: rgb(var(--nv-secondary));
}

.attribution-card__name {
  font-size: 1.1rem;
  font-weight: 700;
  color: rgb(var(--nv-on-surface));
  margin: 0 0 0.5rem;
}

.attribution-card__name a {
  color: inherit;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.attribution-card__name a:hover {
  color: rgb(var(--nv-primary));
}

.attribution-card__name .ms-icon {
  font-size: 16px;
}

.attribution-card__description {
  font-size: 0.9rem;
  color: rgb(var(--nv-on-surface-variant));
  margin: 0;
  line-height: 1.5;
}

/* Contribute */
.contribute-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.contribute-card {
  padding: 1.5rem;
  border-radius: 1rem;
  background: rgb(var(--nv-surface-lowest));
  border: 1px solid rgb(var(--nv-outline-variant) / 0.5);
  display: flex;
  flex-direction: column;
}

.contribute-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, rgb(var(--nv-tertiary) / 0.15), rgb(var(--nv-primary) / 0.1));
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.contribute-card__icon .ms-icon {
  font-size: 20px;
  color: rgb(var(--nv-tertiary));
}

.contribute-card__title {
  font-size: 1.1rem;
  font-weight: 700;
  color: rgb(var(--nv-on-surface));
  margin: 0 0 0.5rem;
}

.contribute-card__description {
  font-size: 0.9rem;
  color: rgb(var(--nv-on-surface-variant));
  margin: 0 0 1rem;
  line-height: 1.5;
  flex: 1;
}

.contribute-card__link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 0.75rem;
  background: rgb(var(--nv-secondary) / 0.1);
  color: rgb(var(--nv-secondary));
  text-decoration: none;
  font-weight: 600;
  transition: all 0.15s;
}

.contribute-card__link:hover {
  background: rgb(var(--nv-secondary) / 0.2);
}

.contribute-card__link .ms-icon {
  font-size: 16px;
}

/* Tech grid */
.tech-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1.5rem;
}

.tech-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem;
  border-radius: 1rem;
  background: rgb(var(--nv-surface-lowest));
  border: 1px solid rgb(var(--nv-outline-variant) / 0.5);
}

.tech-item .ms-icon {
  font-size: 24px;
  color: rgb(var(--nv-primary));
}

.tech-item strong {
  display: block;
  font-weight: 700;
  color: rgb(var(--nv-on-surface));
  margin-bottom: 0.25rem;
}

.tech-item p {
  margin: 0;
  font-size: 0.85rem;
  color: rgb(var(--nv-on-surface-variant));
}

/* License */
.license-card {
  max-width: 700px;
  margin: 0 auto;
  padding: 2rem;
  border-radius: 1.25rem;
  background: rgb(var(--nv-surface-lowest));
  border: 1px solid rgb(var(--nv-outline-variant) / 0.5);
  text-align: center;
}

.license-card__icon {
  font-size: 48px;
  color: rgb(var(--nv-tertiary));
  display: block;
  margin: 0 auto 1rem;
}

.license-card__title {
  font-size: 1.5rem;
  font-weight: 800;
  color: rgb(var(--nv-on-surface));
  margin: 0 0 1rem;
}

.license-card__description {
  font-size: 1rem;
  line-height: 1.6;
  color: rgb(var(--nv-on-surface-variant));
  margin: 0 0 1.5rem;
}

.license-card__link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: 0.75rem;
  background: rgb(var(--nv-primary));
  color: rgb(var(--nv-on-primary));
  text-decoration: none;
  font-weight: 600;
  transition: all 0.15s;
}

.license-card__link:hover {
  filter: brightness(1.05);
  transform: translateY(-1px);
}

/* Footer */
.about-footer {
  padding: 3rem 0;
  background: rgb(var(--nv-surface-lowest));
  border-top: 1px solid rgb(var(--nv-outline-variant) / 0.3);
}

.footer-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 800;
  color: rgb(var(--nv-on-surface));
}

.footer-brand .ms-icon {
  font-size: 24px;
  color: rgb(var(--nv-primary));
}

.footer-links {
  display: flex;
  gap: 1.5rem;
}

.footer-link {
  color: rgb(var(--nv-on-surface-variant));
  text-decoration: none;
  font-weight: 600;
  transition: color 0.15s;
}

.footer-link:hover {
  color: rgb(var(--nv-primary));
}

.footer-copyright {
  font-size: 0.85rem;
  color: rgb(var(--nv-on-surface-variant));
  margin: 0;
  text-align: center;
}

/* Mobile */
@media (max-width: 768px) {
  .about-nav {
    padding: 0.75rem 1rem;
  }

  .about-hero__title {
    font-size: 2rem;
  }

  .about-hero__subtitle {
    font-size: 1rem;
  }

  .about-content {
    grid-template-columns: 1fr;
  }

  .container {
    padding: 0 1rem;
  }

  .about-section {
    padding: 4rem 0;
  }

  .about-section__title {
    font-size: 1.5rem;
  }

  .team-grid,
  .attributions-grid,
  .contribute-grid {
    grid-template-columns: 1fr;
  }

  .footer-content {
    flex-direction: column;
    text-align: center;
  }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .about-page {
    transition: none;
  }

  .about-nav__link {
    transition: none;
  }

  .contribute-card__link {
    transition: none;
  }

  .license-card__link {
    transition: none;
  }

  .footer-link {
    transition: none;
  }
}
</style>