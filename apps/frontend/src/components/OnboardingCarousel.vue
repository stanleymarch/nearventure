<script setup lang="ts">
import { ref } from 'vue';
import Icon from '@/components/Icon.vue';

defineEmits<{
  (e: 'dismiss'): void;
}>();

const currentStep = ref(0);

const steps = [
  {
    icon: 'explore',
    title: 'Добро пожаловать в Nearventure',
    description: 'Планируйте веломаршруты и прогулки по Вятке за 3 простых шага',
  },
  {
    icon: 'my_location',
    title: '1. Укажите точку старта',
    description: 'Нажмите кнопку геолокации или кликните по карте, чтобы поставить старт',
  },
  {
    icon: 'schedule',
    title: '2. Выберите время поездки',
    description: 'Установите время, которое у вас есть — маршрут подстроится под бюджет',
  },
  {
    icon: 'auto_awesome',
    title: '3. Нажмите "Создать путешествие"',
    description: 'Получите готовый маршрут с интересными местами по пути',
  },
];

function next() {
  if (currentStep.value < steps.length - 1) {
    currentStep.value++;
  }
}

function prev() {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
}

function skip() {
  currentStep.value = steps.length - 1;
}

function start() {
  currentStep.value = 0;
}
</script>

<template>
  <div class="onboarding-overlay" @click.self="$emit('dismiss')">
    <div class="onboarding-card">
      <div class="onboarding__progress">
        <div 
          v-for="(step, i) in steps" 
          :key="i"
          class="onboarding__dot"
          :class="{ 'onboarding__dot--active': i === currentStep, 'onboarding__dot--complete': i < currentStep }"
        />
      </div>

      <div class="onboarding__content">
        <div class="onboarding__icon">
          <Icon :name="steps[currentStep].icon" filled />
        </div>
        <h2 class="onboarding__title">{{ steps[currentStep].title }}</h2>
        <p class="onboarding__description">{{ steps[currentStep].description }}</p>
      </div>

      <div class="onboarding__actions">
        <button 
          v-if="currentStep > 0 && currentStep < steps.length - 1"
          class="onboarding__btn onboarding__btn--ghost"
          @click="prev"
        >
          Назад
        </button>
        <button 
          v-if="currentStep === 0"
          class="onboarding__btn onboarding__btn--ghost"
          @click="$emit('dismiss')"
        >
          Пропустить
        </button>
        <button 
          class="onboarding__btn onboarding__btn--primary"
          @click="currentStep < steps.length - 1 ? next() : $emit('dismiss')"
        >
          {{ currentStep === steps.length - 1 ? 'Начать' : 'Далее' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  padding: 1rem;
}

.onboarding-card {
  width: 100%;
  max-width: 420px;
  padding: 2rem;
  border-radius: 1.5rem;
  background: rgb(var(--nv-surface-lowest) / 0.97);
  backdrop-filter: blur(24px);
  border: 1px solid rgb(var(--nv-outline-variant) / 0.6);
  box-shadow: var(--tw-shadow-float);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  animation: onboarding-in 0.3s ease;
}

@keyframes onboarding-in {
  from {
    transform: translateY(20px) scale(0.96);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

.onboarding__progress {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}

.onboarding__dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: rgb(var(--nv-outline-variant));
  transition: all 0.3s ease;
}

.onboarding__dot--active {
  width: 24px;
  background: rgb(var(--nv-primary));
}

.onboarding__dot--complete {
  background: rgb(var(--nv-tertiary));
}

.onboarding__content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  text-align: center;
}

.onboarding__icon {
  width: 64px;
  height: 64px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: linear-gradient(135deg, rgb(var(--nv-primary) / 0.15), rgb(var(--nv-secondary) / 0.1));
}

.onboarding__icon .ms-icon {
  font-size: 36px;
  color: rgb(var(--nv-primary));
}

.onboarding__title {
  font-size: 1.25rem;
  font-weight: 800;
  color: rgb(var(--nv-on-surface));
  margin: 0;
  letter-spacing: -0.02em;
}

.onboarding__description {
  font-size: 0.95rem;
  line-height: 1.6;
  color: rgb(var(--nv-on-surface-variant));
  margin: 0;
}

.onboarding__actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.onboarding__btn {
  padding: 0.75rem 1.25rem;
  border-radius: 0.8rem;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
}

.onboarding__btn--ghost {
  background: rgb(var(--nv-surface-low) / 0.8);
  color: rgb(var(--nv-on-surface-variant));
}

.onboarding__btn--ghost:hover {
  background: rgb(var(--nv-surface-variant) / 0.5);
  color: rgb(var(--nv-on-surface));
}

.onboarding__btn--primary {
  flex: 1;
  background: linear-gradient(90deg, rgb(var(--nv-primary)), rgb(var(--nv-primary-container)));
  color: rgb(var(--nv-on-primary));
}

.onboarding__btn--primary:hover {
  filter: brightness(1.05);
  transform: translateY(-1px);
}

@media (max-width: 640px) {
  .onboarding-card {
    padding: 1.5rem;
  }

  .onboarding__title {
    font-size: 1.1rem;
  }

  .onboarding__description {
    font-size: 0.9rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .onboarding-overlay {
    backdrop-filter: none;
    background: rgba(0, 0, 0, 0.8);
  }

  .onboarding-card {
    animation: none;
  }

  .onboarding__dot {
    transition: none;
  }

  .onboarding__btn {
    transition: none;
  }
}
</style>