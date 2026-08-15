<script setup lang="ts">
import { ref } from 'vue';
import Icon from '@/components/Icon.vue';

interface Props {
  locating: boolean;
  isMapReady: boolean;
  onLocate?: () => void;
  onPlanRoute?: () => void;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'locate'): void;
  (e: 'plan-route'): void;
}>();

const handleLocate = () => {
  if (!props.isMapReady) return;
  emit('locate');
};

const handlePlanRoute = () => {
  if (!props.isMapReady) return;
  emit('plan-route');
};
</script>

<template>
  <div class="route-controls">
    <!-- Locate button -->
    <button
      @click="handleLocate"
      :disabled="locating || !isMapReady"
      class="locate-btn"
      :title="locating ? 'Определение местоположения...' : 'Моё местоположение'"
      aria-label="Моё местоположение"
    >
      <Icon name="my_location" filled :class="{ 'spinning': locating }" />
    </button>

    <!-- Plan route button -->
    <button
      @click="handlePlanRoute"
      :disabled="!isMapReady"
      class="plan-btn"
      title="Построить маршрут"
      aria-label="Построить маршрут"
    >
      <Icon name="route" filled />
    </button>
  </div>
</template>

<style scoped>
.route-controls {
  position: absolute;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 1rem;
  z-index: 1000;
  padding: 0.5rem;
  background: rgb(var(--nv-surface-lowest) / 0.9);
  backdrop-filter: blur(12px);
  border-radius: 1rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.locate-btn,
.plan-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: rgb(var(--nv-primary));
  color: rgb(var(--nv-on-primary));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.locate-btn:disabled,
.plan-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.locate-btn:hover:not(:disabled),
.plan-btn:hover:not(:disabled) {
  background: rgb(var(--nv-primary-container));
  transform: scale(1.05);
}

.locate-btn .ms-icon,
.plan-btn .ms-icon {
  font-size: 24px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spinning {
  animation: spin 1s linear infinite;
}

/* Mobile safe areas */
@supports (padding: env(safe-area-inset-bottom)) {
  .route-controls {
    bottom: calc(2rem + env(safe-area-inset-bottom));
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom));
  }
}
</style>