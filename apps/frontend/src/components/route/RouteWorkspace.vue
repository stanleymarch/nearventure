<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  ArrowLeft,
  ArrowRight,
  Bike,
  Car,
  Clock3,
  Flag,
  Footprints,
  Infinity as InfinityIcon,
  Loader2,
  LocateFixed,
  MapPinned,
  RefreshCw,
  Route as RouteIcon,
  Sparkles,
  X,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CATEGORY_LUCIDE } from '@/lib/category-icons';
import { CATEGORY_ORDER, CATEGORY_STYLES, type PoiCategory } from '@/lib/poi-categories';
import type { AutoFillPreset, BudgetMode } from '@/api/itineraries';
import { ROUTING_PROFILE_LABELS, type RoutingProfile } from '@/api/routing-contracts';

type RouteMode = 'auto' | 'manual';
type PlannerStep = 'conditions' | 'preferences' | 'review';

const props = defineProps<{
  routeMode: RouteMode;
  profile: RoutingProfile;
  locating: boolean;
  startLabel?: string;
  finishLabel?: string;
  pickingFinish?: boolean;
  timeMinutes: number;
  timeLabel: string;
  distanceHint: string;
  budgetMode: BudgetMode;
  loop: boolean;
  preset: AutoFillPreset;
  activeCategories: PoiCategory[];
  routeScopeLabel: string;
  hiddenCategoryCount: number;
  selectedWaypointCount: number;
  canAdventure: boolean;
  /** `null` while health is unknown; do not label modes unavailable yet. */
  availableProfiles?: Array<'bike' | 'mtb' | 'foot' | 'car' | 'bike_touring' | 'mtb_leisure' | 'foot_scenic'> | null;
  routingStatus?: 'checking' | 'ready' | 'unavailable';
  loading: boolean;
  summaryLoading: boolean;
}>();

const emit = defineEmits<{
  (e: 'locate'): void;
  (e: 'pick-finish'): void;
  (e: 'clear-finish'): void;
  (e: 'profile', value: RoutingProfile): void;
  (e: 'retry-routing'): void;
  (e: 'route-mode', value: RouteMode): void;
  (e: 'toggle-category', value: PoiCategory): void;
  (e: 'update:time-minutes', value: number): void;
  (e: 'update:budget-mode', value: BudgetMode): void;
  (e: 'update:loop', value: boolean): void;
  (e: 'update:preset', value: AutoFillPreset): void;
  (e: 'build'): void;
  (e: 'close'): void;
}>();

const step = ref<PlannerStep>('conditions');
watch(() => props.routeMode, () => { step.value = 'conditions'; });

const steps: { value: PlannerStep; label: string }[] = [
  { value: 'conditions', label: 'Условия' },
  { value: 'preferences', label: 'Интересы' },
  { value: 'review', label: 'Проверка' },
];
const stepIndex = computed(() => steps.findIndex((item) => item.value === step.value));
const isManual = computed(() => props.routeMode === 'manual');
const isUnlimited = computed(() => isManual.value && props.budgetMode === 'unlimited');

const WORKSPACE_LABELS: Record<PoiCategory, string> = {
  heritage: 'Наследие', monument: 'Памятники', sights: 'Места',
  religion: 'Храмы', nature: 'Природа', museum: 'Музеи',
};
const TIME_PRESETS = [60, 90, 120, 180];
const VIBE_OPTIONS: { value: AutoFillPreset; label: string; description: string }[] = [
  { value: 'balanced', label: 'Сбалансированный', description: 'Баланс времени, дороги и мест' },
  { value: 'more_places', label: 'Больше мест', description: 'Больше коротких остановок' },
  { value: 'scenic', label: 'Живописный', description: 'Меньше повторяющихся дорог и больше видов, когда сеть позволяет' },
  { value: 'training', label: 'Тренировочный', description: 'Дистанция и набор высоты важнее числа остановок' },
];

const transportLabel = computed(() => ROUTING_PROFILE_LABELS[props.profile]);
const budgetLabel = computed(() => isUnlimited.value ? 'Без ограничений' : props.timeLabel);
const topologyLabel = computed(() => props.loop ? 'Вернуться к старту' : props.finishLabel || 'Последнее место');
const presetLabel = computed(() => VIBE_OPTIONS.find((item) => item.value === props.preset)?.label ?? 'Сбалансированный');
const finalAction = computed(() => isManual.value ? 'Перейти к выбору мест' : 'Собрать маршрут');
const routingStatusText = computed(() => (props.routingStatus ?? 'checking') === 'checking'
  ? 'Проверяем доступные виды транспорта…'
  : (props.routingStatus ?? 'checking') === 'unavailable'
    ? 'Маршрутизатор недоступен. Повторите проверку на карте.'
    : props.availableProfiles?.length
      ? 'Доступность транспорта получена от маршрутизатора.'
      : 'Маршрутизатор не сообщил доступных видов транспорта.');
