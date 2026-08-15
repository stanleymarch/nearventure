import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const wizard = readFileSync(resolve(process.cwd(), 'src/views/WizardView.vue'), 'utf8');
const preview = readFileSync(resolve(process.cwd(), 'src/views/RoutePreviewView.vue'), 'utf8');

describe('Mini App canonical route preflight', () => {
  it('gates the shop behind conditions and preferences for both route modes', () => {
    expect(wizard).toContain("type WizardStage = 'conditions' | 'preferences' | 'shop'");
    expect(wizard).toContain("const routeMode = ref<'auto' | 'manual'>('manual')");
    expect(wizard).toContain("wizardStage.value = 'preferences'");
    expect(wizard).toContain("wizardStage.value = 'shop'");
    expect(wizard).toContain('<template v-if="wizardStage === \'shop\'">');
  });

  it('uses pass_by for the first build and exposes manual unlimited topology', () => {
    expect(wizard).toContain("stopPace: 'pass_by'");
    expect(wizard).not.toContain("stopPace: 'quick'");
    expect(wizard).toContain("budgetMode: routeMode.value === 'auto' ? 'whole_trip' : noBudget.value ? 'unlimited' : budgetMode.value");
    expect(wizard).toContain("...(!loopEnabled.value && finish.value ? { finish: finish.value } : {})");
  });

  it('keeps retry independent from the transport label and exposes every public profile', () => {
    expect(wizard).toContain("import { Button } from '@/components/ui/button';");
    expect(wizard).toContain('<Button variant="outline" @click="loadShop()">🔁 Попробовать снова</Button>');
    expect(wizard).toContain('<label for="routing-profile"');
    expect(wizard).toContain('id="routing-profile"');
    expect(wizard).toContain('value="bike_touring"');
    expect(wizard).toContain('value="mtb_leisure"');
    expect(wizard).toContain('value="foot_scenic"');
    expect(wizard).toContain('Повторить проверку маршрутизатора');
    expect(wizard).toContain('healthRequestGate.isCurrent(token)');
    expect(wizard).toContain('routingProfileFromQuery(q.profile)');
  });

  it('redirects legacy auto inputs into the explicit wizard instead of building immediately', () => {
    expect(preview).toContain("router.replace({ name: 'wizard', query: { ...q, mode: 'auto' } })");
    expect(preview).not.toContain("stopPace: 'quick'");
  });
});
