<script setup lang="ts">
import { computed, ref } from 'vue';
import { AlertTriangle, ArrowRight, ChevronDown, CheckCircle2, Download, Flag, Info, Lock, LockOpen, Plus, RefreshCw, Shuffle, Sparkles, Trash2, RotateCcw, X } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import type { AutoFillPreset, ItineraryDraft, RoutePlace, SelectionSummary, VisitMode } from '@/api/itineraries';

const props = defineProps<{ draft: ItineraryDraft; loading?: boolean; error?: string | null; preferredCategories?: string[]; editableTopology?: boolean }>();
const emit = defineEmits<{ mode: [placeId: string, mode: VisitMode, custom?: number]; lock: [placeId: string, locked: boolean]; remove: [placeId: string]; budgetMode: [mode: 'whole_trip' | 'travel_only' | 'unlimited']; topology: [loop: boolean]; pickFinish: []; clearFinish: []; applySmartFix: [suggestionId: string]; acceptAddition: [suggestionId: string]; replacePlace: [placeId: string]; acceptReplacement: [suggestionId: string]; selectAlternative: [alternativeId: string]; autoFill: [categories: string[], seed?: number, preset?: AutoFillPreset]; undo: []; viewPoi: [poiId: string]; publish: []; 'download-gpx': [] }>();

const expanded = ref<string | null>(null);
const showPresets = ref(false);
// Geometry-derived caveats (e.g. an unavoidable out-and-back stem). The
// backend recomputes these on every replan, so they always match the line.
const routeWarnings = computed(() => props.draft.warnings ?? []);
// Truthful low-supply signal from the last auto-fill: distinct candidate
// clusters in the reachable area. Cleared on any manual edit.
const lowSupply = computed(() => {
  const s = props.draft.autoFillSummary;
  return s && s.candidateClusters <= 4 ? s : null;
});
const budgetLabel = computed(() => props.draft.totals.budgetMinutes == null ? 'без лимита' : `${props.draft.totals.budgetMinutes} мин`);
const budgetStatus = computed(() => props.draft.budgetMode === 'unlimited' ? 'Без лимита' : props.draft.totals.feasible ? 'В бюджете' : `Перебор ${props.draft.totals.overBudgetMinutes} мин`);
const pct = computed(() => props.draft.totals.budgetMinutes == null ? 0 : Math.min(100, Math.round(props.draft.totals.totalMinutes / props.draft.totals.budgetMinutes * 100)));
const canPublish = computed(() => !!props.draft.route && !!props.draft.totals.feasible && !props.draft.publishedRouteId);

function setMode(place: RoutePlace, value: unknown) { if (typeof value === 'string' && value) emit('mode', place.id, value as VisitMode, value === 'custom' ? (place.customVisitMinutes || 15) : undefined); }
function setCustomMinutes(place: RoutePlace, event: Event) {
  const value = Math.min(480, Math.max(1, Math.round(Number((event.target as HTMLInputElement).value) || 1)));
  emit('mode', place.id, 'custom', value);
}

const presetOptions: { value: AutoFillPreset; label: string }[] = [
  { value: 'balanced', label: 'Сбалансированный' },
  { value: 'more_places', label: 'Больше мест' },
  { value: 'scenic', label: 'Живописный' },
  { value: 'training', label: 'Тренировка' },
];