function profileEnabled(profile: RoutingProfile) {
  return props.availableProfiles == null || props.availableProfiles.includes(profile);
}
const profileGroups: Array<{ label: string; description: string; profiles: RoutingProfile[]; hints: Partial<Record<RoutingProfile, string>> }> = [
  { label: 'Велосипед', description: 'Асфальт и гравий', profiles: ['bike', 'bike_touring'], hints: { bike: 'Повседневные поездки', bike_touring: 'Дальние поездки и багаж' } },
  { label: 'MTB', description: 'Тропы и бездорожье', profiles: ['mtb', 'mtb_leisure'], hints: { mtb: 'Более спортивный темп', mtb_leisure: 'Спокойные MTB-прогулки' } },
  { label: 'Пешком', description: 'Прогулки и тропы', profiles: ['foot', 'foot_scenic'], hints: { foot: 'Обычный пеший маршрут', foot_scenic: 'Меньше повторов, когда сеть позволяет' } },
  { label: 'Авто', description: 'Дороги общего пользования', profiles: ['car'], hints: { car: 'Поездка на автомобиле' } },
];
const profileOptions = profileGroups.flatMap((group) => group.profiles) as readonly RoutingProfile[];
const visibleProfileGroups = computed(() => props.availableProfiles == null
  ? profileGroups
  : profileGroups.map((group) => ({ ...group, profiles: group.profiles.filter((profile) => props.availableProfiles!.includes(profile)) })).filter((group) => group.profiles.length));

function isActive(category: PoiCategory) { return props.activeCategories.includes(category); }
function setProfile(value: unknown) {
  if (typeof value === 'string' && profileOptions.includes(value as RoutingProfile)) emit('profile', value as RoutingProfile);
}
function setPreset(value: unknown) {
  if (value === 'balanced' || value === 'more_places' || value === 'scenic' || value === 'training') emit('update:preset', value);
}
function setBudgetMode(value: unknown) {
  if (value === 'whole_trip' || value === 'travel_only' || value === 'unlimited') emit('update:budget-mode', value);
}
function updateTime(event: Event) { emit('update:time-minutes', Number((event.target as HTMLInputElement).value)); }
function setTime(value: number) { emit('update:time-minutes', Math.max(15, Math.min(360, value))); }
function formatPresetTime(value: number) {
  return value % 60 ? `${Math.floor(value / 60)} ч ${value % 60}` : `${value / 60} ч`;
}
function nextStep() {
  if (step.value === 'conditions') step.value = 'preferences';
  else if (step.value === 'preferences') step.value = 'review';
}
function previousStep() {
  if (step.value === 'review') step.value = 'preferences';
  else if (step.value === 'preferences') step.value = 'conditions';
}
function onWorkspaceKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onWorkspaceKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onWorkspaceKeydown));
</script>

