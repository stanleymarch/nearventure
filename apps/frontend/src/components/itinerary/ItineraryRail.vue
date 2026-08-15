<script setup lang="ts">
import { computed, ref } from 'vue';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Download, Flag, Info, Loader2, Plus, RefreshCw, RotateCcw, Route, Save, Shuffle, Sparkles, X } from 'lucide-vue-next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import BudgetSummary from './BudgetSummary.vue';
import PlaceNode from './PlaceNode.vue';
import type { ItineraryDraft, VisitMode, AutoFillPreset, SelectionSummary } from '@/api/itineraries';

type EnrichedSuggestion = { id: string; name: string; category: string; lat: number; lon: number; detourMinutes: number };
const props = defineProps<{ draft: ItineraryDraft; loading?: boolean; error?: string | null; offline?: boolean; compactHeader?: boolean; preferredCategories?: string[]; previewAlternativeId?: string | null; enrichedSuggestions?: EnrichedSuggestion[] }>();
const emit = defineEmits<{ mode: [placeId: string, mode: VisitMode, custom?: number]; lock: [placeId: string, locked: boolean]; remove: [placeId: string]; reorder: [ids: string[]]; budgetMode: [mode: 'whole_trip' | 'travel_only' | 'unlimited']; topology: [loop: boolean]; pickFinish: []; clearFinish: []; undo: []; applySmartFix: [suggestionId: string]; acceptAddition: [suggestionId: string]; addEnriched: [suggestion: EnrichedSuggestion]; replacePlace: [placeId: string]; acceptReplacement: [suggestionId: string]; selectAlternative: [alternativeId: string]; previewAlternative: [alternativeId: string]; clearPreview: []; autoFill: [categories: string[], seed?: number, preset?: AutoFillPreset]; close: []; restart: []; publish: []; 'download-gpx': [] }>();

