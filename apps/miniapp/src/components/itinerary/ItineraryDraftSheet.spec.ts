// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import ItineraryDraftSheet from './ItineraryDraftSheet.vue';
import ItinerarySummary from './ItinerarySummary.vue';

const draft = {
  id: 'draft-1', version: 1, status: 'ready', start: { lat: 58.6, lon: 49.6 }, profile: 'bike', loop: true,
  preset: 'balanced', intent: 'auto_budget', stopPace: 'pass_by', budgetMode: 'whole_trip', budgetMinutes: 90,
  reserveMinutes: 5, places: [], totals: { travelMinutes: 40, stopMinutes: 0, reserveMinutes: 5, totalMinutes: 45, budgetMinutes: 90, feasible: true, overBudgetMinutes: 0, remainingMinutes: 45 },
  warnings: [], suggestions: [], additions: [], replacements: [], createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-02T00:00:00Z',
} as any;

const sheetStubs = {
  Sheet: { template: '<div><slot /></div>' },
  SheetContent: { template: '<section><slot /></section>' },
  SheetHeader: { template: '<header><slot /></header>' },
  SheetTitle: { template: '<h2><slot /></h2>' },
  SheetDescription: { template: '<p><slot /></p>' },
};

describe('ItineraryDraftSheet', () => {
  it('owns the sheet shell and forwards editor commands unchanged', async () => {
    const wrapper = mount(ItineraryDraftSheet, { props: { open: true, draft }, global: { stubs: sheetStubs } });
    expect(wrapper.text()).toContain('План путешествия');

    const summary = wrapper.findComponent(ItinerarySummary);
    summary.vm.$emit('acceptAddition', 'add-1');
    summary.vm.$emit('replacePlace', 'place-1');
    summary.vm.$emit('acceptReplacement', 'replace-1');
    await nextTick();

    expect(wrapper.emitted('accept-addition')?.[0]).toEqual(['add-1']);
    expect(wrapper.emitted('replace-place')?.[0]).toEqual(['place-1']);
    expect(wrapper.emitted('accept-replacement')?.[0]).toEqual(['replace-1']);
  });
});
