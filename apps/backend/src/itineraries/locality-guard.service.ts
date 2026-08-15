import { Injectable } from '@nestjs/common';
import type { Point, RoutePlace } from './itinerary.types';
import type { OptimizationRunBudget } from './optimization-run-budget';

export interface LocalityGuardResult {
  /** Places that survived the guard (passed + all manual/locked). */
  admissible: RoutePlace[];
  /** Places excluded by the guard (automatic isolated singletons only). */
  excluded: RoutePlace[];
  /** True if at least one place was excluded. */
  applied: boolean;
}

export interface LocalityGuardOptions {
  /** Shared run budget; the guard stops issuing network pair-costs once it is
   *  exhausted (unknown candidates cannot displace the confirmed solution). */
  runBudget?: OptimizationRunBudget;
  /** Cap on directed network checks for plausibly-remote singleton decisions.
   *  Each check costs up to two directed GraphHopper calls (out + back). */
  maxRemoteNetworkChecks?: number;
  /** Speed used to convert the geometric local threshold (metres) into the
   *  network threshold (seconds) when a network cost function is present.
   *  Defaults to a bike-touring speed. */
  profileSpeedMs?: number;
}

/** Local-offer radius: the dense area that defines “local” for one run. */
const LOCAL_OFFER_METERS = 2000;
/** Neighbourhood radius for the “shares the same egress” exemption. */
const EGRESS_SHARE_METERS = 800;
/** Default conversion speed for the geometric → network threshold. */
const DEFAULT_SPEED_MS = 4.5;
/** Maximum directed network checks for plausible remote singletons. */
const MAX_REMOTE_NETWORK_CHECKS = 6;

/**
 * Locality guard for automatic itinerary selection (design §5.3, plan M1).
 *
 * A RoutePlace is an *isolated automatic singleton* iff ALL:
 *  1. source === 'auto'
 *  2. exactly one child POI
 *  3. its marginal insertion cost is materially above the local candidate
 *     distribution (relative threshold + a minimum excursion floor)
 *  4. no LOCAL place shares its network egress (a remote singleton next to
 *     another remote singleton is still a remote excursion — the guard keeps
 *     the main solution local whenever a dense local offer exists)
 *
 * `featured`, popularity, and budget-fill do NOT lift the ban.
 * Manual/locked Places are never excluded — they are user-explicit goals.
 *
 * The threshold is NOT a global radius. It is relative to the local offer +
 * the marginal insertion cost distribution.
 *
 * BOUNDING (D6): the guard never performs network pair-costs across the whole
 * candidate pool. The local cost distribution is computed geometrically
 * (haversine round trip — free), and directed network marginal costs are only
 * issued for a small capped set of plausible remote singleton decisions
 * (geometrically above the local threshold, most remote first). Once the run
 * budget is exhausted the guard stops issuing calls entirely: unknown
 * candidates survive (they can never displace the confirmed local solution).
 */
