import { describe, expect, it } from 'vitest';
import { VisitTimeService } from './visit-time.service';
const pois = (categories: string[]) => categories.map((category, index) => ({ id: `${index}`, name: category, category, lat: 58.6, lon: 49.6, included: true, estimatedVisitMinutes: 0 }));
describe('VisitTimeService', () => {
  const service = new VisitTimeService();
  it('has pass-by zero time and applies car arrival overhead once', () => {
    expect(service.estimate(pois(['museum']), 'pass_by', 'car').dwellMinutes).toBe(0);
    const result = service.estimate(pois(['monument', 'monument']), 'visit', 'car');
    expect(result.arrivalOverheadMinutes).toBe(5); expect(result.dwellMinutes).toBe(12);
  });
  it('uses decreasing marginal child time and caps ordinary groups', () => {
    const one = service.estimate(pois(['monument']), 'visit', 'foot');
    const many = service.estimate(pois(['monument', 'monument', 'monument', 'monument']), 'visit', 'foot');
    expect(many.dwellMinutes).toBeGreaterThan(one.dwellMinutes); expect(many.dwellMinutes).toBeLessThanOrEqual(10);
  });
  it('validates custom integer range and returns exactly custom time', () => {
    expect(service.estimate(pois(['museum']), 'custom', 'foot', 37).dwellMinutes).toBe(37);
    expect(() => service.estimate(pois(['museum']), 'custom', 'foot', 1.5)).toThrow('integer');
    expect(() => service.estimate(pois(['museum']), 'visit', 'foot', 12)).toThrow('only valid');
  });
});
