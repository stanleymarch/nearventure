import { describe, expect, it } from 'vitest';
import type { RouteResult } from './routing.types';

describe('routing REST result contract', () => {
  it('allows legacy consumers to omit the additive roadFacts field', () => {
    const legacy: RouteResult = {
      geojson: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61]] },
        properties: { distance: 1000, duration: 360, ascend: 10, descend: 5, profile: 'bike' },
      },
      distance: 1000,
      duration: 360,
      ascend: 10,
      descend: 5,
      profile: 'bike',
      bbox: [49.6, 58.6, 49.61, 58.61],
    };

    expect(JSON.parse(JSON.stringify(legacy))).not.toHaveProperty('roadFacts');
    expect(legacy.geojson.properties).toEqual({
      distance: 1000, duration: 360, ascend: 10, descend: 5, profile: 'bike',
    });
  });

  it('makes road facts optional and additive to the established fields', () => {
    const result: RouteResult = {
      geojson: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61]] },
        properties: { distance: 1000, duration: 360, ascend: 10, descend: 5, profile: 'bike' },
      },
      distance: 1000,
      duration: 360,
      ascend: 10,
      descend: 5,
      profile: 'bike',
      bbox: [49.6, 58.6, 49.61, 58.61],
      roadFacts: [{
        kind: 'surface',
        values: [{ value: 'asphalt', distance: 1000, share: 1 }],
      }],
    };

    expect(result.roadFacts?.[0].kind).toBe('surface');
    expect(result.distance).toBe(1000);
  });
});
