<script setup lang="ts">
import { Layers, Bike, Footprints, Mountain, Map as MapIcon, Moon, Satellite } from 'lucide-vue-next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import type { BaseMapStyle, MapStyleConfig, OverlayOptions } from '@/lib/map-styles';

const props = withDefaults(defineProps<{
  config: MapStyleConfig;
}>(), {});

const emit = defineEmits<{
  (e: 'update:config', config: MapStyleConfig): void;
}>();

const BASE_OPTIONS: { value: BaseMapStyle; label: string; icon: typeof MapIcon }[] = [
  // NOTE: BaseMapStyle = 'light' | 'dark' | 'satellite' (map-styles.ts).
  // 'voyager' was an invalid value that silently failed type-check; must be 'light'.
  { value: 'light', label: 'Светлая', icon: MapIcon },
  { value: 'dark', label: 'Тёмная', icon: Moon },
  { value: 'satellite', label: 'Спутник', icon: Satellite },
];

function setBase(base: BaseMapStyle) {
  emit('update:config', { ...props.config, base });
}

function toggleOverlay(key: keyof OverlayOptions) {
  const overlays = { ...props.config.overlays, [key]: !props.config.overlays[key] };
  emit('update:config', { ...props.config, overlays });
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="secondary"
        size="icon"
        class="rounded-full border-border/60 bg-card/90 shadow-card backdrop-blur-md transition hover:bg-accent"
        aria-label="Слои карты"
      >
        <Layers class="size-5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" :side-offset="8" class="w-56">
      <!-- Base map style -->
      <DropdownMenuLabel>Базовый слой</DropdownMenuLabel>
      <DropdownMenuRadioGroup :model-value="config.base" @update:model-value="setBase($event as BaseMapStyle)">
        <DropdownMenuRadioItem
          v-for="opt in BASE_OPTIONS"
          :key="opt.value"
          :value="opt.value"
          class="gap-2"
        >
          <component :is="opt.icon" class="size-4 text-muted-foreground" />
          {{ opt.label }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>

      <DropdownMenuSeparator />

      <!-- Overlay toggles -->
      <DropdownMenuLabel>Слои</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        :checked="config.overlays.cycling"
        @select.prevent="toggleOverlay('cycling')"
        class="gap-2"
      >
        <Bike class="size-4 text-primary" />
        <span>Велосипед</span>
        <span class="ml-auto text-xs text-muted-foreground">CyclOSM</span>
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        :checked="config.overlays.hiking"
        @select.prevent="toggleOverlay('hiking')"
        class="gap-2"
      >
        <Footprints class="size-4 text-tertiary" />
        <span>Туризм</span>
        <span class="ml-auto text-xs text-muted-foreground">Trails</span>
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        :checked="config.overlays.hillshade"
        @select.prevent="toggleOverlay('hillshade')"
        class="gap-2"
      >
        <Mountain class="size-4 text-orange-600" />
        <span>Рельеф</span>
        <span class="ml-auto text-xs text-muted-foreground">Hillshade</span>
      </DropdownMenuCheckboxItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