@Injectable()
export class LocalityGuardService {
  /**
   * Filter automatic isolated singletons from the candidate pool.
   *
   * @param places Clustered Places from the candidate provider.
   * @param start The route start point.
   * @param costFn Optional directed cost function (from M2 evaluator). When
   *   absent, a geometric haversine lower bound is used (metres). When present,
   *   costs are confirmed network seconds — the threshold uses the same units.
   * @returns Surviving places + excluded singletons.
   */
  async guard(
    places: RoutePlace[],
    start: Point,
    costFn?: (a: Point, b: Point) => Promise<number | null>,
    opts: LocalityGuardOptions = {},
  ): Promise<LocalityGuardResult> {
    if (places.length === 0) return { admissible: [], excluded: [], applied: false };

    // Separate manual/locked (always survive) from automatic candidates.
    const mandatory = places.filter((p) => p.source === 'manual' || p.locked);
    const automatic = places.filter((p) => p.source !== 'manual' && !p.locked);

    // Automatic singletons: auto source, exactly 1 POI.
    const autoSingletons = automatic.filter((p) => p.pois.length === 1);
    // Non-singleton automatic places (clusters of 2+) always survive — they are
    // dense by definition and distance alone is not disqualifying.
    const autoClusters = automatic.filter((p) => p.pois.length >= 2);

    if (autoSingletons.length === 0) {
      return { admissible: [...mandatory, ...automatic], excluded: [], applied: false };
    }

    // The local offer is what defines the local cost distribution: places
    // within the local radius of the start. Remote clusters are legitimate
    // destinations but they must not inflate the “local” median.
    const localPlaces = automatic.filter((p) => this.haversine(start, p.center) <= LOCAL_OFFER_METERS);
    if (localPlaces.length < 2) {
      // No dense local offer — cannot apply the guard meaningfully.
      return { admissible: [...mandatory, ...automatic], excluded: [], applied: false };
    }

    // 1. GEOMETRIC local cost distribution (free, no network calls). The guard
    //    never issues pair-costs to characterise the local offer.
    const localGeoCosts = localPlaces.map((p) => 2 * this.haversine(start, p.center));
    const localMedianM = this.median(localGeoCosts);
    // Materially above the local distribution (3×) AND beyond a minimum
    // excursion, so the guard never excludes short outings from an ultra-dense
    // square. Metres (geometric round trip).
    const geoThresholdM = Math.max(localMedianM * 3, 3000);

    // 2. Plausible-remote shortlist: singletons whose geometric round trip
    //    already exceeds the local threshold, most remote first, capped so a
    //    ~55-Place pool costs at most 2 × cap directed calls.
    const plausiblyRemote = autoSingletons
      .map((place) => ({ place, geoCost: 2 * this.haversine(start, place.center) }))
      .filter((e) => e.geoCost > geoThresholdM)
      .sort((a, b) => b.geoCost - a.geoCost || a.place.id.localeCompare(b.place.id))
      .slice(0, opts.maxRemoteNetworkChecks ?? MAX_REMOTE_NETWORK_CHECKS);

    const speedMs = opts.profileSpeedMs ?? DEFAULT_SPEED_MS;
    const networkThresholdSec = Math.max(geoThresholdM / speedMs, 1500);
    const exhausted = () => opts.runBudget?.isExhausted() ?? false;

    // 3. Directed network marginal costs ONLY for the capped remote shortlist.
    //    Unknown/exhausted candidates are never excluded: a candidate whose
    //    network cost cannot be confirmed cannot displace the confirmed local
    //    solution, and stopping early preserves budget for route builds.
    const excludedIds = new Set<string>();
    if (costFn) {
      for (const { place } of plausiblyRemote) {
        if (exhausted()) break;
        // Shares a LOCAL egress? Only a place in the local offer can make this
        // trip a natural extension of the local route.
        if (this.hasLocalNeighbor(place, localPlaces)) continue;
        const cost = await this.insertionCost(place, start, costFn);
        if (cost != null && cost > networkThresholdSec) excludedIds.add(place.id);
      }
    } else {
      // No network confirmation available — the geometric threshold decides.
      for (const { place } of plausiblyRemote) {
        if (exhausted()) break;
        if (!this.hasLocalNeighbor(place, localPlaces)) excludedIds.add(place.id);
      }
    }

    const excluded = autoSingletons.filter((p) => excludedIds.has(p.id));
    const surviving = autoSingletons.filter((p) => !excludedIds.has(p.id));
    return {
      admissible: [...mandatory, ...autoClusters, ...surviving],
      excluded,
      applied: excluded.length > 0,
    };
  }

  /** A plausibly-remote singleton next to a LOCAL place shares its egress and
   *  is a natural extension of the local route — it survives without a network
   *  check. A neighbour that is itself remote does not lift the ban. */
  private hasLocalNeighbor(place: RoutePlace, localPlaces: RoutePlace[]): boolean {
    return localPlaces.some((other) =>
      other.id !== place.id && this.haversine(place.center, other.center) <= EGRESS_SHARE_METERS,
    );
  }

  /** Marginal insertion cost: how much extra distance/time to visit this place
   *  from start relative to existing nearby places. Uses costFn if available
   *  (network seconds), otherwise geometric haversine round trip (metres).
   *  Returns null when the network cost is unknown. */
  private async insertionCost(
    place: RoutePlace,
    start: Point,
    costFn?: (a: Point, b: Point) => Promise<number | null>,
  ): Promise<number | null> {
    if (costFn) {
      const point = place.accessPoint ?? place.center;
      const out = await costFn(start, point);
      const back = await costFn(point, start);
      if (out != null && back != null) return out + back;
      // Network cost unknown — the guard cannot confirm the singleton is remote.
      return null;
    }
    // Geometric fallback: round-trip haversine from start.
    return 2 * this.haversine(start, place.center);
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private haversine(a: Point, b: Point): number {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
}
