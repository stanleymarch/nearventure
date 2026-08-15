import { describe, expect, it } from 'vitest';
import {
  normalizeRoadFacts,
  parseConfiguredPathDetails,
  parseGhPathDetails,
} from './road-facts';

const geometry = {
  type: 'LineString' as const,
  coordinates: [[49.6, 58.6], [49.61, 58.6], [49.62, 58.6]],
};

describe('road fact normalisation', () => {
  it('accepts only the configured allow-list and ignores duplicate values', () => {
    expect(parseConfiguredPathDetails('surface,unknown,surface,road_class')).toEqual({
      details: ['surface', 'road_class'],
      unsupported: ['unknown'],
    });
  });

  it('aggregates GraphHopper intervals into geometry-backed distances and route shares', () => {
    const details = parseGhPathDetails({
      road_class: [[0, 1, 'residential'], [1, 2, 'tertiary']],
      surface: [[0, 2, 'asphalt']],
    }, ['road_class', 'surface']);

    const facts = normalizeRoadFacts(details, geometry);

    expect(facts).toHaveLength(2);
    expect(facts).toContainEqual({
      kind: 'surface',
      values: [{ value: 'asphalt', distance: expect.any(Number), share: 1 }],
    });
    const roadClass = facts?.find((fact) => fact.kind === 'road_class');
    expect(roadClass?.values).toHaveLength(2);
    expect(roadClass?.values.reduce((total, value) => total + value.share, 0)).toBe(1);
  });

  it('omits malformed or out-of-bounds detail facts rather than guessing', () => {
    const malformed = parseGhPathDetails({
      road_class: [[0, 2, 'residential'], ['bad', 2, 'tertiary']],
    }, ['road_class']);
    const outOfBounds = parseGhPathDetails({
      surface: [[0, 3, 'asphalt']],
    }, ['surface']);

    expect(normalizeRoadFacts(malformed, geometry)).toBeUndefined();
    expect(normalizeRoadFacts(outOfBounds, geometry)).toBeUndefined();
  });

  it('does not create facts when GraphHopper omitted details', () => {
    expect(normalizeRoadFacts(undefined, geometry)).toBeUndefined();
  });
});
