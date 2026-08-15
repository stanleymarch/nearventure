<script setup lang="ts">
import { computed } from 'vue';
import type { RoadFact, RouteQuality } from '../../api/routing-contracts';

const props = defineProps<{
  quality?: RouteQuality;
  roadFacts?: RoadFact[];
  ascend?: number;
  descend?: number;
}>();

const warningText: Record<string, string> = {
  ROUTE_UNAVAILABLE: 'Маршрут не содержит проверяемой дорожной геометрии.',
  ROUTE_NOT_NETWORK_CONFIRMED: 'Маршрут не подтверждён дорожной сетью.',
  BUDGET_EXCEEDED: 'Маршрут превышает заданный бюджет времени.',
  LOOP_NOT_CLOSED: 'Запрошенное кольцо не замыкается в точке старта.',
  UNAVOIDABLE_OUT_AND_BACK: 'Часть пути неизбежно повторяется.',
};
const factLabels: Record<RoadFact['kind'], string> = {
  road_class: 'Дорога',
  surface: 'Покрытие',
  road_environment: 'Среда',
  track_type: 'Трек',
};
const warnings = computed(() => (props.quality?.warnings ?? [])
  .map((warning) => warningText[warning] ?? `Предупреждение маршрута: ${warning}.`));
const facts = computed(() => (props.roadFacts ?? [])
  .filter((fact) => fact.values?.length)
  .map((fact) => ({
    label: factLabels[fact.kind],
    values: fact.values.slice(0, 2).map((value) => `${value.value} ${Math.round(value.share * 100)}%`).join(', '),
  })));
const hasElevation = computed(() => Number.isFinite(props.ascend) || Number.isFinite(props.descend));
</script>

<template>
  <section v-if="warnings.length || facts.length || hasElevation" class="mt-2 space-y-1.5 text-xs" aria-label="Факты маршрута">
    <p v-for="warning in warnings" :key="warning" class="rounded-lg border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 font-medium text-foreground">
      <strong>Внимание:</strong> {{ warning }}
    </p>
    <p v-if="facts.length" class="text-muted-foreground">
      <span v-for="fact in facts" :key="fact.label" class="mr-2 inline-block"><strong class="text-foreground">{{ fact.label }}:</strong> {{ fact.values }}</span>
    </p>
    <p v-if="hasElevation" class="text-muted-foreground">
      <strong class="text-foreground">Высоты:</strong> ↑{{ Math.round(ascend ?? 0) }} м · ↓{{ Math.round(descend ?? 0) }} м
    </p>
  </section>
</template>