function formatDelta(val: number): string {
  if (val === 0) return '0';
  return (val > 0 ? '+' : '') + Math.round(val).toString();
}
function serverMinutes(value: number | null): string {
  if (value == null) return '—';
  return Number.isInteger(value) ? `${value} мин` : `${value.toFixed(1)} мин`;
}
function summaryHints(summary?: SelectionSummary): string[] {
  if (!summary) return [];
  const hints: string[] = [];
  if (summary.localityGuardApplied && summary.unusedBudgetIntentional) hints.push('Компактный локальный маршрут; часть времени оставлена в запасе.');
  if (summary.networkConfidence === 'approximate_isochrone') hints.push('Зона приблизительная; выбранные места проверены по дорожной сети.');
  else if (summary.networkConfidence === 'best_confirmed') hints.push('Показан лучший вариант, подтверждённый до завершения расчёта.');
  else hints.push('Маршрут подтверждён по дорожной сети.');
  if (summary.maxAutomaticExcursionMinutes != null) hints.push(`Самый дальний автоматический выезд: ${serverMinutes(summary.maxAutomaticExcursionMinutes)}.`);
  return hints;
}
</script>
<template>
  <section class="flex flex-col gap-3" aria-label="План путешествия">
    <div class="rounded-2xl border border-nv-outline-variant/60 bg-nv-surface-lowest p-3">
      <div class="flex items-center justify-between gap-2"><div><p class="text-xs text-nv-on-surface-variant">Итого / бюджет</p><p class="text-lg font-bold">{{ Math.round(draft.totals.totalMinutes) }} / {{ budgetLabel }}</p></div><Badge :variant="draft.totals.feasible ? 'secondary' : 'destructive'">{{ budgetStatus }}</Badge></div>
      <div v-if="draft.budgetMode !== 'unlimited'" class="mt-2 h-2 overflow-hidden rounded-full bg-nv-outline-variant/40" role="progressbar" :aria-valuenow="Math.round(draft.totals.totalMinutes)" aria-valuemin="0" :aria-valuemax="draft.totals.budgetMinutes ?? undefined" :aria-valuetext="draft.totals.budgetMinutes == null ? `${Math.round(draft.totals.totalMinutes)} минут без лимита` : `${Math.round(draft.totals.totalMinutes)} минут из ${draft.totals.budgetMinutes}`"><div class="h-full rounded-full" :class="draft.totals.feasible ? 'bg-nv-tertiary' : 'bg-nv-error'" :style="{ width: pct + '%' }" /></div>
      <div class="mt-2 flex justify-between text-xs"><span>В пути <b>{{ Math.round(draft.totals.travelMinutes) }} мин</b></span><span>На местах <b>{{ Math.round(draft.totals.stopMinutes) }} мин</b></span></div>
      <ToggleGroup type="single" :model-value="draft.budgetMode" class="mt-3 grid grid-cols-3" aria-label="Расчёт бюджета" @update:model-value="v => typeof v === 'string' && v && emit('budgetMode', v as 'whole_trip' | 'travel_only' | 'unlimited')"><ToggleGroupItem value="whole_trip" class="min-h-11 text-[10px]" aria-label="Всё путешествие">Всё</ToggleGroupItem><ToggleGroupItem value="travel_only" class="min-h-11 text-[10px]" aria-label="Только дорога">Дорога</ToggleGroupItem><ToggleGroupItem value="unlimited" class="min-h-11 text-[10px]" aria-label="Без лимита">Без лимита</ToggleGroupItem></ToggleGroup>
      <p v-if="draft.budgetMode !== 'unlimited' && !draft.totals.feasible" class="mt-2 text-xs text-nv-error">Можно продолжать: превышение бюджета не удаляет места.</p>
    </div>

    <div v-if="editableTopology" class="rounded-2xl border border-nv-outline-variant/60 bg-nv-surface-lowest p-3">
      <p class="text-xs font-bold">Куда закончится маршрут</p>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <button type="button" class="min-h-11 rounded-lg border px-2 text-left text-[10px] font-semibold" :class="draft.loop ? 'border-nv-primary bg-nv-primary/10 text-nv-primary' : 'border-nv-outline-variant/60'" :aria-pressed="draft.loop" @click="emit('topology', true)"><RefreshCw class="mb-1 size-4" />Вернуться к старту</button>
        <button type="button" class="min-h-11 rounded-lg border px-2 text-left text-[10px] font-semibold" :class="!draft.loop ? 'border-nv-primary bg-nv-primary/10 text-nv-primary' : 'border-nv-outline-variant/60'" :aria-pressed="!draft.loop" @click="emit('topology', false)"><ArrowRight class="mb-1 size-4" />Открытый маршрут</button>
      </div>
      <div v-if="!draft.loop" class="relative mt-2">
        <button type="button" class="flex min-h-11 w-full items-center gap-2 rounded-lg border border-nv-outline-variant/60 px-3 text-left text-[10px]" @click="emit('pickFinish')"><Flag class="size-4 text-nv-primary" /><span class="min-w-0 flex-1"><b class="block">Финиш</b><span class="block truncate text-nv-on-surface-variant">{{ draft.finish ? `${draft.finish.lat.toFixed(3)}, ${draft.finish.lon.toFixed(3)}` : 'Последнее место или точка на карте' }}</span></span></button>
        <button v-if="draft.finish" type="button" class="absolute right-1 top-0 grid size-11 place-items-center rounded-lg text-nv-on-surface-variant" aria-label="Убрать финиш" @click.stop="emit('clearFinish')"><X class="size-4" /></button>
      </div>
    </div>

    <!-- Route caveats: geometry truth the user must see before exporting GPX. -->
    <div v-for="w in routeWarnings" :key="w.code" class="flex items-start gap-2 rounded-2xl border p-3" :class="w.code === 'LOCKED_SET_OVER_BUDGET' ? 'border-nv-error/40 bg-nv-error-container/20 text-nv-error' : 'border-amber-500/40 bg-amber-500/10 text-amber-900'">
      <AlertTriangle class="mt-0.5 size-4 shrink-0" />
      <p class="text-xs">{{ w.message }}</p>
    </div>

    <div v-for="hint in summaryHints(draft.autoFillSummary)" :key="hint" class="flex items-start gap-2 rounded-2xl border border-nv-outline-variant/60 bg-nv-surface-lowest p-3">
      <Info class="mt-0.5 size-4 shrink-0 text-nv-on-surface-variant" />
      <p class="text-xs text-nv-on-surface-variant">{{ hint }}</p>
    </div>

    <!-- Low-supply nudge: the reachable area had few candidate stops. -->
    <div v-if="lowSupply" class="flex items-start gap-2 rounded-2xl border border-nv-outline-variant/60 bg-nv-surface-lowest p-3">
      <Info class="mt-0.5 size-4 shrink-0 text-nv-on-surface-variant" />
      <p class="text-xs text-nv-on-surface-variant">В зоне достигаемости немного подходящих мест ({{ lowSupply.candidateClusters }}). Увеличьте время или смените категорию, чтобы увидеть больше.</p>
    </div>

    <!-- Presets (collapsible) -->
    <div v-if="draft.budgetMode !== 'unlimited' && preferredCategories" class="rounded-2xl border border-nv-outline-variant/60 bg-nv-surface-lowest p-3">
      <button type="button" class="flex w-full items-center gap-1.5 text-xs font-semibold text-nv-on-surface-variant" @click="showPresets = !showPresets"><Sparkles class="size-3.5" /> Режим подбора <span class="ml-auto">{{ showPresets ? '▲' : '▼' }}</span></button>
      <div v-if="showPresets" class="mt-2 grid grid-cols-2 gap-1.5">
        <button v-for="opt in presetOptions" :key="opt.value" type="button"
          class="rounded-lg border px-2 py-1.5 text-xs transition-colors"
          :class="draft.preset === opt.value ? 'border-nv-primary bg-nv-primary/10 font-semibold' : 'border-nv-outline-variant/60'"
          @click="emit('autoFill', preferredCategories ?? [], undefined, opt.value)">
          {{ opt.label }}
        </button>
      </div>
    </div>

    <p v-else-if="draft.budgetMode === 'unlimited'" class="rounded-2xl border border-nv-outline-variant/60 bg-nv-surface-lowest p-3 text-xs text-nv-on-surface-variant">Автоподбору нужен лимит времени, чтобы определить зону достижимости. Установите бюджет, если хотите подобрать остановки автоматически.</p>

    <Skeleton v-if="loading" class="h-16 w-full rounded-xl" aria-label="Обновляем маршрут" />
    <p v-if="error" role="alert" class="rounded-xl border border-nv-error/40 p-3 text-xs text-nv-error">{{ error }}</p>
    <p v-if="!draft.places.length" class="text-center text-xs text-nv-on-surface-variant">Добавьте место на карте — появится первый узел.</p>

    <!-- Smart fixes -->
    <div v-if="!draft.totals.feasible && draft.suggestions.length" class="rounded-2xl border border-nv-error/30 bg-nv-error-container/10 p-3">
      <h3 class="mb-2 text-xs font-bold flex items-center gap-1"><Sparkles class="size-3.5" />Как уложиться</h3>
      <div v-for="fix in draft.suggestions" :key="fix.suggestionId" class="mb-2 last:mb-0 flex items-start gap-2 rounded-xl border border-nv-outline-variant/40 bg-nv-surface-lowest p-2.5">
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium">{{ fix.reason }}</p>
          <p v-if="fix.delta" class="mt-0.5 text-[10px] text-nv-on-surface-variant">
            <span>{{ Math.round(fix.previewTotals.totalMinutes) }} мин · </span>
            <span>{{ formatDelta(fix.delta.totalMinutes) }} от текущего</span>
          </p>
        </div>
        <Button size="sm" variant="outline" class="shrink-0 h-8 text-xs" :disabled="loading" @click="emit('applySmartFix', fix.suggestionId)">
          <CheckCircle2 class="size-3 mr-1" />Применить
        </Button>
      </div>
    </div>

    <!-- Additions: after Мимо/removal, transparent nearby POIs that fit freed budget. -->
    <div v-if="draft.additions?.length" class="rounded-2xl border border-nv-primary/30 bg-nv-primary-container/10 p-3">
      <h3 class="mb-0.5 text-xs font-bold flex items-center gap-1"><Sparkles class="size-3.5 text-nv-primary" />Можно добавить по пути</h3>
      <p class="mb-2 text-[10px] text-nv-on-surface-variant">Освободилось время — вот что рядом.</p>
      <div v-for="add in draft.additions" :key="add.suggestionId" class="mb-2 last:mb-0 flex items-start gap-2 rounded-xl border border-nv-outline-variant/40 bg-nv-surface-lowest p-2.5">
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold truncate">{{ add.poi.name }}</p>
          <p class="mt-0.5 text-[10px] text-nv-on-surface-variant">
            <span class="font-semibold text-nv-primary">{{ formatDelta(add.delta.totalMinutes) }} мин</span>
            <span class="mx-1">·</span><span>после добавления {{ serverMinutes(add.previewTotals.totalMinutes) }}</span>
            <template v-if="add.previewTotals.remainingMinutes != null"><span class="mx-1">·</span><span>останется {{ serverMinutes(add.previewTotals.remainingMinutes) }}</span></template>
          </p>
        </div>
        <Button size="sm" class="shrink-0 h-8 text-xs" :disabled="loading" @click="emit('acceptAddition', add.suggestionId)"><Plus class="size-3 mr-1" />Добавить</Button>
      </div>
    </div>

    <!-- Replacements: distinct swap options for one place. -->
    <div v-if="draft.replacements?.length" class="rounded-2xl border border-nv-primary/30 bg-nv-primary-container/10 p-3">
      <h3 class="mb-0.5 text-xs font-bold flex items-center gap-1"><Shuffle class="size-3.5 text-nv-primary" />Чем заменить</h3>
      <p class="mb-2 text-[10px] text-nv-on-surface-variant">Другие точки рядом — той же категории, где возможно.</p>
      <div v-for="opt in draft.replacements" :key="opt.suggestionId" class="mb-2 last:mb-0 flex items-start gap-2 rounded-xl border border-nv-outline-variant/40 bg-nv-surface-lowest p-2.5">
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold truncate">{{ opt.poi.name }}</p>
          <p class="mt-0.5 text-[10px] text-nv-on-surface-variant"><span class="text-nv-primary">{{ opt.reason }}</span> · после замены {{ serverMinutes(opt.previewTotals.totalMinutes) }}</p>
        </div>
        <Button size="sm" variant="outline" class="shrink-0 h-8 text-xs" :disabled="loading" @click="emit('acceptReplacement', opt.suggestionId)">Заменить</Button>
      </div>
    </div>

    <!-- Alternatives -->
    <div v-if="draft.alternatives?.length" class="rounded-2xl border border-nv-outline-variant/60 bg-nv-surface-lowest p-3">
      <h3 class="mb-2 text-xs font-semibold">Альтернативы ({{ draft.alternatives.length }})</h3>
      <div v-for="alt in draft.alternatives" :key="alt.alternativeId" class="mb-2 last:mb-0 rounded-xl border border-nv-outline-variant/40 bg-nv-surface-low p-2.5">
        <p class="text-xs font-bold">{{ alt.explanation }}</p>
        <p class="mt-1 text-[10px] text-nv-on-surface-variant">{{ serverMinutes(alt.previewTotals.totalMinutes) }} · в пути {{ serverMinutes(alt.previewTotals.travelMinutes) }} · на местах {{ serverMinutes(alt.previewTotals.stopMinutes) }}</p>
        <ol class="mt-2 space-y-1 text-[11px]"><li v-for="(place, index) in alt.places" :key="place.id" class="flex gap-2"><span class="text-nv-on-surface-variant">{{ index + 1 }}.</span><span>{{ place.name }}</span></li></ol>
        <div v-if="alt.selectionSummary" class="mt-2 rounded-lg bg-nv-surface-lowest p-2 text-[10px] text-nv-on-surface-variant"><p>{{ alt.selectionSummary.selectedPlaces }} мест · {{ alt.selectionSummary.selectedUniquePois }} уникальных POI</p><p v-for="hint in summaryHints(alt.selectionSummary)" :key="hint">{{ hint }}</p></div>
        <Button size="sm" variant="outline" class="mt-2 h-8 text-xs" :disabled="loading" @click="emit('selectAlternative', alt.alternativeId)"><CheckCircle2 class="size-3 mr-1" />Выбрать этот вариант</Button>
      </div>
    </div>

    <div v-for="(place, index) in draft.places" :key="place.id" class="relative pl-7">
      <span class="absolute left-2 top-0 h-full w-px bg-nv-outline-variant" />
      <button type="button" class="absolute left-0 top-3 grid size-6 place-items-center rounded-full border-2 border-nv-primary bg-nv-surface-lowest text-[10px] font-bold" :aria-label="`Остановка ${index + 1}`">{{ index + 1 }}</button>
      <div class="rounded-xl border border-nv-outline-variant/60 bg-nv-surface-lowest p-2">
        <button type="button" class="flex min-h-11 w-full items-center gap-2 text-left" :aria-expanded="expanded === place.id" :aria-label="`Открыть остановку ${place.name}`" @click="expanded = expanded === place.id ? null : place.id">
          <span class="flex-1"><b class="block text-sm">{{ place.name }}</b><small class="text-nv-on-surface-variant">{{ place.dwellMinutes }} мин · {{ place.pois.length }} POI</small></span>
          <ChevronDown class="size-4" />
        </button>
        <div v-if="expanded === place.id" class="flex flex-col gap-2 border-t border-nv-outline-variant/50 pt-2">
          <ToggleGroup type="single" :model-value="place.visitMode" class="grid grid-cols-4" aria-label="Режим посещения" @update:model-value="v => setMode(place, v)">
            <ToggleGroupItem value="pass_by" aria-label="Проехать мимо">Мимо</ToggleGroupItem>
            <ToggleGroupItem value="glance" aria-label="Беглый взгляд">Взгляд</ToggleGroupItem>
            <ToggleGroupItem value="visit" aria-label="Осмотр">Осмотр</ToggleGroupItem>
            <ToggleGroupItem value="custom" aria-label="Своя длительность">Своё</ToggleGroupItem>
          </ToggleGroup>
          <label v-if="place.visitMode === 'custom'" class="flex items-center justify-between gap-2 text-xs">Своя длительность <input type="number" min="1" max="480" step="1" inputmode="numeric" class="w-20 rounded border border-nv-outline-variant bg-nv-surface-low px-2 py-1" :value="place.customVisitMinutes || 15" aria-label="Своя длительность в минутах" @change="setCustomMinutes(place, $event)" /></label>
          <ul class="text-xs text-nv-on-surface-variant"><li v-for="poi in place.pois" :key="poi.id"><button type="button" class="flex w-full items-center gap-1 py-0.5 text-left hover:text-nv-primary" :aria-label="`Открыть карточку «${poi.name}»`" @click="emit('viewPoi', poi.id)"><span aria-hidden="true">•</span><span class="truncate">{{ poi.name }}</span></button></li></ul>
          <div class="grid grid-cols-3 gap-1.5">
            <button type="button" class="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border py-1 text-[10px] font-medium" :class="place.locked ? 'border-nv-primary text-nv-primary' : 'border-nv-outline-variant/60 text-nv-on-surface-variant'" :aria-label="place.locked ? 'Открепить остановку' : 'Закрепить остановку'" @click="emit('lock', place.id, !place.locked)"><Lock v-if="place.locked" class="size-4" /><LockOpen v-else class="size-4" /><span>{{ place.locked ? 'Открепить' : 'Закрепить' }}</span></button>
            <button type="button" class="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border border-nv-outline-variant/60 py-1 text-[10px] font-medium text-nv-on-surface-variant" aria-label="Предложить замену этой остановки" @click="emit('replacePlace', place.id)"><Shuffle class="size-4" /><span>Заменить</span></button>
            <button type="button" class="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border border-nv-outline-variant/60 py-1 text-[10px] font-medium text-nv-error" aria-label="Удалить остановку" @click="emit('remove', place.id)"><Trash2 class="size-4" /><span>Удалить</span></button>
          </div>
        </div>
      </div>
    </div>

    <Button v-if="draft.version > 1" variant="outline" class="min-h-11 w-full" :disabled="loading" @click="emit('undo')">
      <RotateCcw class="size-4 mr-1.5" />Отменить
    </Button>

    <div class="sticky bottom-0 flex gap-2 border-t border-nv-outline-variant/60 bg-nv-surface-lowest p-3">
      <button type="button" class="min-h-11 flex-1 rounded-[10px] border border-nv-outline-variant/70 text-xs font-semibold transition active:scale-[0.97] disabled:opacity-50" :disabled="!draft.route||loading" @click="emit('download-gpx')"><Download class="mr-1 inline size-4"/>GPX</button>
      <button type="button" class="min-h-11 flex-1 rounded-[10px] bg-nv-primary text-xs font-semibold text-nv-on-primary transition active:scale-[0.97] disabled:opacity-50" :disabled="!canPublish||loading" @click="emit('publish')">{{draft.publishedRouteId?'Сохранено':'Сохранить'}}</button>
    </div>
  </section>
</template>
