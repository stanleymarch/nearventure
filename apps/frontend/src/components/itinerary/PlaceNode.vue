<script setup lang="ts">
import { ref } from 'vue';
import { ChevronDown, GripVertical, Lock, LockOpen, Shuffle, Trash2 } from 'lucide-vue-next';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { RoutePlace, VisitMode } from '@/api/itineraries';
const props = defineProps<{ place: RoutePlace; index: number; first: boolean; last: boolean; busy?: boolean }>();
const emit = defineEmits<{ mode: [value: VisitMode, custom?: number]; lock: [value: boolean]; remove: []; move: [delta: number]; replace: [] }>();
const open = ref(false); const custom = ref(props.place.customVisitMinutes ?? (props.place.dwellMinutes || 15));
const modes: { value: VisitMode; label: string }[] = [{ value: 'pass_by', label: 'Мимо' }, { value: 'glance', label: 'Взгляд' }, { value: 'visit', label: 'Осмотр' }, { value: 'custom', label: 'Своё' }];
function change(value: VisitMode) { emit('mode', value, value === 'custom' ? custom.value : undefined); }
</script>
<template>
  <CollapsibleRoot v-model:open="open" class="relative pl-8">
    <span class="absolute left-3 top-0 h-full w-px bg-border" aria-hidden="true" /><span class="absolute left-0 top-4 grid size-7 place-items-center rounded-full border-2 border-primary bg-background text-xs font-bold text-primary" :aria-label="`Остановка ${index + 1}`">{{ index + 1 }}</span>
    <div class="rounded-xl border border-border/70 bg-card p-3"><div class="flex items-start gap-2"><GripVertical class="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><CollapsibleTrigger class="flex min-h-11 flex-1 items-center justify-between gap-2 text-left"><span><b class="block text-sm">{{ place.name }}</b><span class="text-xs text-muted-foreground">{{ place.pois.length }} {{ place.pois.length === 1 ? 'место' : 'места' }} · {{ place.visitMode === 'pass_by' ? 'без остановки' : `${place.dwellMinutes} мин` }}</span></span><ChevronDown class="size-4 transition-transform" :class="open && 'rotate-180'" /></CollapsibleTrigger><Badge variant="outline">{{ place.source === 'manual' ? 'вручную' : 'подбор' }}</Badge></div>
      <CollapsibleContent><div class="mt-3 flex flex-col gap-3 border-t pt-3"><div class="flex flex-wrap gap-1" aria-label="Режим посещения"><button v-for="mode in modes" :key="mode.value" type="button" class="min-h-11 rounded-lg border px-2 text-xs font-semibold" :class="place.visitMode === mode.value ? 'border-primary bg-primary/10 text-primary' : 'border-border'" @click="change(mode.value)">{{ mode.label }}</button></div><label v-if="place.visitMode === 'custom'" class="text-xs font-medium">Минуты <input v-model.number="custom" min="1" max="480" type="number" class="ml-2 min-h-11 w-20 rounded-md border bg-background px-2" aria-label="Своя длительность посещения" @change="change('custom')" /></label><ul class="flex flex-col gap-1 text-xs text-muted-foreground"><li v-for="poi in place.pois" :key="poi.id">• {{ poi.name }}</li></ul><div class="flex items-center gap-1"><Button size="sm" variant="ghost" :disabled="first || busy" aria-label="Переместить остановку выше" @click="emit('move', -1)">↑</Button><Button size="sm" variant="ghost" :disabled="last || busy" aria-label="Переместить остановку ниже" @click="emit('move', 1)">↓</Button><Button size="sm" variant="ghost" class="gap-1 text-xs" :disabled="busy" :aria-label="place.locked ? 'Разблокировать остановку' : 'Закрепить остановку'" @click="emit('lock', !place.locked)"><Lock v-if="place.locked" class="size-3.5" /><LockOpen v-else class="size-3.5" /><span>{{ place.locked ? 'Открепить' : 'Закрепить' }}</span></Button><Button size="sm" variant="ghost" class="gap-1 text-xs" :disabled="busy" aria-label="Предложить замену этой остановки" @click="emit('replace')"><Shuffle class="size-3.5" /><span>Заменить</span></Button><Button size="sm" variant="ghost" class="ml-auto gap-1 text-xs text-destructive" :disabled="busy" aria-label="Удалить остановку" @click="emit('remove')"><Trash2 class="size-3.5" /><span>Удалить</span></Button></div></div></CollapsibleContent>
    </div>
  </CollapsibleRoot>
</template>
