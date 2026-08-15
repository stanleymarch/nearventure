import { describe, it, expect } from 'vitest';
import { unwrapGeometry, extractLineCoordinates } from '../lib/geojson-utils';

describe('geojson-utils', () => {
  describe('unwrapGeometry', () => {
    it('returns null for null/undefined', () => {
      expect(unwrapGeometry(null)).toBeNull();
      expect(unwrapGeometry(undefined)).toBeNull();
    });

    it('unwraps a Feature to its geometry', () => {
      const feature = {
        type: 'Feature' as const,
        geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] },
      };
      expect(unwrapGeometry(feature)).toEqual({
        type: 'LineString',
        coordinates: [[1, 2], [3, 4]],
      });
    });

    it('returns null for a Feature with null geometry', () => {
      expect(unwrapGeometry({ type: 'Feature', geometry: null })).toBeNull();
    });

    it('returns bare geometry as-is', () => {
      const geom = { type: 'LineString', coordinates: [[1, 2]] };
      expect(unwrapGeometry(geom)).toBe(geom);
    });
  });

  describe('extractLineCoordinates', () => {
    it('extracts [lng, lat] pairs from a bare LineString', () => {
      const geom = {
        type: 'LineString',
        coordinates: [[49.6, 58.6], [49.7, 58.7]],
      };
      expect(extractLineCoordinates(geom)).toEqual([
        [49.6, 58.6],
        [49.7, 58.7],
      ]);
    });

    it('extracts coordinates from a Feature-wrapped LineString', () => {
      // This is the shape returned by GET /api/routes/:id
      const feature = {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString',
          coordinates: [[49.6, 58.6], [49.7, 58.7]],
        },
      };
      expect(extractLineCoordinates(feature)).toEqual([
        [49.6, 58.6],
        [49.7, 58.7],
      ]);
    });

    it('flattens MultiLineString coordinates', () => {
      const geom = {
        type: 'MultiLineString',
        coordinates: [
          [[1, 2], [3, 4]],
          [[5, 6], [7, 8]],
        ],
      };
      expect(extractLineCoordinates(geom)).toEqual([
        [1, 2], [3, 4], [5, 6], [7, 8],
      ]);
    });

    it('returns [] for missing coordinates', () => {
      expect(extractLineCoordinates({ type: 'LineString', coordinates: [] })).toEqual([]);
      expect(extractLineCoordinates(null)).toEqual([]);
      expect(extractLineCoordinates({ type: 'Feature', geometry: null })).toEqual([]);
    });

    it('skips malformed coordinate pairs', () => {
      const geom = {
        type: 'LineString',
        coordinates: [[1, 2], [NaN, 4], [5], [7, 8]],
      };
      expect(extractLineCoordinates(geom)).toEqual([[1, 2], [7, 8]]);
    });
  });
});
