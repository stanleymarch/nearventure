import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { DirectedWalkability, DirectedWalkabilityContext, ItineraryPoi, Point, RoutePlace } from './itinerary.types';
import type { RoutingProfile } from '../routing/routing.types';
import { VisitTimeService } from './visit-time.service';
import { GraphHopperWalkabilityService } from './graphhopper-walkability.service';
import type { OptimizationRunBudget, OptimizationRunCounters } from './optimization-run-budget';

export interface ClusterOverrides {
  splitPoiIds?: string[];
  manualGroups?: string[][];
  runBudget?: OptimizationRunBudget;
  signal?: AbortSignal;
  counters?: OptimizationRunCounters;
}

/** Cell width in degrees for the N-S axis: ~400 m (1° ≈ 111 320 m). */
const LAT_CELL = 0.0036;
/** Meters per degree of longitude at the reference latitude (haversine radius). */
const METERS_PER_DEG = 111_320;
/** True merge diameter: pairs farther apart are never walkability-combined. */
const MERGE_RADIUS_METERS = 400;

/**
 * Latitude-aware lon cell size in degrees so the E-W cell width is also ~400 m
 * at the run's reference latitude. A uniform 0.0036° lon cell would be only
 * ~208 m wide at 58.7°N, making pairs 350-399 m apart straddle two cells and
 * get missed by a 3x3 neighborhood.
 */
function lonCellFor(refLatRad: number): number {
  // Guard against cos→0 near the poles; practical runs are far from them.
  return LAT_CELL / Math.max(0.2, Math.cos(refLatRad));
}

function cellKey(p: Point, lonCell: number): string {
  return `${Math.floor(p.lat / LAT_CELL)},${Math.floor(p.lon / lonCell)}`;
}

/**
 * Complete-link clustering prevents A--B--C chains: every new child must be
 * walkable to every existing child and the geographic diameter stays <=400 m.
 * Radius is only a diameter pre-check. Non-explicit proximity grouping always
 * requires a directed foot-network decision; missing/unreachable means separate.
 *
 * A spatial cell index limits comparisons to candidates within ~400 m so a
 * 500-POI input does not produce O(n²) walkability calls.
 */
@Injectable()
export class PlaceClusteringService {
  constructor(
    private readonly visitTime: VisitTimeService,
    @Optional() @Inject(GraphHopperWalkabilityService) private readonly defaultWalkability?: DirectedWalkability,
  ) {}

  async cluster(pois: ItineraryPoi[], profile: RoutingProfile, walkability?: DirectedWalkability, overrides: ClusterOverrides = {}): Promise<RoutePlace[]> {
    const runBudget = overrides.runBudget;
    const signal = overrides.signal;
    const counters = overrides.counters;
    const canonical = [...pois].sort((a, b) => {
      const byId = a.id.localeCompare(b.id);
      if (byId) return byId;
      return this.poiFingerprint(a).localeCompare(this.poiFingerprint(b));
    });
    // Deterministically retain one record for a duplicate id, independent of
    // input order (the collector normally provides identical projections).
    const unique = [...new Map(canonical.map((poi) => [poi.id, poi])).values()];
    const split = new Set(overrides.splitPoiIds ?? []);
    const manual = new Map<string, number>();
    overrides.manualGroups?.forEach((group, index) => group.forEach((id) => manual.set(id, index)));
    // Latitude-aware grid: use the NORTHERNMOST latitude of the run so lon
    // cells are ≥400 m wide everywhere (cos is smallest there). That guarantees
    // any ≤400 m pair differs by at most one cell index per axis, so the 3x3
    // neighborhood never misses a pair that should be compared.
    const maxLat = Math.max(...unique.map((poi) => poi.lat));
    const refLatRad = maxLat * (Math.PI / 180);
    const lonCell = lonCellFor(refLatRad);
    const walkabilityCtx: DirectedWalkabilityContext = { runBudget, signal, counters };
    // Spatial cell index: groups are indexed by their first POI's cell.
    // When checking if a new POI can join, we only look at groups in cells
    // within ~400 m (3x3 neighborhood) instead of scanning every group.
    const groupCells = new Map<string, ItineraryPoi[][]>();
    const groups: ItineraryPoi[][] = [];

    for (const poi of [...unique].sort((a, b) => a.id.localeCompare(b.id))) {
      // A manual split is a persistent draft override, not an exclusion.
      if (split.has(poi.id)) { groups.push([poi]); continue; }
      const manualIndex = manual.get(poi.id);
      // Explicit and manual grouping use proximity checks only (no network).
      const explicitGroup = groups.find((group) => !group.some((item) => split.has(item.id)) && this.sameExplicit(poi, group));
      const manualGroup = manualIndex === undefined ? undefined : groups.find((group) =>
        !group.some((item) => split.has(item.id))
        && group.every((item) => manual.get(item.id) === manualIndex && this.distance(poi, item) <= MERGE_RADIUS_METERS),
      );
      if (explicitGroup || manualGroup) { (explicitGroup ?? manualGroup)!.push(poi); continue; }
      // Spatial-index-bounded search: only consider groups within ~400 m cells.
      const nearbyGroups = this.findNearbyGroups(poi, groupCells, lonCell);
      let joined = false;
      for (const group of nearbyGroups) {
        if (group.some((item) => split.has(item.id))) continue;
        if (await this.canJoin(poi, group, walkability ?? this.defaultWalkability, walkabilityCtx)) { group.push(poi); joined = true; break; }
      }
      if (!joined) {
        groups.push([poi]);
        const key = cellKey(poi, lonCell);
        const arr = groupCells.get(key) ?? [];
        arr.push(groups[groups.length - 1]);
        groupCells.set(key, arr);
      }
    }
    return groups.map((group) => this.toPlace(group, profile, manual));
  }