<template>
  <section class="route-workspace surface-floating mx-auto flex max-h-[43dvh] w-full max-w-[400px] flex-col overflow-hidden p-0" aria-label="Настройка маршрута">
    <header class="border-b border-border/70 px-4 py-2">
      <div class="flex items-center gap-3">
        <div class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Sparkles v-if="routeMode === 'auto'" class="size-5" aria-hidden="true" />
          <MapPinned v-else class="size-5" aria-hidden="true" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="font-bold leading-tight">{{ routeMode === 'auto' ? 'Подобрать маршрут' : 'Собрать из мест' }}</h2>
          <p class="text-xs text-muted-foreground">Сначала условия, затем места</p>
        </div>
        <span class="planner-short-step hidden shrink-0 text-xs font-bold text-muted-foreground" aria-live="polite">{{ stepIndex + 1 }}/3</span>
        <button type="button" class="grid size-11 min-h-11 min-w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-[transform,background-color,border-color] duration-100 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]" aria-label="Закрыть" @click="emit('close')"><X class="size-5" /></button>
      </div>
      <div class="mt-2 grid grid-cols-2 rounded-control bg-muted p-1" aria-label="Способ планирования">
        <button type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" :class="routeMode === 'auto' ? 'bg-background text-primary shadow-sm ring-1 ring-primary/30' : 'text-muted-foreground hover:text-foreground'" :aria-pressed="routeMode === 'auto'" @click="emit('route-mode', 'auto')">Автоподбор</button>
        <button type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" :class="routeMode === 'manual' ? 'bg-background text-primary shadow-sm ring-1 ring-primary/30' : 'text-muted-foreground hover:text-foreground'" :aria-pressed="routeMode === 'manual'" @click="emit('route-mode', 'manual')">Выбирать места</button>
      </div>
      <div class="mt-2 grid grid-cols-3 gap-1.5" aria-label="Выбранные условия">
        <span class="truncate rounded-lg bg-muted/70 px-2 py-1 text-center text-[0.65rem] font-semibold">{{ transportLabel }}</span>
        <span class="truncate rounded-lg bg-muted/70 px-2 py-1 text-center text-[0.65rem] font-semibold">{{ budgetLabel }}</span>
        <span class="truncate rounded-lg bg-muted/70 px-2 py-1 text-center text-[0.65rem] font-semibold">{{ loop ? 'Кольцо' : 'Линейный' }}</span>
      </div>
    </header>

    <nav class="planner-steps grid grid-cols-3 border-b border-border/70 px-4" aria-label="Шаги планирования">
      <button v-for="(item, index) in steps" :key="item.value" type="button"
        class="relative min-h-10 px-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        :class="index <= stepIndex ? 'text-foreground' : 'text-muted-foreground'" :aria-current="step === item.value ? 'step' : undefined" @click="step = item.value">
        <span>{{ index + 1 }}. {{ item.label }}</span>
        <span v-if="step === item.value" class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" aria-hidden="true" />
      </button>
    </nav>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2.5">
      <section v-if="step === 'conditions'" aria-labelledby="planner-conditions-title" class="flex flex-col gap-4">
        <div>
          <p id="planner-conditions-title" class="mb-1.5 text-xs font-semibold text-muted-foreground">1. Транспорт</p>
          <ToggleGroup type="single" :model-value="profile" class="grid w-full gap-3" aria-label="Тип транспорта" @update:model-value="setProfile">
            <section v-for="group in visibleProfileGroups" :key="group.label" class="rounded-control border border-border/70 p-2">
              <div class="mb-2"><h4 class="text-sm font-semibold text-foreground">{{ group.label }}</h4><p class="text-[13px] leading-snug text-muted-foreground">{{ group.description }}</p></div>
              <div class="grid grid-cols-2 gap-2" :class="group.profiles.length === 1 ? 'sm:grid-cols-1' : ''">
                <ToggleGroupItem v-for="option in group.profiles" :key="option" :value="option" class="transport-card min-h-[3.75rem] flex-col items-start gap-0 rounded-control border border-nv-outline px-3 py-2 text-left hover:border-nv-outline" :aria-label="ROUTING_PROFILE_LABELS[option]" :aria-description="group.hints[option]">
                  <span class="flex items-center gap-2 text-[13px] font-semibold"><Bike v-if="option.startsWith('bike') || option.startsWith('mtb')" class="size-4" /><Footprints v-else-if="option.startsWith('foot')" class="size-4" /><Car v-else class="size-4" />{{ ROUTING_PROFILE_LABELS[option] }}</span>
                  <span class="transport-card-subtitle mt-1 text-[13px] font-normal leading-snug" :class="profile === option ? 'text-primary-foreground' : 'text-muted-foreground'">{{ group.hints[option] }}</span>
                </ToggleGroupItem>
              </div>
            </section>
          </ToggleGroup>
          <p class="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">{{ routingStatusText }} <button v-if="routingStatus === 'unavailable'" type="button" class="font-semibold text-primary underline" @click="emit('retry-routing')">Повторить</button></p>
        </div>

        <div>
          <div class="flex items-end justify-between gap-3">
            <div><p class="text-xs font-semibold text-muted-foreground">2. Время</p><h3 class="mt-0.5 text-2xl font-extrabold tabular-nums">{{ budgetLabel }}</h3></div>
            <span v-if="!isUnlimited" class="text-xs font-medium text-muted-foreground">примерно {{ distanceHint }}</span>
          </div>
          <template v-if="!isUnlimited">
            <input :value="timeMinutes" type="range" min="15" max="360" step="15" class="nv-range mt-2 w-full" aria-label="Бюджет времени" :aria-valuetext="timeLabel" @input="updateTime" />
            <div class="planner-time-presets mt-1.5 grid grid-cols-4 gap-2" aria-label="Быстрый выбор времени">
              <button v-for="value in TIME_PRESETS" :key="value" type="button" class="min-h-11 rounded-control border px-1 text-xs font-bold transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" :class="timeMinutes === value ? 'border-primary bg-primary/15 text-primary shadow-sm' : 'border-border bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground'" :aria-pressed="timeMinutes === value" @click="setTime(value)">{{ formatPresetTime(value) }}</button>
            </div>
          </template>
          <ToggleGroup v-if="isManual" type="single" :model-value="budgetMode" class="mt-2 grid w-full grid-cols-3 gap-1" aria-label="Как считать время" @update:model-value="setBudgetMode">
            <ToggleGroupItem value="whole_trip" class="min-h-11 rounded-control border border-border text-[0.65rem]">Всё путешествие</ToggleGroupItem>
            <ToggleGroupItem value="travel_only" class="min-h-11 rounded-control border border-border text-[0.65rem]">Только дорога</ToggleGroupItem>
            <ToggleGroupItem value="unlimited" class="min-h-11 rounded-control border border-border text-[0.65rem]"><InfinityIcon class="size-4" />Без ограничений</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div>
          <p class="mb-1.5 text-xs font-semibold text-muted-foreground">3. Топология</p>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="min-h-12 rounded-control border px-3 text-left text-xs font-semibold transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" :class="loop ? 'border-primary bg-primary/15 text-primary shadow-sm' : 'border-border bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground'" :aria-pressed="loop" @click="emit('update:loop', true)"><RefreshCw class="mb-1 size-4" />Вернуться к старту</button>
            <button type="button" class="min-h-12 rounded-control border px-3 text-left text-xs font-semibold transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" :class="!loop ? 'border-primary bg-primary/15 text-primary shadow-sm' : 'border-border bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground'" :aria-pressed="!loop" @click="emit('update:loop', false)"><ArrowRight class="mb-1 size-4" />Закончить в пути</button>
          </div>
        </div>

        <div class="grid gap-2" :class="loop ? 'grid-cols-1' : 'grid-cols-2'">
          <button type="button" class="flex min-h-12 items-center gap-3 rounded-control border border-border bg-card px-3 text-left text-muted-foreground transition-[transform,background-color,border-color] duration-100 hover:bg-accent/50 hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" :disabled="locating" @click="emit('locate')">
            <Loader2 v-if="locating" class="size-5 shrink-0 animate-spin text-primary" /><LocateFixed v-else class="size-5 shrink-0 text-primary" />
            <span class="min-w-0"><span class="block text-xs text-muted-foreground">Старт</span><b class="block truncate text-sm">{{ startLabel || 'Указать на карте' }}</b></span>
          </button>
          <div v-if="!loop" class="relative">
            <button type="button" class="flex min-h-12 w-full items-center gap-3 rounded-control border px-3 text-left transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" :class="pickingFinish ? 'border-primary bg-primary/15 text-primary shadow-sm' : 'border-border bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground'" @click="emit('pick-finish')">
              <Flag class="size-5 shrink-0 text-primary" /><span class="min-w-0"><span class="block text-xs text-muted-foreground">Финиш</span><b class="block truncate text-sm">{{ finishLabel || (pickingFinish ? 'Нажмите на карту' : 'Последнее место') }}</b></span>
            </button>
            <button v-if="finishLabel" type="button" class="absolute right-1 top-1 grid size-8 place-items-center rounded-full text-muted-foreground transition-[transform,background-color,border-color] duration-100 hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" aria-label="Убрать выбранный финиш" @click.stop="emit('clear-finish')"><X class="size-4" /></button>
          </div>
        </div>
      </section>

      <section v-else-if="step === 'preferences'" aria-labelledby="planner-preferences-title" class="flex flex-col gap-4">
        <div>
          <h3 id="planner-preferences-title" class="font-bold">Что хочется встретить?</h3>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">Предпочтения ранжируют места и предложения, но ничего не добавляют автоматически в ручном режиме.</p>
          <div class="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Предпочтения маршрута">
            <button v-for="category in CATEGORY_ORDER" :key="category" type="button" class="flex min-h-11 items-center gap-2 rounded-control border px-3 text-left text-xs font-semibold transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" :class="isActive(category) ? 'border-primary bg-primary/15 text-primary shadow-sm' : 'border-border bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground'" :aria-pressed="isActive(category)" @click="emit('toggle-category', category)">
              <component :is="CATEGORY_LUCIDE[category]" class="size-4" :style="!isActive(category) ? { color: CATEGORY_STYLES[category].hex } : {}" />{{ WORKSPACE_LABELS[category] }}
            </button>
          </div>
          <p class="mt-2 text-xs text-muted-foreground">{{ routeScopeLabel }}</p>
        </div>
        <div>
          <h3 class="font-bold">Вайб маршрута</h3>
          <ToggleGroup type="single" :model-value="preset" class="mt-3 grid w-full grid-cols-2 gap-2" aria-label="Характер маршрута" @update:model-value="setPreset">
            <ToggleGroupItem v-for="option in VIBE_OPTIONS" :key="option.value" :value="option.value" class="min-h-[5rem] flex-col items-start rounded-control border border-border px-3 py-2 text-left" :aria-label="`${option.label}: ${option.description}`"><span class="text-[13px] font-semibold text-foreground">{{ option.label }}</span><span class="mt-1 text-[13px] font-normal leading-snug text-muted-foreground">{{ option.description }}</span></ToggleGroupItem>
          </ToggleGroup>
        </div>
      </section>

      <section v-else aria-labelledby="planner-review-title" class="flex flex-col gap-3">
        <div><p class="text-xs font-semibold text-muted-foreground">Условия зафиксированы</p><h3 id="planner-review-title" class="mt-0.5 text-xl font-extrabold">{{ routeMode === 'auto' ? 'Автоподбор' : 'Ручной магазин' }}</h3></div>
        <div class="divide-y divide-border/70 rounded-control border border-border bg-card">
          <button type="button" class="flex min-h-12 w-full items-center gap-3 px-3 text-left transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" @click="step = 'conditions'"><Clock3 class="size-4 text-primary" /><span class="flex-1"><b class="block text-sm">{{ transportLabel }} · {{ budgetLabel }}</b><span class="text-xs text-muted-foreground">{{ topologyLabel }}</span></span><span class="text-xs font-semibold text-primary">Изменить</span></button>
          <button type="button" class="flex min-h-12 w-full items-center gap-3 px-3 text-left transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" @click="step = 'conditions'"><MapPinned class="size-4 text-primary" /><span class="min-w-0 flex-1"><b class="block truncate text-sm">{{ startLabel || 'Старт не указан' }}</b><span class="text-xs text-muted-foreground">{{ !loop && finishLabel ? `Финиш: ${finishLabel}` : 'Точка начала маршрута' }}</span></span><span class="text-xs font-semibold text-primary">Изменить</span></button>
          <button type="button" class="flex min-h-12 w-full items-center gap-3 px-3 text-left transition-[transform,background-color,border-color] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" @click="step = 'preferences'"><RouteIcon class="size-4 text-primary" /><span class="flex-1"><b class="block text-sm">{{ presetLabel }}</b><span class="text-xs text-muted-foreground">{{ activeCategories.length }} предпочтений</span></span><span class="text-xs font-semibold text-primary">Изменить</span></button>
        </div>
        <p v-if="!startLabel" class="text-xs font-medium text-destructive">Укажите старт на карте или разрешите геолокацию.</p>
        <p v-if="isManual" class="text-xs text-muted-foreground">Дальше откроется карта и каталог. Места попадут в маршрут только после вашего действия.</p>
      </section>
    </div>

    <footer class="flex items-center gap-2 border-t border-border/70 px-4 py-1.5 [padding-bottom:max(0.375rem,env(safe-area-inset-bottom))]">
      <Button v-if="step !== 'conditions'" variant="ghost" size="icon" class="min-h-11 min-w-11 active:scale-[0.98]" aria-label="Назад" @click="previousStep"><ArrowLeft /></Button>
      <Button v-if="step !== 'review'" class="min-h-11 flex-1 active:scale-[0.98]" @click="nextStep">Продолжить <ArrowRight data-icon="inline-end" /></Button>
      <Button v-else class="min-h-11 flex-1 active:scale-[0.98]" :disabled="!canAdventure || loading || summaryLoading" @click="emit('build')"><Loader2 v-if="loading || summaryLoading" class="animate-spin" data-icon="inline-start" /><Sparkles v-else-if="routeMode === 'auto'" data-icon="inline-start" /><MapPinned v-else data-icon="inline-start" />{{ loading || summaryLoading ? 'Сохраняем условия…' : finalAction }}</Button>
    </footer>
  </section>
</template>

<style scoped>
/* The planner overlays a variable map; keep this content surface opaque so its
   boundary and text have a deterministic rendered background. */
.route-workspace {
  background-color: rgb(var(--nv-surface-lowest));
}

@media (max-height: 640px) {
  .planner-steps,
  .planner-time-presets { display: none; }
  .planner-short-step { display: inline; }
}
</style>
