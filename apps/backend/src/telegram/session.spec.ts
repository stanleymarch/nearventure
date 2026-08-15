import { describe, it, expect } from 'vitest';
import {
  freshSession,
  isStale,
  FLOW_TIMEOUT_MS,
  type BotSession,
  type Step,
} from './session';

describe('Session Module', () => {
  describe('freshSession', () => {
    it('creates a new session with default values', () => {
      const session = freshSession();

      expect(session).toEqual({
        step: 'IDLE',
        updatedAt: expect.any(Number),
        categories: ['heritage', 'monument', 'sights', 'religion', 'nature', 'museum'],
        loopRoute: true,
      });
    });

    it('includes all default categories', () => {
      const session = freshSession();

      expect(session.categories).toEqual([
        'heritage',
        'monument',
        'sights',
        'religion',
        'nature',
        'museum',
      ]);
    });

    it('sets loopRoute to true by default', () => {
      const session = freshSession();

      expect(session.loopRoute).toBe(true);
    });

    it('sets step to IDLE', () => {
      const session = freshSession();

      expect(session.step).toBe('IDLE');
    });
  });

  describe('isStale', () => {
    it('returns false for fresh session', () => {
      const session = freshSession();
      session.updatedAt = Date.now();

      expect(isStale(session)).toBe(false);
    });

    it('returns false for session updated less than timeout ago', () => {
      const session = freshSession();
      session.updatedAt = Date.now() - (FLOW_TIMEOUT_MS - 1000);

      expect(isStale(session)).toBe(false);
    });

    it('returns true for session older than timeout', () => {
      const session = freshSession();
      session.updatedAt = Date.now() - (FLOW_TIMEOUT_MS + 1000);

      expect(isStale(session)).toBe(true);
    });

    it('returns true for session at exactly timeout boundary', () => {
      const session = freshSession();
      session.updatedAt = Date.now() - FLOW_TIMEOUT_MS;

      expect(isStale(session)).toBe(true);
    });

    it('handles sessions with different step values', () => {
      const steps: Step[] = [
        'WELCOME',
        'ROUTE_LOCATION',
        'ROUTE_TRANSPORT',
        'ROUTE_TIME',
        'ROUTE_CATEGORIES',
        'ROUTE_MODE',
        'ROUTE_BUILDING',
        'NEARBY_LOCATION',
        'NEARBY_SETUP',
        'NEARBY_LIST',
        'IDLE',
        'GUIDE_WALKING',
        'GUIDE_DONE',
      ];

      steps.forEach(step => {
        const session = freshSession();
        session.step = step;
        session.updatedAt = Date.now() - (FLOW_TIMEOUT_MS + 1000);

        expect(isStale(session)).toBe(true);
      });
    });
  });

  describe('FLOW_TIMEOUT_MS', () => {
    it('is set to 5 minutes', () => {
      expect(FLOW_TIMEOUT_MS).toBe(5 * 60 * 1000); // 300000 ms
    });
  });

  describe('Step type', () => {
    it('accepts all valid step values', () => {
      const validSteps: Step[] = [
        'WELCOME',
        'ROUTE_LOCATION',
        'ROUTE_LOCATION_TEXT',
        'ROUTE_TRANSPORT',
        'ROUTE_BIKETYPE',
        'ROUTE_TIME',
        'ROUTE_CATEGORIES',
        'ROUTE_MODE',
        'ROUTE_BUILDING',
        'NEARBY_LOCATION',
        'NEARBY_SETUP',
        'NEARBY_LIST',
        'IDLE',
        'GUIDE_WALKING',
        'GUIDE_DONE',
      ];

      validSteps.forEach(step => {
        expect(step).toBeTruthy();
      });
    });
  });

  describe('BotSession type', () => {
    it('accepts session with all fields', () => {
      const session: BotSession = {
        step: 'ROUTE_TIME',
        updatedAt: Date.now(),
        menuMessageId: 123,
        start: { lat: 58.6, lon: 49.6, label: 'Kirov' },
        transport: 'bike',
        timeMinutes: 30,
        categories: ['heritage', 'museum'],
        loopRoute: false,
        lastRoute: {
          geojson: {
            type: 'LineString',
            coordinates: [[49.6, 58.6], [49.61, 58.61]],
          },
          distance: 1000,
          duration: 360,
          ascend: 10,
          descend: 5,
          pois: [
            {
              id: '1',
              name: 'Museum',
              lat: 58.601,
              lon: 49.601,
              category: 'museum',
            },
          ],
        },
        guideIndex: 0,
        guideMessageId: 456,
        nearbyLocation: { lat: 58.6, lon: 49.6 },
        nearbyOffset: 0,
        nearbyPois: [
          {
            id: '2',
            name: 'Monument',
            lat: 58.602,
            lon: 49.602,
            category: 'monument',
          },
        ],
        nearbyRadius: 5000,
        nearbyCategories: ['heritage'],
      };

      expect(session.step).toBe('ROUTE_TIME');
      expect(session.transport).toBe('bike');
      expect(session.lastRoute?.pois).toHaveLength(1);
      expect(session.nearbyPois).toHaveLength(1);
    });

    it('accepts minimal session', () => {
      const session: BotSession = {
        step: 'IDLE',
        updatedAt: Date.now(),
        categories: ['heritage'],
        loopRoute: true,
      };

      expect(session.step).toBe('IDLE');
      expect(session.categories).toEqual(['heritage']);
    });
  });

  describe('Session transitions', () => {
    it('can transition from IDLE to WELCOME', () => {
      const session = freshSession();
      session.step = 'IDLE';
      session.updatedAt = Date.now();

      expect(isStale(session)).toBe(false);

      session.step = 'WELCOME';
      session.updatedAt = Date.now();

      expect(isStale(session)).toBe(false);
    });

    it('can store route-building state', () => {
      const session = freshSession();
      session.step = 'ROUTE_LOCATION';
      session.updatedAt = Date.now();
      session.start = { lat: 58.6, lon: 49.6 };
      session.transport = 'foot';

      expect(session.step).toBe('ROUTE_LOCATION');
      expect(session.start).toEqual({ lat: 58.6, lon: 49.6 });
      expect(session.transport).toBe('foot');
    });

    it('can store nearby state', () => {
      const session = freshSession();
      session.step = 'NEARBY_LIST';
      session.updatedAt = Date.now();
      session.nearbyLocation = { lat: 58.6, lon: 49.6 };
      session.nearbyPois = [
        {
          id: '1',
          name: 'POI 1',
          lat: 58.601,
          lon: 49.601,
          category: 'heritage',
        },
      ];

      expect(session.nearbyPois).toHaveLength(1);
    });

    it('can store guide state', () => {
      const session = freshSession();
      session.step = 'GUIDE_WALKING';
      session.updatedAt = Date.now();
      session.guideIndex = 0;
      session.guideMessageId = 789;

      expect(session.guideIndex).toBe(0);
      expect(session.guideMessageId).toBe(789);
    });
  });

  describe('Session serialization', () => {
    it('can be serialized to JSON', () => {
      const session = freshSession();
      session.start = { lat: 58.6, lon: 49.6 };
      session.transport = 'bike';

      const json = JSON.stringify(session);
      const parsed = JSON.parse(json) as BotSession;

      expect(parsed.step).toBe('IDLE');
      expect(parsed.start).toEqual({ lat: 58.6, lon: 49.6 });
      expect(parsed.transport).toBe('bike');
    });

    it('preserves updatedAt as number', () => {
      const now = Date.now();
      const session = freshSession();
      session.updatedAt = now;

      const json = JSON.stringify(session);
      const parsed = JSON.parse(json) as BotSession;

      expect(parsed.updatedAt).toBe(now);
    });
  });
});