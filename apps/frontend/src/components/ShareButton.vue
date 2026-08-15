<script setup lang="ts">
import { ref, computed } from 'vue';
import Icon from '@/components/Icon.vue';

const props = withDefaults(defineProps<{
  /** URL to share. Defaults to current page URL. */
  url?: string;
  /** Share title for native API. */
  title?: string;
  /** Share text for native API. */
  text?: string;
  /** Telegram share text override. */
  telegramText?: string;
  /** Show label alongside icon. */
  label?: string;
}>(), {
  title: 'Nearventure — маршрут',
  text: 'Посмотрите маршрут в Nearventure',
});

const copied = ref(false);
const showTooltip = ref(false);
let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

const shareUrl = computed(() => props.url || window.location.href);
const telegramUrl = computed(() => {
  return `https://t.me/share/url?url=${encodeURIComponent(shareUrl.value)}&text=${encodeURIComponent(props.telegramText || props.text)}`;
});

function showCopiedFeedback() {
  copied.value = true;
  showTooltip.value = true;
  if (tooltipTimer) clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => {
    copied.value = false;
    showTooltip.value = false;
  }, 2000);
}

async function handleShare() {
  // Try native Share API first
  if (navigator.share) {
    try {
      await navigator.share({
        title: props.title,
        text: props.text,
        url: shareUrl.value,
      });
      return;
    } catch (e: any) {
      // User cancelled or API unavailable — fall through
      if (e.name !== 'AbortError') {
        // Fallback to clipboard
      }
    }
  }

  // Fallback: copy link + show Telegram option
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    showCopiedFeedback();
  } catch {
    // Clipboard not available
    showCopiedFeedback();
  }
}

function shareTelegram() {
  window.open(telegramUrl.value, '_blank', 'noopener,noreferrer');
}

defineExpose({ handleShare, shareTelegram });
</script>

<template>
  <div class="relative inline-flex">
    <!-- Main share button -->
    <button
      class="nv-share-btn"
      @click="handleShare"
      :title="copied ? 'Ссылка скопирована' : 'Поделиться'"
    >
      <Icon v-if="copied" name="check" filled />
      <Icon v-else name="share" />
      <span v-if="label" class="nv-share-btn__label">{{ copied ? 'Скопировано' : label }}</span>
    </button>

    <!-- Telegram share (shown after copy or on hover) -->
    <div
      v-if="showTooltip"
      class="nv-share-tooltip"
      role="tooltip"
    >
      <button class="nv-share-tooltip__item" @click="shareTelegram">
        <Icon name="send" filled style="color: #0088cc" />
        Telegram
      </button>
      <button class="nv-share-tooltip__item" @click="handleShare">
        <Icon name="link" filled style="color: rgb(var(--nv-primary))" />
        Скопировать ссылку
      </button>
    </div>
  </div>
</template>

<style scoped>
.nv-share-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  height: 40px;
  padding: 0 1rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--nv-outline-variant));
  background: rgb(var(--nv-surface-lowest) / 0.9);
  backdrop-filter: blur(16px);
  color: rgb(var(--nv-on-surface));
  cursor: pointer;
  font-weight: 600;
  font-size: 0.875rem;
  transition: all 0.15s;
}
.nv-share-btn:hover {
  background: rgb(var(--nv-secondary) / 0.08);
  border-color: rgb(var(--nv-secondary) / 0.3);
  color: rgb(var(--nv-secondary));
}
.nv-share-btn .ms-icon {
  font-size: 20px;
}

.nv-share-tooltip {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 0.75rem;
  background: rgb(var(--nv-surface-lowest) / 0.96);
  backdrop-filter: blur(20px);
  border: 1px solid rgb(var(--nv-outline-variant) / 0.6);
  box-shadow: 0 8px 24px rgba(35, 25, 20, 0.12);
  white-space: nowrap;
}

.nv-share-tooltip__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: none;
  background: none;
  color: rgb(var(--nv-on-surface));
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  border-radius: 0.5rem;
  transition: background 0.1s;
  width: 100%;
  text-align: left;
}
.nv-share-tooltip__item:hover {
  background: rgb(var(--nv-primary) / 0.08);
}
.nv-share-tooltip__item .ms-icon {
  font-size: 18px;
}

@media (prefers-reduced-motion: reduce) {
  .nv-share-btn {
    transition: none;
  }
  .nv-share-tooltip__item {
    transition: none;
  }
}
</style>
