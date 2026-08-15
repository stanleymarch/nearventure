// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RouteWorkspace from '@/components/route/RouteWorkspace.vue';

const props = {
  routeMode: 'auto' as const,
  profile: 'mtb_leisure' as const,
  locating: false,
  startLabel: 'Набережная Грина',
  finishLabel: undefined,
  pickingFinish: false,
  timeMinutes: 90,
  timeLabel: '1 ч 30 мин',
  distanceHint: 'до 18 км',
  budgetMode: 'whole_trip' as const,
  loop: true,
  preset: 'balanced' as const,
  activeCategories: ['nature', 'heritage'] as any,
  routeScopeLabel: '2 из 6 категорий в приоритете',
  hiddenCategoryCount: 4,
  selectedWaypointCount: 0,
  canAdventure: true,
  loading: false,
  summaryLoading: false,
};

function button(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((item) => item.text().includes(text))!;
}

describe('RouteWorkspace canonical preflight', () => {
  it('orders transport, time and topology before preferences', async () => {
    const wrapper = mount(RouteWorkspace, { props });

    expect(wrapper.get('[aria-label="Тип транспорта"]')).toBeTruthy();
    expect(wrapper.get('[aria-label="Бюджет времени"]')).toBeTruthy();
    expect(button(wrapper, 'Вернуться к старту').attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).not.toContain('Темп остановок');

    await button(wrapper, 'Продолжить').trigger('click');
    expect(wrapper.get('#planner-preferences-title').text()).toContain('Что хочется встретить');
    expect(wrapper.get('[aria-label="Предпочтения маршрута"]')).toBeTruthy();

    await button(wrapper, 'Продолжить').trigger('click');
    expect(wrapper.get('#planner-review-title').text()).toContain('Автоподбор');
    expect(button(wrapper, 'Собрать маршрут')).toBeTruthy();
  });

  it('uses the same preflight for manual mode and exposes unlimited time', async () => {
    const wrapper = mount(RouteWorkspace, { props: { ...props, routeMode: 'manual' as const } });

    expect(wrapper.get('[aria-label="Как считать время"]')).toBeTruthy();
    await button(wrapper, 'Без ограничений').trigger('click');
    expect(wrapper.emitted('update:budget-mode')?.[0]).toEqual(['unlimited']);

    await button(wrapper, 'Закончить в пути').trigger('click');
    expect(wrapper.emitted('update:loop')?.[0]).toEqual([false]);

    await button(wrapper, 'Продолжить').trigger('click');
    await button(wrapper, 'Продолжить').trigger('click');
    expect(wrapper.get('#planner-review-title').text()).toContain('Ручной магазин');
    expect(button(wrapper, 'Перейти к выбору мест')).toBeTruthy();
  });

  it('omits all profiles after a confirmed unavailable health result and keeps retry reachable', async () => {
    const wrapper = mount(RouteWorkspace, { props: { ...props, routingStatus: 'unavailable', availableProfiles: [] } });
    expect(wrapper.findAll('[aria-label="Велотуринг"]').length).toBe(0);
    expect(wrapper.findAll('[aria-label="MTB: прогулочный"]').length).toBe(0);
    await button(wrapper, 'Повторить').trigger('click');
    expect(wrapper.emitted('retry-routing')).toHaveLength(1);
  });

  it('keeps all profiles available while health is unknown and omits health-confirmed unavailable profiles', async () => {
    const labels = ['Велосипед', 'Велотуринг', 'Горный велосипед (MTB)', 'MTB: прогулочный', 'Пешком', 'Пешком: живописный', 'Авто'];
    // Unknown health must not claim any profile is unsupported.
    const unknown = mount(RouteWorkspace, { props: { ...props, availableProfiles: null } });
    for (const label of labels) {
      expect(unknown.get(`[aria-label="${label}"]`).attributes('disabled')).toBeUndefined();
    }
    // A live capability list renders only its profiles and removes empty families.
    const gated = mount(RouteWorkspace, { props: { ...props, availableProfiles: ['bike', 'foot'] } });
    expect(gated.get('[aria-label="Велосипед"]')).toBeTruthy();
    expect(gated.get('[aria-label="Пешком"]')).toBeTruthy();
    expect(gated.find('[aria-label="Велотуринг"]').exists()).toBe(false);
    expect(gated.find('[aria-label="MTB: прогулочный"]').exists()).toBe(false);
    expect(gated.find('[aria-label="Пешком: живописный"]').exists()).toBe(false);
    expect(gated.find('[aria-label="Авто"]').exists()).toBe(false);
  });

  it('offers an optional map finish only for an open route', async () => {
    const wrapper = mount(RouteWorkspace, { props: { ...props, loop: false } });
    await button(wrapper, 'Последнее место').trigger('click');
    expect(wrapper.emitted('pick-finish')).toHaveLength(1);
  });

  it('switches mode without bypassing the shared conditions flow', async () => {
    const wrapper = mount(RouteWorkspace, { props });
    await button(wrapper, 'Выбирать места').trigger('click');
    expect(wrapper.emitted('route-mode')?.[0]).toEqual(['manual']);
  });

  it('ties the active subtitle to the ToggleGroup state and keeps inactive subtitles muted', async () => {
    const wrapper = mount(RouteWorkspace, { props: { ...props, profile: 'bike' } });
    const bike = wrapper.get('[aria-label="Велосипед"]');
    const foot = wrapper.get('[aria-label="Пешком"]');
    const subtitle = (item: typeof bike) => item.findAll('span').find((span) => span.text().includes('Повседневные') || span.text().includes('Обычный пеший'))!;

    expect(bike.classes()).toContain('border-nv-outline');
    expect(subtitle(bike).classes()).toContain('transport-card-subtitle');
    expect(subtitle(bike).classes()).toContain('text-primary-foreground');
    expect(subtitle(bike).classes()).not.toContain('text-muted-foreground');
    expect(subtitle(foot).classes()).toContain('text-muted-foreground');

    await foot.trigger('click');
    expect(wrapper.emitted('profile')?.[0]).toEqual(['foot']);
    await wrapper.setProps({ profile: 'foot' });
    expect(subtitle(foot).classes()).toContain('text-primary-foreground');
    expect(subtitle(bike).classes()).toContain('text-muted-foreground');
  });

  it('keeps transport cards hoverable and keyboard-focusable without changing inactive subtitle hierarchy', () => {
    const wrapper = mount(RouteWorkspace, { props: { ...props, profile: 'bike' }, attachTo: document.body });
    const foot = wrapper.get('[aria-label="Пешком"]');
    const subtitle = foot.findAll('span').find((span) => span.text().includes('Обычный пеший'))!;

    expect(foot.classes()).toContain('hover:text-accent-foreground');
    expect(foot.classes()).toContain('hover:border-nv-outline');
    expect(foot.classes()).toContain('focus-visible:ring-2');
    const footElement = foot.element as HTMLButtonElement;
    footElement.focus();
    expect(document.activeElement).toBe(footElement);
    expect(subtitle.classes()).toContain('text-muted-foreground');
    wrapper.unmount();
  });
});
