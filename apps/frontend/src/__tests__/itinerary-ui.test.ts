// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import BudgetSummary from '@/components/itinerary/BudgetSummary.vue';
import PlaceNode from '@/components/itinerary/PlaceNode.vue';
import ItineraryRail from '@/components/itinerary/ItineraryRail.vue';

const place = { id: 'complex', name: 'Музейный двор', center: { lat: 1, lon: 2 }, clusterConfidence: 'manual', visitMode: 'visit', dwellMinutes: 30, arrivalOverheadMinutes: 5, source: 'manual', locked: false, pois: [{ id: 'a', name: 'Музей', category: 'museum', lat: 1, lon: 2, included: true, estimatedVisitMinutes: 20 }, { id: 'b', name: 'Скульптура', category: 'monument', lat: 1, lon: 2, included: true, estimatedVisitMinutes: 10 }] } as any;
const draft = { id: 'draft', version: 2, status: 'ready', start: { lat: 1, lon: 2 }, profile: 'foot', loop: true, intent: 'manual_collection', budgetMode: 'whole_trip', budgetMinutes: 60, reserveMinutes: 5, places: [place], totals: { travelMinutes: 35, stopMinutes: 30, reserveMinutes: 5, totalMinutes: 70, budgetMinutes: 60, feasible: false, overBudgetMinutes: 10, remainingMinutes: 0 }, warnings: [], suggestions: [] } as any;

const scoreBreakdown = {
  uniquePoiQuality: 7.5, categoryDiversity: 6.0, geographicDiversity: 8.0,
  loopOverlap: 5.0, profileRoadFit: 9.0, budgetUtilization: 7.0, elevation: 4.0, total: 6.64,
};
const selectionSummary = { candidateClusters: 8, selectedPlaces: 1, selectedUniquePois: 2, localityGuardApplied: true, unusedBudgetIntentional: true, networkConfidence: 'verified', maxAutomaticExcursionMinutes: 7 } as const;
const alternatives = [
  { alternativeId: 'alt1', explanation: 'Больше исторических мест', scoreBreakdown, selectionSummary, previewTotals: { travelMinutes: 40, stopMinutes: 35, reserveMinutes: 5, totalMinutes: 80, budgetMinutes: 60, feasible: false, overBudgetMinutes: 20, remainingMinutes: 0 }, places: [place] },
  { alternativeId: 'alt2', explanation: 'Больше природы', scoreBreakdown, previewTotals: { travelMinutes: 30, stopMinutes: 20, reserveMinutes: 5, totalMinutes: 55, budgetMinutes: 60, feasible: true, overBudgetMinutes: 0, remainingMinutes: 5 }, places: [] },
];
const suggestion = {
  suggestionId: 'fix1', kind: 'reduce_visit_mode' as const, reason: 'Заменить осмотр на беглый взгляд сэкономит 15 мин',
  previewTotals: { travelMinutes: 35, stopMinutes: 15, reserveMinutes: 5, totalMinutes: 55, budgetMinutes: 60, feasible: true, overBudgetMinutes: 0, remainingMinutes: 5 },
  delta: { travelMinutes: 0, stopMinutes: -15, reserveMinutes: 0, totalMinutes: -15, overBudgetMinutes: -10, remainingMinutes: 5 },
  affectedIds: ['complex'], targetMode: 'glance' as const,
};

