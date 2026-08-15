import { Injectable } from '@nestjs/common';
import type { BudgetMode } from './itinerary.types';
import type { AutoScoreBreakdown, ItineraryTotals, RoutePlace } from './itinerary.types';
import type { Point } from './itinerary.types';
import type { RouteResult, RoutingProfile } from '../routing/routing.types';
import { LoopQualityService } from '../routing/loop-quality.service';
import { ItineraryBudgetService } from './itinerary-budget.service';

export type ScorePreset = 'balanced' | 'more_places' | 'scenic' | 'training';

export interface ScoreInput {
  places: RoutePlace[];
  route: RouteResult;
  start: Point;
  profile: RoutingProfile;
  preset: ScorePreset;
  preferredCategories: string[];
  budgetMinutes: number;
  budgetMode: BudgetMode;
  reserveMinutes: number;
  /** Route shape for the sequence-efficiency component (defaults to loop). */
  loop?: boolean;
  finish?: Point;
}
export interface ScoreOutput {
  score: AutoScoreBreakdown;
  totals: ItineraryTotals;
}

/** Comparison input for the lexicographic comparator (M3 Task 2). */
export interface CompareInput {
  places: RoutePlace[];
  route: RouteResult;
  totals: ItineraryTotals;
  localityViolations: number;
  budgetMinutes: number;
  start: Point;
  preferredCategories?: string[];
  profile?: RoutingProfile;
  preset?: ScorePreset;
  /** Route shape for the sequence-efficiency level (defaults to open). */
  loop?: boolean;
  finish?: Point;
  /** Exact-route quality policy rank, supplied only by the auto optimizer. */
  qualityRank?: number;
}
export type CompareResult = -1 | 0 | 1;

/**
 * Canonical, side-effect-free scorer for automatic itinerary selection.
 *
 * Components are normalized and named so the product invariant — "a dense
 * cluster of reachable places beats a distant featured singleton" — is a
 * fast, deterministic unit test instead of a full routing pipeline. Geographic
 * spread is deliberately a small tie-breaker: it must never pull a short outing
 * to a far point just to open another angular sector.
 */
@Injectable()
export class ItineraryScoreService {
  constructor(private readonly loops: LoopQualityService, private readonly budget: ItineraryBudgetService) {}

  score(input: ScoreInput): ScoreOutput {
    const { places, route, start, profile, preset, preferredCategories, budgetMinutes, budgetMode, reserveMinutes } = input;
    const categories = new Set(places.flatMap((place) => place.pois.map((poi) => poi.category)));
    const sectors = new Set(places.map((place) => this.sector(place.center, start)));
    const preferredSet = new Set(preferredCategories);
    const preferredHits = [...categories].filter((category) => preferredSet.has(category)).length;
    const quality = this.loops.assess(route.geojson.geometry?.coordinates ?? []);
    const totals = this.budget.calculate({ travelMinutes: route.duration / 60, places, budgetMinutes, budgetMode, reserveMinutes });
    const poiQuality = places.reduce((sum, place) => sum + place.pois.reduce((s, poi, i) => s + (i ? .25 : 1) * (1 + (poi.estimatedVisitMinutes ? .1 : 0)), 0), 0);
    const weights = preset === 'more_places' ? [37, 10, 3, 5, 5, 25, 10, 5] : preset === 'scenic' ? [17, 10, 5, 30, 5, 10, 18, 5] : preset === 'training' ? [10, 8, 3, 22, 10, 18, 24, 5] : [28, 12, 3, 20, 10, 17, 5, 5];
    const categoryFit = preferredSet.size
      ? Math.min(1, preferredHits / Math.min(3, preferredSet.size))
      : Math.min(1, categories.size / 3);
    const score: AutoScoreBreakdown = {
      uniquePoiQuality: Math.min(1, poiQuality / 8) * weights[0],
      categoryDiversity: categoryFit * weights[1],
      geographicDiversity: Math.min(1, sectors.size / 4) * weights[2],
      travelEfficiency: this.sequenceEfficiency(places) * weights[7],
      loopOverlap: Math.max(0, 1 - quality.repeatedRoadRatio) * weights[3],
      profileRoadFit: route.profile === profile ? weights[4] : 0,
      budgetUtilization: Math.min(1, totals.totalMinutes / Math.max(1, budgetMinutes)) * weights[5],
      elevation: Math.min(1, route.ascend / 500) * weights[6],
      total: 0,
    };
    score.total = score.uniquePoiQuality + score.categoryDiversity + score.geographicDiversity + score.travelEfficiency + score.loopOverlap + score.profileRoadFit + score.budgetUtilization + score.elevation;
    return { score, totals };
  }

