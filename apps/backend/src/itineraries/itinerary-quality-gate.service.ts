import { Injectable } from '@nestjs/common';
import { LoopQualityService } from '../routing/loop-quality.service';
import type { RouteResult } from '../routing/routing.types';
import type { ItineraryTotals, RoutePlace } from './itinerary.types';

export const ITINERARY_QUALITY_VERSION = 'graphhopper-quality-core-v1' as const;
export type ItineraryQualityVerdict = 'confirmed' | 'degraded' | 'unconfirmed';
export type ItineraryQualityWarningCode =
  | 'ROUTE_UNAVAILABLE'
  | 'ROUTE_NOT_NETWORK_CONFIRMED'
  | 'BUDGET_EXCEEDED'
  | 'LOOP_NOT_CLOSED'
  | 'UNAVOIDABLE_OUT_AND_BACK';

/** Additive evidence returned only for auto-itinerary candidates after routing. */
export interface ItineraryQuality {
  version: typeof ITINERARY_QUALITY_VERSION;
  verdict: ItineraryQualityVerdict;
  feasible: boolean;
  networkConfirmed: boolean;
  warnings: ItineraryQualityWarningCode[];
  metrics: {
    requestedLoop: boolean;
    routeAvailable: boolean;
    closureGapMeters?: number;
    repeatedRoadRatio?: number;
    outAndBackRatio?: number;
    sharedStemMeters?: number;
    stopCount: number;
    uniquePoiCount: number;
    clusteredStopCount: number;
  };
}

/** Stable warning prose shared by auto-fill and alternative selection. */
export function itineraryQualityWarningMessage(code: ItineraryQualityWarningCode): string {
  const messages: Record<ItineraryQualityWarningCode, string> = {
    ROUTE_UNAVAILABLE: 'Маршрут не содержит проверяемой геометрии сети.',
    ROUTE_NOT_NETWORK_CONFIRMED: 'Маршрут не подтверждён дорожной сетью.',
    BUDGET_EXCEEDED: 'Маршрут превышает заданный бюджет времени.',
    LOOP_NOT_CLOSED: 'Запрошенное кольцо не замыкается в точке старта.',
    UNAVOIDABLE_OUT_AND_BACK: 'Часть пути неизбежно повторяется; маршрут не назван кольцом без проверки.',
  };
  return messages[code];
}

export interface ItineraryQualityInput {
  route: RouteResult | null | undefined;
  totals: Pick<ItineraryTotals, 'feasible'>;
  requestedLoop: boolean;
  places: RoutePlace[];
  /** True only when the supplied route came from a successful network routing response. */
  networkConfirmed: boolean;
}

@Injectable()
export class ItineraryQualityGateService {
  /** GraphHopper loop requests normally close exactly; this only catches a
   * clearly open geometry without rejecting an otherwise usable route. */
  private static readonly MAX_LOOP_CLOSURE_GAP_METERS = 100;

  constructor(private readonly loops: LoopQualityService) {}

  assess(input: ItineraryQualityInput): ItineraryQuality {
    const coordinates = input.route?.geojson.geometry?.coordinates;
    const routeAvailable = Array.isArray(coordinates) && coordinates.length >= 2;
    const loop = routeAvailable ? this.loops.assess(coordinates) : undefined;
    const warnings: ItineraryQualityWarningCode[] = [];

    if (!routeAvailable) warnings.push('ROUTE_UNAVAILABLE');
    if (!input.networkConfirmed) warnings.push('ROUTE_NOT_NETWORK_CONFIRMED');
    if (!input.totals.feasible) warnings.push('BUDGET_EXCEEDED');
    if (input.requestedLoop && loop && loop.closureGapMeters > ItineraryQualityGateService.MAX_LOOP_CLOSURE_GAP_METERS) {
      warnings.push('LOOP_NOT_CLOSED');
    }
    // This retains the existing 0.6 policy from LoopQualityService, but only
    // describes it as a loop compromise when a loop was actually requested.
    if (input.requestedLoop && loop?.warnings.includes('UNAVOIDABLE_OUT_AND_BACK')) {
      warnings.push('UNAVOIDABLE_OUT_AND_BACK');
    }

    return {
      version: ITINERARY_QUALITY_VERSION,
      verdict: !routeAvailable || !input.networkConfirmed
        ? 'unconfirmed'
        : warnings.length > 0 ? 'degraded' : 'confirmed',
      feasible: input.totals.feasible,
      networkConfirmed: input.networkConfirmed,
      warnings,
      metrics: {
        requestedLoop: input.requestedLoop,
        routeAvailable,
        ...(loop && {
          closureGapMeters: loop.closureGapMeters,
          repeatedRoadRatio: loop.repeatedRoadRatio,
          outAndBackRatio: loop.outAndBackRatio,
          sharedStemMeters: loop.sharedStemMeters,
        }),
        stopCount: input.places.length,
        uniquePoiCount: input.places.reduce((count, place) => count + place.pois.filter((poi) => poi.included).length, 0),
        clusteredStopCount: input.places.filter((place) => place.clusterConfidence !== 'manual').length,
      },
    };
  }
}
