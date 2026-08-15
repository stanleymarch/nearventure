<script setup lang="ts">
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import ItinerarySummary from './ItinerarySummary.vue';
import type { AutoFillPreset, ItineraryDraft, VisitMode } from '@/api/itineraries';

withDefaults(defineProps<{
  open: boolean;
  draft?: ItineraryDraft | null;
  loading?: boolean;
  error?: string | null;
  preferredCategories?: string[];
  editableTopology?: boolean;
}>(), { draft: null, loading: false, error: null, editableTopology: false });

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'mode', placeId: string, mode: VisitMode, custom?: number): void;
  (e: 'lock', placeId: string, locked: boolean): void;
  (e: 'remove', placeId: string): void;
  (e: 'budget-mode', mode: 'whole_trip' | 'travel_only' | 'unlimited'): void;
  (e: 'topology', loop: boolean): void;
  (e: 'pick-finish'): void;
  (e: 'clear-finish'): void;
  (e: 'apply-smart-fix', suggestionId: string): void;
  (e: 'accept-addition', suggestionId: string): void;
  (e: 'replace-place', placeId: string): void;
  (e: 'accept-replacement', suggestionId: string): void;
  (e: 'select-alternative', alternativeId: string): void;
  (e: 'auto-fill', categories: string[], seed?: number, preset?: AutoFillPreset): void;
  (e: 'undo'): void;
  (e: 'view-poi', poiId: string): void;
  (e: 'publish'): void;
  (e: 'download-gpx'): void;
}>();
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent side="bottom" class="max-h-[82dvh] overflow-y-auto rounded-t-2xl bg-background px-4 pb-[calc(1rem+var(--safe-bottom))] pt-5">
      <SheetHeader class="text-left">
        <SheetTitle>План путешествия</SheetTitle>
        <SheetDescription>Маршрут, время и бюджет</SheetDescription>
      </SheetHeader>
      <ItinerarySummary
        v-if="draft"
        class="mt-4"
        :draft="draft"
        :preferred-categories="preferredCategories"
        :editable-topology="editableTopology"
        :loading="loading"
        :error="error"
        @mode="(placeId, mode, custom) => emit('mode', placeId, mode, custom)"
        @lock="(placeId, locked) => emit('lock', placeId, locked)"
        @remove="(placeId) => emit('remove', placeId)"
        @budget-mode="(mode) => emit('budget-mode', mode)"
        @topology="(loop) => emit('topology', loop)"
        @pick-finish="emit('pick-finish')"
        @clear-finish="emit('clear-finish')"
        @apply-smart-fix="(suggestionId) => emit('apply-smart-fix', suggestionId)"
        @accept-addition="(suggestionId) => emit('accept-addition', suggestionId)"
        @replace-place="(placeId) => emit('replace-place', placeId)"
        @accept-replacement="(suggestionId) => emit('accept-replacement', suggestionId)"
        @select-alternative="(alternativeId) => emit('select-alternative', alternativeId)"
        @auto-fill="(categories, seed, preset) => emit('auto-fill', categories, seed, preset)"
        @undo="emit('undo')"
        @view-poi="(poiId) => emit('view-poi', poiId)"
        @publish="emit('publish')"
        @download-gpx="emit('download-gpx')"
      />
    </SheetContent>
  </Sheet>
</template>
