import { Injectable, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { GraphHopperClient, GraphHopperError, GhPath } from './graphhopper.client';
import {
  RouteResult,
  RoutingProfile,
  RoutingHealth,
  PlanResult,
  PlanOptions,
  routingProfileFamily,
} from './routing.types';
import { RouteRequestDto, RoundTripRequestDto } from './dto/routing.dto';
import { PlanRequestDto } from './dto/routing.dto';
import { optimizeOrder, LonLat } from './tsp';
import { PoisService } from '../pois/pois.service';
import { LoopQualityService } from './loop-quality.service';
import { GhPathDetails, normalizeRoadFacts } from './road-facts';

/**
 * Routing capability (ARCHITECTURE §5/§6). Wraps GraphHopper and returns a
 * normalized result (distance/duration/ascend/descend + GeoJSON). This is the
 * single place routing logic lives — later the MCP server reuses it too.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly loopQuality = new LoopQualityService();

  constructor(
    private readonly gh: GraphHopperClient,
    @Inject(forwardRef(() => PoisService))
    private readonly poisService?: PoisService,
  ) {}

  /** Scenario A — point-to-point (or multi-point) route. */
  async pointToPoint(dto: RouteRequestDto): Promise<RouteResult> {
    if (!RouteRequestDto.isValidProfile(dto.profile)) {
      throw new BadRequestException(
        `Unknown profile "${dto.profile}". Use one of: bike, mtb, foot, car.`,
      );
    }
    const path = await this.call(() =>
      this.gh.route(dto.points, dto.profile as RoutingProfile),
    );
    return this.normalize(path, dto.profile as RoutingProfile);
  }

  /**
   * Scenario C — generate a round-trip loop from a budget (distance).
   *
   * By default returns one loop. With `variants > 1`, generates N loops with
   * different seeds and picks the one with minimum self-overlap (i.e. the
   * most "petal" / "figure-8" shaped rather than backtracking).
   *
   * With `includeAlternatives`, returns up to 2 alternative loops in
   * `alternatives[]` for the UI to offer as "other good options".
   */
  async roundTrip(
    dto: RoundTripRequestDto,
  ): Promise<RouteResult & { variants?: RouteResult[]; selfOverlap?: number }> {
    if (!RouteRequestDto.isValidProfile(dto.profile)) {
      throw new BadRequestException(
        `Unknown profile "${dto.profile}". Use one of: bike, mtb, foot, car.`,
      );
    }
    const distance = dto.distance ?? 10_000;
    const variants = dto.variants ?? 1;
    const profile = dto.profile as RoutingProfile;

    if (variants === 1) {
      // Fast path: single round_trip, no alternatives
      const path = await this.call(() => this.gh.roundTrip(dto.start, profile, distance, dto.seed));
      return this.normalize(path, profile);
    }

    // N variants: parallel-ish (sequential) generation, then pick best
    const paths: { path: any; overlap: number; seed: number }[] = [];
    for (let i = 0; i < variants; i++) {
      // Use base seed if provided, else generate; offset by i for variety
      const baseSeed = dto.seed ?? (Date.now() & 0x7fffffff);
      const variantSeed = (baseSeed + i * 9973) & 0x7fffffff;
      try {
        const path = await this.call(() =>
          this.gh.roundTrip(dto.start, profile, distance, variantSeed),
        );
        const coords = path.points?.coordinates || [];
        const overlap = this.loopQuality.assess(coords).repeatedRoadRatio;
        paths.push({ path, overlap, seed: variantSeed });
      } catch {
        // skip failed variant
      }
    }

    if (paths.length === 0) {
      throw new BadRequestException('Не удалось построить ни одной петли.');
    }

    // Sort by overlap (ascending) — lowest overlap = best "petal" shape
    paths.sort((a, b) => a.overlap - b.overlap);
    const best = paths[0];
    const result = this.normalize(best.path, profile) as RouteResult & { variants?: RouteResult[]; selfOverlap?: number };
    result.selfOverlap = best.overlap;

    if (dto.includeAlternatives && paths.length > 1) {
      result.variants = paths.slice(1, 3).map((p) => this.normalize(p.path, profile));
    }

    return result;
  }

  health(): Promise<RoutingHealth> {
    return this.gh.health();
  }

  /** Calculate isochrone (reachable area) and return bounding box + GeoJSON for POI search & map rendering. */
  async isochrone(
    point: { lon: number; lat: number },
    profile: RoutingProfile,
    timeLimitMinutes: number,
    signal?: AbortSignal,
  ): Promise<{ bbox: [number, number, number, number]; geojson?: any; approximate?: boolean }> {
    return this.gh.isochrone(point, profile, timeLimitMinutes, signal);
  }

  /** Estimate network detour for route enrichment when routing each candidate
   * would be too expensive. */
  private getDetourFactor(profile: RoutingProfile, distanceKm: number = 5): number {
    const base: Record<string, number> = {
      foot: 1.30,  // pedestrian paths are most direct
      bike: 1.35,  // road network for bikes is dense
      mtb:  1.40,  // off-road: more switchbacks, trail detours
      car:  1.25,  // road network for cars is densest
    };
    const decay: Record<string, number> = {
      foot: 0.18,
      bike: 0.20,
      mtb:  0.22,
      car:  0.15,
    };
    const family = routingProfileFamily(profile);
    const b = base[family] ?? 1.35;
    const d = decay[family] ?? 0.20;
    return b + d / Math.log10(1 + Math.max(0.1, distanceKm));
  }

  /** Extract route points from a normalised GeoJSON Feature (LineString). */
  private extractRoutePoints(geojson: any): { lat: number; lon: number }[] {
    const coords = geojson?.geometry?.coordinates;
    if (!Array.isArray(coords)) return [];
    return coords.map((c: number[]) => ({ lat: c[1], lon: c[0] }));
  }

  /** Compute the cheapest insertion detour for a point into a route polyline.
   *
   * Standard insertion heuristic (VRP): for each segment (A→B) of the route,
   * detour = dist(A,P) + dist(P,B) − dist(A,B). Returns the minimum detour
   * across all segments and the index after which to insert.
   *
   * This estimates how much EXTRA distance is added by visiting the POI —
   * a POI directly on the route has detour ≈ 0, a POI 500m off-route has
   * detour ≈ 1000m (go there and come back). */
  private computeInsertionDetour(
    point: { lat: number; lon: number },
    routePoints: { lat: number; lon: number }[],
  ): { detourM: number; insertAfterIdx: number } {
    if (routePoints.length < 2) return { detourM: 0, insertAfterIdx: 0 };
    let bestDetour = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < routePoints.length - 1; i++) {
      const a = routePoints[i];
      const b = routePoints[i + 1];
      const distAB = this.haversine(a.lat, a.lon, b.lat, b.lon);
      const distAP = this.haversine(a.lat, a.lon, point.lat, point.lon);
      const distPB = this.haversine(point.lat, point.lon, b.lat, b.lon);
      const detour = distAP + distPB - distAB;
      if (detour < bestDetour) {
        bestDetour = detour;
        bestIdx = i;
      }
    }
    return { detourM: Math.max(0, bestDetour), insertAfterIdx: bestIdx };
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private getSpeedMs(profile: RoutingProfile): number {
    const speeds = { foot: 1.4, bike: 4.2, mtb: 3.3, car: 11.1 };
    return speeds[routingProfileFamily(profile)] || 4.2;
  }

  /**
   * Unified plan (scenario A/B): start → through selected POI waypoints.
   *
   * - `optimize`: reorder waypoints via TSP (nearest-neighbour + 2-opt).
   * - `loop`: when true AND waypoints.length >= 2, the return leg (Pn→start)
   *   is requested with `alternative_route` variants and the one with minimum
   *   road overlap vs the outbound path is selected. This prevents the "same
   *   road back" problem that makes loops boring.
   * - `alternatives`: for a single waypoint, request several distinct A→B paths
   *   (the "something beautiful / not the same road" proxy). Ignored for ≥2
   *   waypoints (loop mode handles that case).
   *
   * Returns the reordered waypoint indices so the UI can number the stops.
   */
  async plan(dto: PlanRequestDto, signal?: AbortSignal): Promise<PlanResult> {
    if (!RouteRequestDto.isValidProfile(dto.profile)) {
      throw new BadRequestException(
        `Unknown profile "${dto.profile}". Use one of: bike, mtb, foot, car.`,
      );
    }
    const opts: PlanOptions = dto.options ?? {};

    // 1. (optionally) reorder waypoints for a shorter tour.
    let waypoints = dto.waypoints;
    let order = dto.waypoints.map((_, i) => i);
    if (opts.optimize) {
      const { order: reordered, indices } = optimizeOrder(
        dto.start,
        dto.waypoints as LonLat[],
        Boolean(opts.loop),
      );
      waypoints = reordered as typeof dto.waypoints;
      order = indices;
    }

    // 2. Build the point sequence: start → waypoints.
    const outboundSeq: LonLat[] = [dto.start as LonLat, ...waypoints];

    // 3. Build route (either loop or simple path).
    let result: PlanResult;
    if (opts.loop && waypoints.length >= 1) {
      result = await this.buildLoopWithReturnVariants(
        outboundSeq,
        dto.profile as RoutingProfile,
        order,
        Boolean(opts.optimize),
        signal,
      );
    } else {
      const seq: LonLat[] = [...outboundSeq];
      if (opts.loop) seq.push(dto.start as LonLat);
      const paths = await this.call(() =>
        this.gh.routeMulti(seq, dto.profile as RoutingProfile, {
          alternatives: opts.alternatives,
          maxAlternatives: opts.maxAlternatives,
          signal,
        }),
      );
      const routes = paths.map((p) => this.normalize(p, dto.profile as RoutingProfile));
      result = { routes, order, loop: Boolean(opts.loop), optimize: Boolean(opts.optimize) };
    }

    // 4. Budget check — verify the route fits within user's time budget.
    //    10% tolerance for real-world variation.
    if (opts.timeBudgetMinutes && result.routes.length > 0) {
      const budgetSec = opts.timeBudgetMinutes * 60;
      const routeSec = result.routes[0].duration;
      if (routeSec > budgetSec) {
        const overage = Math.round((routeSec - budgetSec) / 60);
        const need = Math.ceil(routeSec / 60);
        throw new BadRequestException(
          `Маршрут на ${overage} мин дольше запрошенного времени. ` +
          `Уберите часть точек, чтобы уложиться в ${opts.timeBudgetMinutes} мин, ` +
          `или увеличьте время до ${need} мин.`,
        );
      }
    }

    // 5. Enrichment — suggest POIs near the route that fit the remaining
    //    budget. This powers the "user picks Bakulev → system suggests Lake
    //    Kurya nearby" behaviour. The base route is NOT modified — suggested
    //    POIs are returned as a separate list for the UI to offer as adds.
    if (opts.enrichWithPois && this.poisService && result.routes.length > 0) {
      result.suggestedPois = await this.enrichRouteWithPois(
        result.routes[0],
        dto.profile as RoutingProfile,
        waypoints,
        opts,
      );
    }

    return result;
  }

  /** Find POIs near an existing route that fit in the remaining time budget.
   *
   * Uses the insertion heuristic: for each candidate POI, computes the
   * cheapest detour (extra distance) from inserting it into the route
   * polyline. Greedily adds POIs by value/detour ratio until the remaining
   * budget is consumed.
   *
   * User-selected waypoints are excluded (don't suggest what's already chosen).
   * Returns a list of suggested POIs with estimated detour minutes — the UI
   * shows them as "+N min detour, add?" chips. */
  private async enrichRouteWithPois(
    route: RouteResult,
    profile: RoutingProfile,
    userWaypoints: any[],
    opts: PlanOptions,
  ): Promise<Array<{ id: string; name: string; category: string; lat: number; lon: number; detourMinutes: number }>> {
    const bufferM = opts.enrichBufferMeters ?? 1000;
    const visitSec = 300; // 5 min visit default
    const speedMs = this.getSpeedMs(profile);
    const detourFactor = this.getDetourFactor(profile, route.distance / 1000);

    // Remaining budget: explicit timeBudget, else default 60 min enrichment window
    const totalBudgetSec = opts.timeBudgetMinutes
      ? opts.timeBudgetMinutes * 60
      : route.duration + 60 * 60;
    const remainingBudgetSec = Math.max(0, totalBudgetSec - route.duration);

    // Extract route points from GeoJSON for insertion-detour computation
    const routePoints = this.extractRoutePoints(route.geojson);
    if (routePoints.length < 2) return [];

    // Query POIs near route bbox + buffer
    const [minLon, minLat, maxLon, maxLat] = route.bbox;
    const bufferDeg = bufferM / 111000; // rough meters→degrees
    const bboxStr = `${minLon - bufferDeg},${minLat - bufferDeg},${maxLon + bufferDeg},${maxLat + bufferDeg}`;

    const poisResult = await this.poisService!.list({
      bbox: bboxStr,
      category: opts.enrichCategories,
      limit: 200,
      sort: 'popularity',
    });

    // Filter: exclude user waypoints (within 150m) and compute insertion detour
    const candidates = poisResult.items
      .filter(p => p.lat && p.lon)
      .filter(p => !userWaypoints.some(w =>
        this.haversine(w.lat, w.lon, p.lat, p.lon) < 150,
      ))
      .map(p => {
        const { detourM } = this.computeInsertionDetour(
          { lat: p.lat, lon: p.lon }, routePoints,
        );
        return { poi: p, detourM };
      })
      .filter(c => c.detourM <= bufferM * 2); // within 2× buffer (reasonable detour)

    // Sort by value/detour ratio — most interesting per minute of detour first
    candidates.sort((a, b) => {
      const aVal = ((a.poi.popularityScore || 0) + 0.5) / Math.max(a.detourM / 1000, 0.1);
      const bVal = ((b.poi.popularityScore || 0) + 0.5) / Math.max(b.detourM / 1000, 0.1);
      return bVal - aVal;
    });

    // Greedily add POIs that fit remaining budget
    const suggested: Array<{ id: string; name: string; category: string; lat: number; lon: number; detourMinutes: number }> = [];
    let usedBudget = 0;
    for (const c of candidates) {
      const detourSec = (c.detourM * detourFactor) / speedMs + visitSec;
      if (usedBudget + detourSec <= remainingBudgetSec) {
        suggested.push({
          id: c.poi.id,
          name: c.poi.name,
          category: c.poi.category,
          lat: c.poi.lat,
          lon: c.poi.lon,
          detourMinutes: Math.round(detourSec / 60),
        });
        usedBudget += detourSec;
      }
      if (suggested.length >= 5) break; // cap at 5 suggestions
    }

    return suggested;
  }

  /**
   * Build a loop by splitting outbound and return legs.
   *
   * The return leg (Pn→start) is requested with alternative_route to get
   * multiple return options. Each option is scored by road overlap with the
   * outbound path — the variant with MINIMUM overlap wins.
   *
   * This directly addresses the "loop repeats the same roads" problem.
   */
  private async buildLoopWithReturnVariants(
    outboundSeq: LonLat[],
    profile: RoutingProfile,
    order: number[],
    optimize: boolean,
    signal?: AbortSignal,
  ): Promise<PlanResult> {
    const lastPoi = outboundSeq[outboundSeq.length - 1]; // Pn
    const start = outboundSeq[0];

    // Build outbound route: start → P1 → ... → Pn
    const outPaths = await this.call(() =>
      this.gh.routeMulti(outboundSeq, profile, { flexible: true, signal }),
    );
    const outPath = outPaths[0];
    if (!outPath?.points?.coordinates?.length) {
      throw new BadRequestException('Не удалось построить исходящий маршрут.');
    }

    // Build return variants: Pn → start with alternative_route
    const returnPaths = await this.call(() =>
      this.gh.routeMulti([lastPoi, start], profile, {
        alternatives: true,
        maxAlternatives: 4,
        signal,
      }),
    );

    // Preserve overlap as the hard gate. POI richness only breaks ties inside it.
    const outCoords = outPath.points.coordinates;
    const scored = returnPaths.map((path, index) => ({ path, index, overlap: this.loopQuality.overlap(outCoords, path.points?.coordinates || []) }));
    const overlapBest = Math.min(...scored.map((item) => item.overlap));
    const shortlist = scored.filter((item) => item.overlap <= overlapBest + 0.02).slice(0, 4);
    const enriched = await this.scoreReturnShortlist(shortlist, outboundSeq, signal);
    const ranked = enriched ?? shortlist.map((item) => ({ ...item, richness: 0, count: 0 }));
    ranked.sort((a, b) => b.richness - a.richness || b.count - a.count || a.overlap - b.overlap || a.path.time - b.path.time || a.index - b.index);
    const chosen = ranked[0];
    const bestReturn = chosen.path;
    const bestOverlap = chosen.overlap;

    // Combine geometries: outbound + return (skip duplicate Pn coordinate)
    const returnCoords = bestReturn.points?.coordinates?.slice(1) || [];
    const combinedCoords = [...outCoords, ...returnCoords];
    const combinedBbox = this.mergeBbox(outPath.bbox, bestReturn.bbox);

    const combined: GhPath = {
      points: { type: 'LineString', coordinates: combinedCoords },
      distance: outPath.distance + bestReturn.distance,
      time: outPath.time + bestReturn.time,
      ascend: (outPath.ascend || 0) + (bestReturn.ascend || 0),
      descend: (outPath.descend || 0) + (bestReturn.descend || 0),
      bbox: combinedBbox,
      points_encoded: false,
      details: this.mergePathDetails(outPath, bestReturn),
    };

    const route = this.normalize(combined, profile);
    const warnings = bestOverlap >= 0.6 ? ['UNAVOIDABLE_OUT_AND_BACK'] : [];
    return { routes: [route], order, loop: true, optimize, loopQuality: this.loopQuality.assess(combinedCoords), warnings };
  }

  private async scoreReturnShortlist(
    shortlist: Array<{ path: GhPath; index: number; overlap: number }>, outbound: LonLat[], signal?: AbortSignal,
  ): Promise<Array<{ path: GhPath; index: number; overlap: number; richness: number; count: number }> | null> {
    const started = Date.now();
    let poiQueries = 0; let poiCandidateRows = 0; let fallback = false;
    const finish = (value: Array<{ path: GhPath; index: number; overlap: number; richness: number; count: number }> | null) => {
      this.logger.debug(JSON.stringify({ returnVariants: shortlist.length, overlapBest: Math.min(...shortlist.map(s => s.overlap)), shortlistSize: shortlist.length, poiQueries, poiCandidateRows, poiScoreMs: Date.now() - started, poiTieBreakUsed: !!value, poiScoreFallback: fallback }));
      return value;
    };
    if (!this.poisService || signal?.aborted || !shortlist.length) { fallback = true; return finish(null); }
    const deadline = Date.now() + 800;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('POI scoring deadline')), 800);
    try {
      const coords = shortlist.flatMap((item) => item.path.points?.coordinates ?? []);
      if (!coords.length || controller.signal.aborted) { fallback = true; return finish(null); }
      const midLat = (Math.min(...coords.map(c => c[1])) + Math.max(...coords.map(c => c[1]))) / 2;
      const latPad = 750 / 110_540;
      const lonPad = 750 / (111_320 * Math.max(0.1, Math.cos(midLat * Math.PI / 180)));
      const bbox: [number, number, number, number] = [Math.min(...coords.map(c => c[0])) - lonPad, Math.min(...coords.map(c => c[1])) - latPad, Math.max(...coords.map(c => c[0])) + lonPad, Math.max(...coords.map(c => c[1])) + latPad];
      if ((bbox[2] - bbox[0]) * 111_320 * Math.cos(midLat * Math.PI / 180) > 120_000 || (bbox[3] - bbox[1]) * 110_540 > 120_000) { fallback = true; return finish(null); }
      poiQueries = 1;
      const candidates = await this.poisService.findReturnLegCandidates(bbox, 120, controller.signal, deadline);
      poiCandidateRows = candidates.length;
      if (controller.signal.aborted || Date.now() > deadline || !candidates.length) { fallback = true; return finish(null); }
      const scored = [];
      for (const item of shortlist) {
        if (controller.signal.aborted || Date.now() > deadline) { fallback = true; return finish(null); }
        const line = this.simplifyPolyline(item.path.points?.coordinates ?? [], 250);
        const accepted = [];
        for (const poi of candidates) {
          if (controller.signal.aborted || Date.now() > deadline) { fallback = true; return finish(null); }
          const point = { lon: poi.lon, lat: poi.lat };
          if (!outbound.some(p => this.distanceMeters(point, p) < 150) && this.distanceToPolylineMeters(point, line) <= 750) accepted.push(poi);
        }
        const top = [...new Map(accepted.map(p => [p.id, p])).values()].sort((a, b) => (1 + Math.min(5, Math.max(0, b.popularityScore ?? 0))) - (1 + Math.min(5, Math.max(0, a.popularityScore ?? 0))) || a.id.localeCompare(b.id)).slice(0, 8);
        scored.push({ ...item, count: top.length, richness: top.reduce((sum, p) => sum + 1 + Math.min(5, Math.max(0, p.popularityScore ?? 0)), 0) });
      }
      return finish(scored);
    } catch { fallback = true; return finish(null); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  private simplifyPolyline(coords: number[][], maxSegments: number): number[][] {
    if (coords.length <= maxSegments + 1) return coords;
    const step = (coords.length - 1) / maxSegments;
    return Array.from({ length: maxSegments + 1 }, (_, i) => coords[Math.round(i * step)]);
  }

  private distanceToPolylineMeters(point: LonLat, coords: number[][]): number {
    let best = Infinity;
    for (let i = 1; i < coords.length; i++) best = Math.min(best, this.distanceToSegmentMeters(point, { lon: coords[i - 1][0], lat: coords[i - 1][1] }, { lon: coords[i][0], lat: coords[i][1] }));
    return best;
  }

  private distanceToSegmentMeters(point: LonLat, a: LonLat, b: LonLat): number {
    const latitude = point.lat * Math.PI / 180; const x = (lon: number) => lon * 111_320 * Math.cos(latitude); const y = (lat: number) => lat * 110_540;
    const ax = x(a.lon), ay = y(a.lat), bx = x(b.lon), by = y(b.lat), px = x(point.lon), py = y(point.lat);
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  private distanceMeters(a: LonLat, b: LonLat): number {
    return this.distanceToSegmentMeters(a, b, b);
  }

  /**
   * Combines detail intervals for a route assembled from two GraphHopper legs.
   * A kind is retained only when both legs supplied it, avoiding a partial
   * route claim after a detail response was absent for either request.
   */
  private mergePathDetails(first: GhPath, second: GhPath): GhPathDetails | undefined {
    if (!first.details || !second.details) return undefined;
    const offset = first.points.coordinates.length - 1;
    const merged: GhPathDetails = {};
    for (const kind of ['road_class', 'surface', 'road_environment', 'track_type'] as const) {
      const firstIntervals = first.details[kind];
      const secondIntervals = second.details[kind];
      if (!firstIntervals?.length || !secondIntervals?.length) continue;
      merged[kind] = [
        ...firstIntervals,
        ...secondIntervals.map(([from, to, value]) => [from + offset, to + offset, value] as const),
      ];
    }
    return Object.keys(merged).length ? merged : undefined;
  }

  /** Merge two bboxes into one that contains both. */
  private mergeBbox(
    a: [number, number, number, number],
    b: [number, number, number, number],
  ): [number, number, number, number] {
    return [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.max(a[3], b[3]),
    ];
  }

  /** Wrap GraphHopper errors as 400s (e.g. "Cannot find point"). */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GraphHopperError) {
        throw new BadRequestException(`Routing failed: ${err.message}`);
      }
      throw err;
    }
  }

  private normalize(path: GhPath, profile: RoutingProfile): RouteResult {
    const roadFacts = normalizeRoadFacts(path.details, path.points);
    return {
      geojson: {
        type: 'Feature',
        geometry: path.points ?? null,
        properties: {
          distance: path.distance,
          duration: Math.round(path.time / 1000),
          ascend: path.ascend,
          descend: path.descend,
          profile,
        },
      },
      distance: path.distance,
      duration: Math.round(path.time / 1000),
      ascend: path.ascend,
      descend: path.descend,
      profile,
      bbox: path.bbox,
      ...(roadFacts ? { roadFacts } : {}),
    };
  }
}