  /**
   * Lexicographic comparison (design §5.6, plan M3 Task 2).
   *
   * Budget-fill (level 7) can never compensate for a locality violation (level 2)
   * or infeasibility (level 1). Returns negative if a is better, positive if b
   * is better, 0 if equal at all levels.
   *
   * Levels:
   * 1. Hard-budget feasibility + mandatory points satisfied
   * 2. No forbidden isolated singletons (locality violations)
   * 3. Unique-POI utility AND preferred-category fit
   * 4. Exact-route quality policy (confirmed > unavoidable fallback > other degradation)
   * 5. Compactness (lower total route time is better)
   * 6. Loop quality (lower road repeat is better)
   * 7. Profile/scenic/elevation fit per preset
   * 8. Budget utilization (higher is better — but only as a weak tie-breaker)
   */
  compare(a: CompareInput, b: CompareInput): CompareResult {
    // Level 1: feasibility dominates everything.
    const aFeasible = a.totals.feasible ? 1 : 0;
    const bFeasible = b.totals.feasible ? 1 : 0;
    if (aFeasible !== bFeasible) return aFeasible > bFeasible ? -1 : 1;

    // Level 2: locality violations. Fewer is better.
    if (a.localityViolations !== b.localityViolations) return a.localityViolations < b.localityViolations ? -1 : 1;

    // Level 3: unique POI utility AND preferred-category fit.
    const aUnique = a.places.reduce((s, p) => s + p.pois.filter((poi) => poi.included).length, 0);
    const bUnique = b.places.reduce((s, p) => s + p.pois.filter((poi) => poi.included).length, 0);
    if (aUnique !== bUnique) return aUnique > bUnique ? -1 : 1;

    // Level 3b: preferred-category fit (more hits = better).
    const aPref = this.preferredHits(a);
    const bPref = this.preferredHits(b);
    if (aPref !== bPref) return aPref > bPref ? -1 : 1;

    // Level 4: exact-route quality. A confirmed exact route must beat a
    // degraded feasible route with the same attraction value, even if it is
    // slightly longer; compactness only breaks equal-quality candidates.
    const aVerdict = a.qualityRank ?? 0;
    const bVerdict = b.qualityRank ?? 0;
    if (aVerdict !== bVerdict) return aVerdict > bVerdict ? -1 : 1;

    // Level 5: compactness (lower travel time is better).
    if (a.totals.travelMinutes !== b.totals.travelMinutes) return a.totals.travelMinutes < b.totals.travelMinutes ? -1 : 1;

    // Level 5b: sequence travel efficiency — when total travel time is equal,
    // the route whose inter-place legs are uniformly short (no single
    // dominating backtracking jump) is preferred. This is the level that makes
    // a geographically ordered loop beat a zigzag with the same duration.
    const aEff = this.sequenceEfficiency(a.places);
    const bEff = this.sequenceEfficiency(b.places);
    if (aEff !== bEff) return aEff > bEff ? -1 : 1;

    // Level 6: loop quality (lower road repeat is better).
    const aQuality = this.loops.assess(a.route.geojson.geometry?.coordinates ?? []);
    const bQuality = this.loops.assess(b.route.geojson.geometry?.coordinates ?? []);
    if (aQuality.repeatedRoadRatio !== bQuality.repeatedRoadRatio) return aQuality.repeatedRoadRatio < bQuality.repeatedRoadRatio ? -1 : 1;

    // Level 7: profile/scenic/elevation fit per preset.
    const aElevation = a.preset === 'training' ? a.route.ascend : 0;
    const bElevation = b.preset === 'training' ? b.route.ascend : 0;
    if (aElevation !== bElevation) return aElevation > bElevation ? -1 : 1;

    // Level 8: budget utilization as weak tie-breaker only.
    const aUtil = Math.min(1, a.totals.totalMinutes / Math.max(1, a.budgetMinutes));
    const bUtil = Math.min(1, b.totals.totalMinutes / Math.max(1, b.budgetMinutes));
    if (aUtil !== bUtil) return aUtil > bUtil ? -1 : 1;

    return 0;
  }

  private preferredHits(input: CompareInput): number {
    if (!input.preferredCategories || input.preferredCategories.length === 0) return 0;
    const preferredSet = new Set(input.preferredCategories);
    const categories = new Set(input.places.flatMap((place) => place.pois.map((poi) => poi.category)));
    return [...categories].filter((category) => preferredSet.has(category)).length;
  }

  private sector(point: Point, start: Point): number {
    return Math.floor(((Math.atan2(point.lat - start.lat, point.lon - start.lon) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4));
  }

  /**
   * Sequence travel efficiency in [0,1]: penalizes unnecessary backtracking —
   * how much longer the ordered inter-place path is than the Place set's
   * geometric span (maximum pairwise distance).
   *   efficiency = 1 when the route visits Places as one contiguous sweep
   *                (path length ≈ span),
   *   drops linearly to 0 as the path doubles the span (a zigzag that bounces
   *   across the cluster, or a mid-tour jump out and back). Purely geometric
   *   (haversine) so the breakdown and the lexicographic level are stable and
   *   cheap to compute.
   */
  private sequenceEfficiency(places: RoutePlace[]): number {
    if (places.length < 2) return 1;
    const centers = places.map((p) => p.center);
    let total = 0;
    let span = 0;
    for (let i = 0; i < centers.length; i++) {
      if (i > 0) total += this.haversineMeters(centers[i - 1], centers[i]);
      for (let j = i + 1; j < centers.length; j++) {
        span = Math.max(span, this.haversineMeters(centers[i], centers[j]));
      }
    }
    if (span < 1) return 1; // effectively co-located Places: nothing to penalize
    return Math.max(0, Math.min(1, 2 - total / span));
  }

  private haversineMeters(a: Point, b: Point): number {
    const R = 6_371_000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
}