const segment = computed(() => props.draft.route ? `${Math.round(props.draft.route.duration / 60)} мин · ${(props.draft.route.distance / 1000).toFixed(1)} км` : 'Геометрия появится после построения');
const canPublish = computed(() => !!props.draft.route && !!props.draft.totals.feasible && !props.draft.publishedRouteId);
// Geometry-derived caveats (e.g. an unavoidable out-and-back stem). The
// backend recomputes these on every replan so they always match the shown line.
const routeWarnings = computed(() => props.draft.warnings ?? []);
// Truthful low-supply signal from the last auto-fill: the count of distinct
// candidate clusters that existed in the reachable area. Cleared on any manual
// edit, so it never describes a stale pool.
const lowSupply = computed(() => {
  const s = props.draft.autoFillSummary;
  return s && s.candidateClusters <= 4 ? s : null;
});
const selectionHints = computed(() => summaryHints(props.draft.autoFillSummary));
function move(index: number, delta: number) { const ids = props.draft.places.map(p => p.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; emit('reorder', ids); }

// ── Preset selector ──
const presetOptions: { value: AutoFillPreset; label: string; desc: string }[] = [
  { value: 'balanced', label: 'Сбалансированный', desc: 'Баланс времени, дороги и мест' },
  { value: 'more_places', label: 'Больше мест', desc: 'Больше коротких остановок' },
  { value: 'scenic', label: 'Живописный', desc: 'Меньше повторов дорог, когда сеть позволяет' },
  { value: 'training', label: 'Тренировка', desc: 'Дистанция и набор высоты важнее остановок' },
];
const selectedPreset = ref<AutoFillPreset>(props.draft.preset || 'balanced');
const safeAdditions = computed(() => {
  const seen = new Set<string>();
  return [
    ...(props.draft.additions ?? []).map((add) => ({ kind: 'draft' as const, id: add.poi.id, add })),
    ...(props.enrichedSuggestions ?? []).map((suggestion) => ({ kind: 'enriched' as const, id: suggestion.id, suggestion })),
  ].filter((item) => !seen.has(item.id) && !!seen.add(item.id)).slice(0, 3);
});

// ── Delta helper ──
function formatDelta(val: number): string {
  if (val === 0) return '0';
  return (val > 0 ? '+' : '') + Math.round(val).toString();
}
function signClass(val: number): string {
  if (val === 0) return '';
  return val > 0 ? 'text-destructive' : 'text-green-600';
}
function serverMinutes(value: number | null): string {
  if (value == null) return '—';
  return Number.isInteger(value) ? `${value} мин` : `${value.toFixed(1)} мин`;
}
function confidenceLabel(summary?: SelectionSummary): string | null {
  if (!summary) return null;
  if (summary.networkConfidence === 'approximate_isochrone') return 'Зона приблизительная; выбранные места проверены по дорожной сети.';
  if (summary.networkConfidence === 'best_confirmed') return 'Показан лучший вариант, подтверждённый до завершения расчёта.';
  return 'Маршрут подтверждён по дорожной сети.';
}
function summaryHints(summary?: SelectionSummary): string[] {
  if (!summary) return [];
  const hints: string[] = [];
  if (summary.localityGuardApplied && summary.unusedBudgetIntentional) hints.push('Компактный локальный маршрут; часть времени оставлена в запасе.');
  const confidence = confidenceLabel(summary);
  if (confidence) hints.push(confidence);
  if (summary.maxAutomaticExcursionMinutes != null) hints.push(`Самый дальний автоматический выезд: ${serverMinutes(summary.maxAutomaticExcursionMinutes)}.`);
  return hints;
}
</script>
<template>
  <aside class="flex h-full min-h-0 flex-col bg-background" aria-label="Маршрут путешествия" aria-live="polite">
    <header v-if="!compactHeader" class="border-b px-5 py-4">
      <div class="flex items-center gap-2">
        <span class="grid size-9 place-items-center rounded-full border-2 border-primary text-primary"><Route class="size-4" /></span>
        <div><h2 class="font-bold">Маршрут</h2><p class="text-xs text-muted-foreground">{{ segment }}</p></div>
        <button type="button" class="ml-auto grid size-11 min-h-11 min-w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-[transform,background-color,border-color] duration-100 hover:bg-accent hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" aria-label="Свернуть панель маршрута" @click="emit('close')"><X class="size-5" /></button>
      </div>
    </header>
    <ScrollArea class="min-h-0 flex-1">
      <div class="flex flex-col gap-4 p-4">
        <Skeleton v-if="loading" class="h-2 w-full rounded-full" aria-label="Обновляем маршрут, последняя версия остаётся на карте" />
        <BudgetSummary :draft="draft" @change-mode="mode => emit('budgetMode', mode)" />

        <section class="rounded-xl border border-border p-3" aria-label="Топология маршрута">
          <h3 class="text-sm font-bold">Куда закончится маршрут</h3>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button type="button" class="min-h-11 rounded-lg border px-2 text-left text-xs font-semibold transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" :class="draft.loop ? 'border-primary bg-primary/10 text-primary' : 'border-border'" :aria-pressed="draft.loop" @click="emit('topology', true)"><RefreshCw class="mb-1 size-4" />Вернуться к старту</button>
            <button type="button" class="min-h-11 rounded-lg border px-2 text-left text-xs font-semibold transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" :class="!draft.loop ? 'border-primary bg-primary/10 text-primary' : 'border-border'" :aria-pressed="!draft.loop" @click="emit('topology', false)"><ArrowRight class="mb-1 size-4" />Открытый маршрут</button>
          </div>
          <div v-if="!draft.loop" class="relative mt-2">
            <button type="button" class="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border px-3 text-left text-xs transition-[transform,background-color,border-color] duration-100 hover:bg-accent/50 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" @click="emit('pickFinish')"><Flag class="size-4 text-primary" /><span class="min-w-0 flex-1"><b class="block">Финиш</b><span class="block truncate text-muted-foreground">{{ draft.finish ? `${draft.finish.lat.toFixed(3)}, ${draft.finish.lon.toFixed(3)}` : 'Последнее место или точка на карте' }}</span></span></button>
            <button v-if="draft.finish" type="button" class="absolute right-1 top-0 grid size-11 place-items-center rounded-lg text-muted-foreground transition-[transform,background-color,border-color] duration-100 hover:bg-accent active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" aria-label="Убрать финиш" @click.stop="emit('clearFinish')"><X class="size-4" /></button>
          </div>
        </section>

        <!-- Route caveats: geometry truth the user must see before exporting. -->
        <Alert v-for="w in routeWarnings" :key="w.code" class="border-amber-500/40 bg-amber-500/10">
          <AlertTriangle class="size-4 text-amber-600" />
          <AlertDescription class="text-amber-900">{{ w.message }}</AlertDescription>
        </Alert>

        <!-- Low-supply nudge: the reachable area had few candidate stops. -->
        <Alert v-if="lowSupply" class="border-border bg-muted/20">
          <Info class="size-4 text-muted-foreground" />
          <AlertDescription class="text-muted-foreground">В зоне достигаемости немного подходящих мест ({{ lowSupply.candidateClusters }}). Увеличьте время или смените категорию, чтобы увидеть больше.</AlertDescription>
        </Alert>

        <Alert v-for="hint in selectionHints" :key="hint" class="border-border bg-muted/20">
          <Info class="size-4 text-muted-foreground" />
          <AlertDescription class="text-muted-foreground">{{ hint }}</AlertDescription>
        </Alert>

        <!-- Preset selector -->
        <section v-if="draft.intent === 'auto_budget' && draft.budgetMode !== 'unlimited'" class="rounded-xl border border-border p-3">
          <h3 class="mb-2 text-sm font-bold flex items-center gap-1.5"><Sparkles class="size-4" />Режим подбора</h3>
          <div class="grid grid-cols-2 gap-1.5">
            <button v-for="opt in presetOptions" :key="opt.value" type="button"
              class="rounded-lg border px-2.5 py-2 text-left text-[13px] font-semibold transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              :aria-pressed="selectedPreset === opt.value"
              :class="selectedPreset === opt.value ? 'border-primary bg-primary/10 font-semibold' : 'border-border/60 hover:border-primary/40'"
              @click="selectedPreset = opt.value; emit('autoFill', preferredCategories ?? [], undefined, opt.value)">
              <span class="block">{{ opt.label }}</span>
              <span class="block text-[13px] leading-snug text-muted-foreground mt-1">{{ opt.desc }}</span>
            </button>
          </div>
        </section>

        <Alert v-else-if="draft.intent === 'auto_budget'" class="border-border bg-muted/20">
          <AlertTitle>Автоподбору нужен лимит времени</AlertTitle>
          <AlertDescription>Установите бюджет, чтобы определить зону достижимости и предложить остановки.</AlertDescription>
        </Alert>

        <Alert v-if="error" variant="destructive">
          <AlertCircle class="size-4" />
          <AlertTitle>{{ offline ? 'Нет сети' : 'Нужно обновить маршрут' }}</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <Alert v-if="!draft.places.length">
          <AlertTitle>Пока нет остановок</AlertTitle>
          <AlertDescription>Выберите место на карте — оно станет первым узлом нити.</AlertDescription>
        </Alert>

        <!-- Smart fixes -->
        <section v-if="!draft.totals.feasible && draft.suggestions.length" class="rounded-xl border border-border p-3">
          <h3 class="text-sm font-bold flex items-center gap-1.5"><Sparkles class="size-4" />Как уложиться в бюджет</h3>
          <div v-for="fix in draft.suggestions" :key="fix.suggestionId" class="mt-2 flex items-start gap-2 rounded-lg border border-border/50 bg-muted/30 p-2.5">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium">{{ fix.reason }}</p>
              <p v-if="fix.delta" class="mt-1 text-[10px] text-muted-foreground">
                <span :class="signClass(fix.delta.totalMinutes)">{{ formatDelta(fix.delta.totalMinutes) }} мин</span>
                <span class="mx-1">·</span>
                <span>после применения {{ serverMinutes(fix.previewTotals.totalMinutes) }}</span>
              </p>
            </div>
            <Button size="sm" variant="outline" class="shrink-0" :disabled="loading" @click="emit('applySmartFix', fix.suggestionId)">
              <CheckCircle2 class="size-3.5 mr-1" />Применить
            </Button>
          </div>
        </section>

        <!-- Additions: after `Мимо`/removal, transparent nearby POIs that fit freed budget. Never auto-added. -->
        <section v-if="safeAdditions.length" class="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <h3 class="text-sm font-bold flex items-center gap-1.5"><Sparkles class="size-4 text-primary" />Можно добавить по пути</h3>
          <p class="mt-0.5 text-[13px] text-muted-foreground">Подходят по текущему бюджету.</p>
          <div v-for="item in safeAdditions" :key="item.id" class="mt-2 flex items-start gap-2 rounded-lg border border-border/50 bg-background/60 p-2.5">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-semibold truncate">{{ item.kind === 'draft' ? item.add.poi.name : item.suggestion.name }}</p>
              <p class="mt-0.5 text-[13px] text-muted-foreground">
                <template v-if="item.kind === 'draft'"><span class="text-primary font-medium">{{ formatDelta(item.add.delta.totalMinutes) }} мин</span><span class="mx-1">·</span><span>после добавления {{ serverMinutes(item.add.previewTotals.totalMinutes) }}</span><template v-if="item.add.previewTotals.remainingMinutes != null"><span class="mx-1">·</span><span>останется {{ serverMinutes(item.add.previewTotals.remainingMinutes) }}</span></template></template>
                <template v-else>+{{ item.suggestion.detourMinutes }} мин по пути</template>
              </p>
            </div>
            <Button size="sm" class="shrink-0" :disabled="loading" @click="item.kind === 'draft' ? emit('acceptAddition', item.add.suggestionId) : emit('addEnriched', item.suggestion)"><Plus class="size-3.5 mr-1" />Добавить</Button>
          </div>
        </section>

        <!-- Replacements: distinct swap options for one place, same category where possible. -->
        <section v-if="draft.replacements?.length" class="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <h3 class="text-sm font-bold flex items-center gap-1.5"><Shuffle class="size-4 text-primary" />Чем заменить</h3>
          <p class="mt-0.5 text-[11px] text-muted-foreground">Другие точки рядом — той же категории, где возможно.</p>
          <div v-for="opt in draft.replacements" :key="opt.suggestionId" class="mt-2 flex items-start gap-2 rounded-lg border border-border/50 bg-background/60 p-2.5">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-semibold truncate">{{ opt.poi.name }}</p>
              <p class="mt-0.5 text-[10px] text-muted-foreground">
                <span class="text-primary font-medium">{{ opt.reason }}</span>
                <span class="mx-1">·</span>
                <span>после замены {{ serverMinutes(opt.previewTotals.totalMinutes) }}</span>
              </p>
            </div>
            <Button size="sm" variant="outline" class="shrink-0" :disabled="loading" @click="emit('acceptReplacement', opt.suggestionId)">Заменить</Button>
          </div>
        </section>

        <!-- Qualitative summary instead of a raw numeric score; the user cannot
             act on a number, but can act on locality/confidence hints. -->
        <section v-if="selectionHints.length" class="rounded-xl border border-border p-3">
          <h3 class="mb-2 text-sm font-bold">Почему этот маршрут</h3>
          <ul class="space-y-1.5 text-xs text-muted-foreground">
            <li v-for="hint in selectionHints" :key="hint" class="flex items-start gap-1.5"><Info class="mt-0.5 size-3.5 shrink-0" />{{ hint }}</li>
          </ul>
        </section>

        <!-- Alternatives -->
        <section v-if="draft.alternatives?.length" class="rounded-xl border border-border p-3">
          <h3 class="text-sm font-bold mb-2">Альтернативы ({{ draft.alternatives.length }})</h3>
          <div v-for="alt in draft.alternatives" :key="alt.alternativeId" class="mb-2 last:mb-0 rounded-lg border border-border/50 bg-muted/20 p-2.5">
            <p class="text-xs font-bold">{{ alt.explanation }}</p>
            <p class="mt-1 text-[10px] text-muted-foreground">
              {{ serverMinutes(alt.previewTotals.totalMinutes) }} · {{ alt.places.length }} мест · в пути {{ serverMinutes(alt.previewTotals.travelMinutes) }} · на местах {{ serverMinutes(alt.previewTotals.stopMinutes) }}
            </p>
            <ol class="mt-2 space-y-1 text-[11px]">
              <li v-for="(place, index) in alt.places" :key="place.id" class="flex gap-2"><span class="text-muted-foreground">{{ index + 1 }}.</span><span class="font-medium">{{ place.name }}</span></li>
            </ol>
            <div v-if="alt.selectionSummary" class="mt-2 space-y-1 rounded-lg bg-background/70 p-2 text-[10px] text-muted-foreground">
              <p>{{ alt.selectionSummary.selectedPlaces }} мест · {{ alt.selectionSummary.selectedUniquePois }} уникальных POI</p>
              <p v-for="hint in summaryHints(alt.selectionSummary)" :key="hint">{{ hint }}</p>
            </div>
            <p v-if="previewAlternativeId === alt.alternativeId" class="mt-2 text-[13px] text-primary" role="status">Просматривается вариант</p>
            <Button v-if="previewAlternativeId === alt.alternativeId" size="sm" variant="outline" class="mt-2" :disabled="loading" @click="emit('clearPreview')"><X class="size-3.5 mr-1" />Вернуть текущий</Button>
            <Button v-else size="sm" variant="outline" class="mt-2" :disabled="loading" :aria-busy="loading" @click="emit('previewAlternative', alt.alternativeId)"><Route class="size-3.5 mr-1" />Показать на карте</Button>
            <Button size="sm" variant="ghost" class="mt-2" :disabled="loading" @click="emit('selectAlternative', alt.alternativeId)"><CheckCircle2 class="size-3.5 mr-1" />Выбрать этот вариант</Button>
          </div>
        </section>

        <div class="flex flex-col gap-2">
          <PlaceNode v-for="(place, index) in draft.places" :key="place.id" :place="place" :index="index" :first="index === 0" :last="index === draft.places.length - 1" :busy="loading"
            @mode="(mode, custom) => emit('mode', place.id, mode, custom)"
            @lock="(locked) => emit('lock', place.id, locked)"
            @remove="emit('remove', place.id)"
            @move="delta => move(index, delta)"
            @replace="emit('replacePlace', place.id)" />
        </div>

        <Button v-if="draft.version > 1" variant="outline" class="min-h-11" :disabled="loading" @click="emit('undo')">
          <RotateCcw data-icon="inline-start" />Отменить последнее изменение
        </Button>
        <Button v-if="!draft.publishedRouteId" variant="outline" class="min-h-11 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" :disabled="loading" @click="emit('restart')">
          <X data-icon="inline-start" />Начать заново
        </Button>
        <Button v-else variant="outline" class="min-h-11" :disabled="loading" @click="emit('restart')">
          <Plus data-icon="inline-start" />Создать новый маршрут
        </Button>
        <div class="sticky bottom-0 -mx-4 -mb-4 mt-4 flex gap-2 border-t border-border bg-background/95 p-4 backdrop-blur">
          <Button variant="outline" class="min-h-11 flex-1 gap-1.5" :disabled="!draft.route||loading" @click="emit('download-gpx')"><Download class="size-4"/>GPX</Button>
          <Button class="min-h-11 flex-1 gap-1.5" :disabled="!canPublish||loading" @click="emit('publish')"><Loader2 v-if="loading" class="size-4 animate-spin"/><CheckCircle2 v-else-if="draft.publishedRouteId" class="size-4"/><Save v-else class="size-4"/>{{ draft.publishedRouteId ? 'Сохранено':'Сохранить маршрут' }}</Button>
        </div>
      </div>
    </ScrollArea>
  </aside>
</template>
