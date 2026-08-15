<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, Clock3, Route } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { ItineraryDraft } from '@/api/itineraries';
const props = defineProps<{ draft: ItineraryDraft }>();
const emit = defineEmits<{ changeMode: [mode: 'whole_trip' | 'travel_only' | 'unlimited'] }>();
const pct = computed(() => props.draft.totals.budgetMinutes == null ? 0 : Math.min(100, Math.round(props.draft.totals.totalMinutes / props.draft.totals.budgetMinutes * 100)));
const minutes = (n: number) => `${Math.round(n)} мин`;
const budgetLabel = computed(() => props.draft.totals.budgetMinutes == null ? 'без лимита' : minutes(props.draft.totals.budgetMinutes));
const budgetStatus = computed(() => props.draft.budgetMode === 'unlimited' ? 'Без лимита' : props.draft.totals.feasible ? 'В бюджете' : `+${minutes(props.draft.totals.overBudgetMinutes)}`);
</script>
<template>
  <section class="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-card" aria-label="Сводка времени">
    <div class="flex items-center justify-between gap-2"><div><p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Время</p><p class="text-lg font-bold">{{ minutes(draft.totals.totalMinutes) }} <span class="text-sm font-medium text-muted-foreground">из {{ budgetLabel }}</span></p></div><Badge :variant="draft.totals.feasible ? 'secondary' : 'destructive'">{{ budgetStatus }}</Badge></div>
    <div v-if="draft.budgetMode !== 'unlimited'" class="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="Math.round(draft.totals.totalMinutes)" aria-valuemin="0" :aria-valuemax="draft.totals.budgetMinutes ?? undefined" :aria-valuetext="`${minutes(draft.totals.totalMinutes)} из ${minutes(draft.totals.budgetMinutes ?? 0)}`"><div class="h-full rounded-full bg-primary transition-[width]" :class="!draft.totals.feasible && 'bg-destructive'" :style="{ width: `${pct}%` }" /></div>
    <div class="mt-3 grid grid-cols-2 gap-2 text-sm"><span class="flex items-center gap-1.5"><Route class="size-4 text-primary" />В пути <b class="ml-auto">{{ minutes(draft.totals.travelMinutes) }}</b></span><span class="flex items-center gap-1.5"><Clock3 class="size-4 text-primary" />На местах <b class="ml-auto">{{ minutes(draft.totals.stopMinutes) }}</b></span></div>
    <Separator class="my-3" />
    <div class="flex gap-1 rounded-xl bg-muted p-1" aria-label="Как считать бюджет"><button type="button" class="min-h-11 flex-1 rounded-lg px-2 text-xs font-semibold" :class="draft.budgetMode === 'whole_trip' && 'bg-background shadow-sm'" @click="emit('changeMode', 'whole_trip')">Всё</button><button type="button" class="min-h-11 flex-1 rounded-lg px-2 text-xs font-semibold" :class="draft.budgetMode === 'travel_only' && 'bg-background shadow-sm'" @click="emit('changeMode', 'travel_only')">Дорога</button><button type="button" class="min-h-11 flex-1 rounded-lg px-2 text-xs font-semibold" :class="draft.budgetMode === 'unlimited' && 'bg-background shadow-sm'" @click="emit('changeMode', 'unlimited')">Без лимита</button></div>
    <p v-if="draft.budgetMode !== 'unlimited' && !draft.totals.feasible" class="mt-3 flex gap-2 text-sm text-destructive"><AlertTriangle class="mt-0.5 size-4 shrink-0" />Можно продолжать редактирование: места не будут удалены автоматически.</p>
  </section>
</template>
