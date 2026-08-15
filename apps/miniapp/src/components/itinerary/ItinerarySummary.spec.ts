// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ItinerarySummary from './ItinerarySummary.vue';

const place = {
  id: 'place-1', name: 'Усадьба', center: { lat: 58.6, lon: 49.6 }, clusterConfidence: 'manual', visitMode: 'visit', dwellMinutes: 25,
  arrivalOverheadMinutes: 5, source: 'manual', locked: false,
  pois: [{ id: 'poi-1', name: 'Усадьба', category: 'heritage', lat: 58.6, lon: 49.6, included: true, estimatedVisitMinutes: 25 }],
};
const totals = { travelMinutes: 40, stopMinutes: 25, reserveMinutes: 5, totalMinutes: 70, budgetMinutes: 90, feasible: true, overBudgetMinutes: 0, remainingMinutes: 20 };
const suggestion = {
  suggestionId: 'suggestion-1', poi: { id: 'poi-2', name: 'Родник', category: 'nature', lat: 58.61, lon: 49.61, included: true, estimatedVisitMinutes: 10 },
  reason: 'Недалеко от маршрута', detourMinutes: 4, dwellMinutes: 10,
  previewTotals: { ...totals, totalMinutes: 84, remainingMinutes: 6 },
  delta: { travelMinutes: 4, stopMinutes: 10, totalMinutes: 14, overBudgetMinutes: 0, remainingMinutes: -14 },
};
const draft = {
  id: 'draft-1', version: 2, status: 'ready', start: { lat: 58.6, lon: 49.6 }, profile: 'bike', loop: true,
  preset: 'balanced', intent: 'auto_budget', stopPace: 'pass_by', budgetMode: 'whole_trip', budgetMinutes: 90,
  reserveMinutes: 5, places: [place], totals, warnings: [], suggestions: [], additions: [suggestion], replacements: [{ ...suggestion, suggestionId: 'replacement-1', poi: { ...suggestion.poi, id: 'poi-3', name: 'Смотровая площадка' } }],
  createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-02T00:00:00Z',
} as any;

const summary = { candidateClusters: 8, selectedPlaces: 1, selectedUniquePois: 1, localityGuardApplied: true, unusedBudgetIntentional: true, networkConfidence: 'verified', maxAutomaticExcursionMinutes: 6 } as const;

describe('ItinerarySummary additions and replacements', () => {
  it('renders transparent previews and emits only explicit acceptance commands', async () => {
    const wrapper = mount(ItinerarySummary, { props: { draft } });

    expect(wrapper.text()).toContain('Можно добавить по пути');
    expect(wrapper.text()).toContain('Родник');
    expect(wrapper.text()).toContain('Чем заменить');
    expect(wrapper.text()).toContain('Смотровая площадка');

    await wrapper.findAll('button').find((button) => button.text().includes('Добавить'))!.trigger('click');
    expect(wrapper.emitted('acceptAddition')?.[0]).toEqual(['suggestion-1']);

    await wrapper.findAll('button').find((button) => button.text().includes('Заменить'))!.trigger('click');
    expect(wrapper.emitted('acceptReplacement')?.[0]).toEqual(['replacement-1']);
  });

  it('offers a replacement request only after the user opens a place', async () => {
    const wrapper = mount(ItinerarySummary, { props: { draft } });
    await wrapper.get('[aria-label="Открыть остановку Усадьба"]').trigger('click');
    await wrapper.get('[aria-label="Предложить замену этой остановки"]').trigger('click');
    expect(wrapper.emitted('replacePlace')?.[0]).toEqual(['place-1']);
  });

  it('renders geometry-derived route warnings and hides the banner when there are none', () => {
    const message = 'Часть пути неизбежно повторяется — часть дороги придётся пройти туда и обратно.';
    const base = mount(ItinerarySummary, { props: { draft } });
    expect(base.text()).not.toContain('неизбежно повторяется');
    const withWarning = mount(ItinerarySummary, { props: { draft: { ...draft, warnings: [{ code: 'UNAVOIDABLE_OUT_AND_BACK', message }] } } });
    expect(withWarning.text()).toContain('неизбежно повторяется');
  });

  it('shows visible text labels for lock/replace/remove actions, not icons alone', async () => {
    const wrapper = mount(ItinerarySummary, { props: { draft } });
    await wrapper.get('[aria-label="Открыть остановку Усадьба"]').trigger('click');
    const text = wrapper.text();
    expect(text).toContain('Закрепить');
    expect(text).toContain('Заменить');
    expect(text).toContain('Удалить');
  });

  it('emits view-poi when a cluster POI is tapped so the card deep-link survives', async () => {
    const wrapper = mount(ItinerarySummary, { props: { draft } });
    await wrapper.get('[aria-label="Открыть остановку Усадьба"]').trigger('click');
    await wrapper.get('[aria-label="Открыть карточку «Усадьба»"]').trigger('click');
    expect(wrapper.emitted('viewPoi')?.[0]).toEqual(['poi-1']);
  });

  it('shows a truthful low-supply nudge only when the reachable area had few candidates', () => {
    const wrapper = mount(ItinerarySummary, { props: { draft } });
    expect(wrapper.text()).not.toContain('немного подходящих мест');
    const sparse = mount(ItinerarySummary, { props: { draft: { ...draft, autoFillSummary: { ...summary, candidateClusters: 3 } } } });
    expect(sparse.text()).toContain('немного подходящих мест');
    expect(sparse.text()).toContain('(3)');
    const rich = mount(ItinerarySummary, { props: { draft: { ...draft, autoFillSummary: { ...summary, candidateClusters: 9 } } } });
    expect(rich.text()).not.toContain('немного подходящих мест');
  });

  it('preserves category preferences when changing preset', async () => {
    const wrapper = mount(ItinerarySummary, { props: { draft, preferredCategories: ['nature', 'heritage'] } });
    await wrapper.findAll('button').find(button => button.text().includes('Режим подбора'))!.trigger('click');
    await wrapper.findAll('button').find(button => button.text().includes('Живописный'))!.trigger('click');
    expect(wrapper.emitted('autoFill')?.[0]).toEqual([['nature', 'heritage'], undefined, 'scenic']);
  });

  it('renders server selection summary and alternative Places verbatim', () => {
    const alternative = { alternativeId: 'alt', explanation: 'Компактный', places: [place], previewTotals: totals, scoreBreakdown: { uniquePoiQuality: 1, categoryDiversity: 1, geographicDiversity: 1, loopOverlap: 1, profileRoadFit: 1, budgetUtilization: 1, elevation: 1, total: 1 }, selectionSummary: summary };
    const wrapper = mount(ItinerarySummary, { props: { draft: { ...draft, autoFillSummary: summary, alternatives: [alternative] } } });
    expect(wrapper.text()).toContain('Маршрут подтверждён по дорожной сети');
    expect(wrapper.text()).toContain('Усадьба');
    expect(wrapper.text()).toContain('1 уникальных POI');
    expect(wrapper.text()).toContain('Выбрать этот вариант');
  });
});
