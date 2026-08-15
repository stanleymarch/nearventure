<template>
  <div class="nv-marker-wrapper"
    :style="`--c: ${color}; --pulse: ${pulse ? '0' : '1'}`"
    @click="$emit('click', $event)"
  >
    <div class="nv-marker">
      <span v-if="isEmoji" class="nv-marker-emoji">{{ iconName }}</span>
      <Icon v-else :name="iconName" filled />
    </div>
  </div>
</template>

<style scoped>
.nv-marker-wrapper {
  position: relative;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow: 0 3px 8px rgba(35, 25, 20, 0.3);
}

.nv-marker {
  position: absolute;
  z-index: 1;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: var(--c);
  border: 3px solid var(--c);
  box-shadow: 0 3px 8px rgba(35, 25, 20, 0.3);
  color: #fff;
  transition: all 0.15s ease;
}

.nv-marker:hover {
  transform: scale(1.1);
}

.nv-marker--pulse {
  animation: nv-pulse 1.5s ease-in-out infinite;
}

@keyframes nv-pulse {
  0%, 100% {
    box-shadow: 0 3px 8px rgba(35, 25, 20, 0.3);
  }
  50% {
    box-shadow: 0 3px 8px rgba(35, 25, 20, 0.3), 0 0 0 10px rgba(35, 25, 20, 0.15);
  }
  100% {
    box-shadow: 0 3px 8px rgba(35, 25, 20, 0.3), 0 0 0 10px rgb(var(--nv-primary) / 0.15);
  }
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';

const props = defineProps<{
  color: string; // hex or CSS variable like rgb(var(--nv-primary))
  emoji: string; // Material Symbol name or emoji
  pulse?: boolean;
}>();

defineEmits<{ (e: 'click', evt: Event): void }>();

const iconName = computed(() => props.emoji);
const isEmoji = computed(() => /[\u{1}-\u{4}\u{7}-\u{9}]+/u.test(props.emoji));
</script>