  private sameExplicit(poi: ItineraryPoi, group: ItineraryPoi[]): boolean {
    return !!poi.explicitComplexId && group.length > 0
      && group.every((item) => item.explicitComplexId === poi.explicitComplexId && this.distance(poi, item) <= MERGE_RADIUS_METERS);
  }

  private async canJoin(poi: ItineraryPoi, group: ItineraryPoi[], walkability?: DirectedWalkability, ctx: DirectedWalkabilityContext = {}): Promise<boolean> {
    for (const other of group) {
      if (this.distance(poi, other) > MERGE_RADIUS_METERS) return false;
      if (!walkability) return false;
      // D5: if budget exhausted, do NOT optimistically merge — stay separate.
      if (ctx.runBudget && ctx.runBudget.isExhausted()) return false;
      const from = poi.accessPoint ?? poi;
      const to = other.accessPoint ?? other;
      const [outbound, inbound] = await Promise.all([
        walkability.minutesBetween(from, to, ctx),
        walkability.minutesBetween(to, from, ctx),
      ]);
      if (outbound === null || inbound === null || outbound > 3 || inbound > 3) return false;
    }
    return true;
  }

  /** Find groups within ~400 m of the given POI using the spatial cell index.
   *  Lon span covers pairs straddling cell boundaries: with lon cells ~400 m
   *  wide and lat cells ~400 m wide, a ≤400 m pair differs by at most one cell
   *  index per axis, so a 3x3 neighborhood plus one extra lon ring is enough. */
  private findNearbyGroups(poi: ItineraryPoi, groupCells: Map<string, ItineraryPoi[][]>, lonCell: number): ItineraryPoi[][] {
    const cx = Math.floor(poi.lat / LAT_CELL);
    const cy = Math.floor(poi.lon / lonCell);
    const result: ItineraryPoi[][] = [];
    // lon ring ±1 in cell indices ≈ ±400 m at the reference latitude; lat is
    // always ±400 m per cell. A pair just under 400 m that straddles a cell
    // boundary lands exactly one cell away, which ±1 covers.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const arr = groupCells.get(key);
        if (arr) result.push(...arr);
      }
    }
    return result;
  }

  private toPlace(pois: ItineraryPoi[], profile: RoutingProfile, manual: Map<string, number>): RoutePlace {
    const ids = pois.map((poi) => poi.id).sort();
    const explicit = pois[0].explicitComplexId;
    const headline = [...pois].sort((a, b) => this.compareHeadline(a, b))[0];
    const center = { lat: pois.reduce((sum, poi) => sum + poi.lat, 0) / pois.length, lon: pois.reduce((sum, poi) => sum + poi.lon, 0) / pois.length };
    // A single-POI place is keyed by its own id even when it carries an
    // explicitComplexId: two distinct POIs of one complex (e.g. >400 m apart,
    // so never merged) must NOT collide on the same place id.
    const idKey = explicit && pois.length > 1 ? `${explicit}|${ids.join('|')}` : ids.join('|');
    const place: RoutePlace = {
      id: this.id(idKey), name: headline.name, center,
      // Recompute this display marker for every clustering pass, so legacy
      // snapshots with no metadata and stale prior markers remain safe.
      pois: pois.map((poi) => ({ ...poi, notable: poi.id === headline.id })),
      visitMode: 'visit', dwellMinutes: 0, arrivalOverheadMinutes: 0, source: 'manual', locked: false,
      clusterConfidence: explicit ? 'explicit' : manual.has(pois[0].id) ? 'manual' : 'walkable',
    };
    return this.visitTime.apply(place, profile);
  }

  /** Featured wins, then a valid popularity score, then normalized name/id. */
  private compareHeadline(a: ItineraryPoi, b: ItineraryPoi): number {
    const featured = Number(b.featured === true) - Number(a.featured === true);
    if (featured) return featured;
    const popularity = this.popularity(b) - this.popularity(a);
    if (popularity) return popularity;
    const nameA = this.normalizedName(a.name);
    const nameB = this.normalizedName(b.name);
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
  }

  private popularity(poi: ItineraryPoi): number {
    return typeof poi.popularityScore === 'number' && Number.isFinite(poi.popularityScore) ? poi.popularityScore : 0;
  }

  private normalizedName(name: string): string {
    return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private id(key: string): string { return `place_${createHash('sha256').update(key).digest('hex').slice(0, 20)}`; }
  private poiFingerprint(poi: ItineraryPoi): string {
    return [poi.explicitComplexId ?? '', poi.name, poi.category, poi.lat, poi.lon].join('|');
  }
  private distance(a: Point, b: Point): number {
    const rad = Math.PI / 180;
    const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
    const y = (b.lat - a.lat) * rad;
    return Math.sqrt(x * x + y * y) * 6371000;
  }
}