describe('itinerary accessible UI', () => {
  it('shows travel, stops, total, overbudget and an aria-valuetext progress', () => {
    const wrapper = mount(BudgetSummary, { props: { draft } });
    expect(wrapper.text()).toContain('В пути'); expect(wrapper.text()).toContain('35 мин');
    expect(wrapper.text()).toContain('На местах'); expect(wrapper.text()).toContain('30 мин');
    expect(wrapper.text()).toContain('+10 мин');
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuetext')).toBe('70 мин из 60 мин');
    expect(wrapper.get('button').attributes()).toHaveProperty('type', 'button');
  });
  it('exposes a compound place, child POIs and labeled mode/lock/remove controls', async () => {
    const wrapper = mount(PlaceNode, { props: { place, index: 0, first: true, last: true } });
    expect(wrapper.get('[aria-label="Остановка 1"]')).toBeTruthy();
    await wrapper.get('button').trigger('click');
    expect(wrapper.text()).toContain('Музей'); expect(wrapper.text()).toContain('Скульптура');
    expect(wrapper.get('[aria-label="Режим посещения"]')).toBeTruthy();
    await wrapper.findAll('button').find(button => button.text() === 'Мимо')!.trigger('click');
    expect(wrapper.emitted('mode')?.[0]).toEqual(['pass_by', undefined]);
    expect(wrapper.get('[aria-label="Закрепить остановку"]')).toBeTruthy();
    expect(wrapper.get('[aria-label="Удалить остановку"]')).toBeTruthy();
  });

  it('shows visible text labels on lock/replace/remove actions, not icons alone', async () => {
    const wrapper = mount(PlaceNode, { props: { place, index: 0, first: true, last: true } });
    await wrapper.get('button').trigger('click');
    const text = wrapper.text();
    expect(text).toContain('Закрепить');
    expect(text).toContain('Заменить');
    expect(text).toContain('Удалить');
  });
  it('preserves preferred categories when regenerating with another preset', async () => {
    const wrapper = mount(ItineraryRail, { props: { draft: { ...draft, intent: 'auto_budget' }, preferredCategories: ['nature', 'museum'] } });
    expect(wrapper.text()).toContain('Режим подбора');
    expect(wrapper.text()).toContain('Сбалансированный');
    expect(wrapper.text()).toContain('Больше мест');
    expect(wrapper.text()).toContain('Живописный');
    expect(wrapper.text()).toContain('Тренировка');
    const scenic = wrapper.findAll('button').find(button => button.text().includes('Живописный'))!;
    await scenic.trigger('click');
    expect(wrapper.emitted('autoFill')?.[0]).toEqual([['nature', 'museum'], undefined, 'scenic']);
  });
  it('renders smart fixes when feasible is false and suggestions present', () => {
    const draftWithSuggestion = { ...draft, suggestions: [suggestion] };
    const wrapper = mount(ItineraryRail, { props: { draft: draftWithSuggestion } });
    expect(wrapper.text()).toContain('Как уложиться в бюджет');
    expect(wrapper.text()).toContain(suggestion.reason);
    expect(wrapper.text()).toContain('Применить');
    const applyBtn = wrapper.findAll('button').find(b => b.text().includes('Применить'));
    expect(applyBtn).toBeTruthy();
  });
  it('hides the raw numeric score and shows qualitative selection hints instead', () => {
    const draftWithScore = { ...draft, scoreBreakdown, autoFillSummary: selectionSummary, totals: { ...draft.totals, feasible: true } };
    const wrapper = mount(ItineraryRail, { props: { draft: draftWithScore } });
    // Raw optimizer numbers are kept in the payload for analytics, never shown.
    expect(wrapper.text()).not.toContain('Оценка маршрута');
    expect(wrapper.text()).not.toContain('6.6');
    expect(wrapper.text()).not.toContain('Интересность мест');
    // The user sees a qualitative explanation derived from SelectionSummary.
    expect(wrapper.text()).toContain('Почему этот маршрут');
    expect(wrapper.text()).toContain('Компактный локальный маршрут');
  });
  it('renders each alternative Places list, exact server totals and selection summary', () => {
    const draftWithAlternatives = { ...draft, alternatives, totals: { ...draft.totals, feasible: true } };
    const wrapper = mount(ItineraryRail, { props: { draft: draftWithAlternatives } });
    expect(wrapper.text()).toContain('Альтернативы');
    expect(wrapper.text()).toContain('Больше исторических мест');
    expect(wrapper.text()).toContain('Музейный двор');
    expect(wrapper.text()).toContain('80 мин');
    expect(wrapper.text()).toContain('2 уникальных POI');
    expect(wrapper.text()).toContain('Маршрут подтверждён по дорожной сети');
    expect(wrapper.text()).toContain('Выбрать этот вариант');
  });
  it('emits applySmartFix when smart fix apply button is clicked', async () => {
    const draftWithSuggestion = { ...draft, suggestions: [suggestion], totals: { ...draft.totals, feasible: false } };
    const wrapper = mount(ItineraryRail, { props: { draft: draftWithSuggestion } });
    const applyBtns = wrapper.findAll('button').filter(b => b.text().includes('Применить'));
    if (applyBtns.length) {
      await applyBtns[0].trigger('click');
      expect(wrapper.emitted('applySmartFix')).toBeTruthy();
      expect(wrapper.emitted('applySmartFix')![0]).toEqual(['fix1']);
    }
  });

  it('renders geometry-derived route warnings so users see them before exporting GPX', () => {
    const message = 'Часть пути неизбежно повторяется — часть дороги придётся пройти туда и обратно.';
    const wrapper = mount(ItineraryRail, { props: { draft } });
    expect(wrapper.text()).not.toContain('неизбежно повторяется');
    const draftWithWarning = { ...draft, warnings: [{ code: 'UNAVOIDABLE_OUT_AND_BACK', message }] };
    const withWarning = mount(ItineraryRail, { props: { draft: draftWithWarning } });
    expect(withWarning.text()).toContain('неизбежно повторяется');
  });

  it('shows a truthful low-supply nudge only when the reachable area had few candidates', () => {
    const wrapper = mount(ItineraryRail, { props: { draft } });
    expect(wrapper.text()).not.toContain('немного подходящих мест');
    const sparse = mount(ItineraryRail, { props: { draft: { ...draft, autoFillSummary: { ...selectionSummary, candidateClusters: 3 } } } });
    expect(sparse.text()).toContain('немного подходящих мест');
    expect(sparse.text()).toContain('(3)');
    const rich = mount(ItineraryRail, { props: { draft: { ...draft, autoFillSummary: { ...selectionSummary, candidateClusters: 9 } } } });
    expect(rich.text()).not.toContain('немного подходящих мест');
  });

  it('omits budget progress in unlimited manual mode', () => {
    const unlimited = { ...draft, budgetMode: 'unlimited', totals: { ...draft.totals, budgetMinutes: null, remainingMinutes: null, reserveMinutes: 0, feasible: true, overBudgetMinutes: 0 } };
    const wrapper = mount(BudgetSummary, { props: { draft: unlimited } });
    expect(wrapper.text()).toContain('Без лимита');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });
});
