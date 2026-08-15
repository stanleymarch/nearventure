import { BadRequestException, Injectable } from '@nestjs/common';
import { PoisService, type PoiRow } from '../pois/pois.service';
import { LoopQualityService } from '../routing/loop-quality.service';
import type { RouteResult } from '../routing/routing.types';
import { RoutingService } from '../routing/routing.service';
import { ItineraryBudgetService } from './itinerary-budget.service';
import { ItineraryScoreService } from './itinerary-score.service';
import { PlaceClusteringService } from './place-clustering.service';
import type { AutoAlternative, AutoScoreBreakdown, ItineraryDraftState, Point, RoutePlace, SelectionSummary, VisitMode } from './itinerary.types';
import { projectItineraryPoi } from './itinerary-poi-projection';
import { VisitTimeService } from './visit-time.service';
import { LocalityGuardService } from './locality-guard.service';
import { SelectionDiagnosticsLogger } from './selection-diagnostics.logger';
import { OptimizationRunBudget, OptimizationRunCounters } from './optimization-run-budget';
import { RouteCostEvaluatorService } from './route-cost-evaluator.service';
import { OptimizerSearchService, type SearchContext } from './optimizer-search.service';
import { GraphVersionProvider } from './graph-version.provider';
import { ItineraryQualityGateService, itineraryQualityWarningMessage, type ItineraryQuality } from './itinerary-quality-gate.service';

export interface AutoFillInput {
  /** @deprecated Compatibility input; categories are treated as preferences. */
  categories?: string[];
  preferredCategories?: string[];
  seed?: number;
  deadlineMs?: number;
  preset?: ItineraryDraftState['preset'];
  signal?: AbortSignal;
}
export class LockedSetOverBudgetError extends Error {}
/** Every evaluated candidate carries the verdict for its exact route so quality
 * policy can participate in selection rather than merely annotate the winner. */
type Evaluated = { places: RoutePlace[]; route: RouteResult; score: AutoScoreBreakdown; explanation: string; quality: ItineraryQuality };
const AUTO_CATEGORIES = new Set(['heritage', 'monument', 'sights', 'religion', 'nature', 'museum']);

@Injectable()
export class AutoItineraryOptimizerService {
  private readonly policyVersion: 'v1' | 'v2';
  constructor(
    private readonly pois: PoisService,
    private readonly routing: RoutingService,
    private readonly clustering: PlaceClusteringService,
    private readonly budget: ItineraryBudgetService,
    private readonly loops: LoopQualityService,
    private readonly visitTime: VisitTimeService,
    private readonly scorer: ItineraryScoreService,
    /** Optional for legacy unit harnesses that predate the v2 pipeline;
     *  production DI always provides it. When absent the guard is skipped. */
    private readonly localityGuard?: LocalityGuardService,
    private readonly diagnosticsLogger?: SelectionDiagnosticsLogger,
    private readonly evaluator?: RouteCostEvaluatorService,
    private readonly search?: OptimizerSearchService,
    private readonly graphVersionProvider?: GraphVersionProvider,
    private readonly qualityGate: ItineraryQualityGateService = new ItineraryQualityGateService(loops),
  ) {
    this.policyVersion = (process.env.NV_AUTO_POLICY === 'v2' ? 'v2' : 'v1') as 'v1' | 'v2';
  }

  async optimize(state: ItineraryDraftState, input: AutoFillInput = {}): Promise<{ state: ItineraryDraftState; alternatives: AutoAlternative[] }> {
    if (this.policyVersion === 'v2') return this.optimizeV2(state, input);
    return this.optimizeV1(state, input);
  }

  /** V1 path: the original quota→project→cluster→grow pipeline (unchanged fallback). */
  private async optimizeV1(state: ItineraryDraftState, input: AutoFillInput = {}): Promise<{ state: ItineraryDraftState; alternatives: AutoAlternative[] }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Automatic planning deadline exceeded')), Math.max(500, Math.min(input.deadlineMs ?? 12_000, 20_000)));
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    const preset = input.preset ?? state.preset;
    const budgetMinutes = state.budgetMinutes;
    if (state.budgetMode === 'unlimited' || budgetMinutes == null) {
      throw new BadRequestException('Automatic selection requires a time budget. Set a budget before choosing POIs automatically.');
    }
    try {
      this.throwIfAborted(signal);
      const preferred = [...new Set((input.preferredCategories ?? input.categories ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean))];
      const invalid = preferred.filter((category) => !AUTO_CATEGORIES.has(category));
      if (invalid.length) throw new BadRequestException(`Unknown automatic-selection categories: ${invalid.join(', ')}`);
      const iso = await this.awaitAbortable(this.routing.isochrone(state.start, state.profile, budgetMinutes, signal), signal);
      this.throwIfAborted(signal);
      if (!iso.geojson) throw new BadRequestException('Isochrone did not return a reachable polygon');
      // Preferences rank candidates; they never make a reachable area appear empty
      // or pull a short route to a distant singleton solely to cover a category.
      const result = await this.awaitAbortable(this.pois.listCoveredByPolygon(iso.geojson, { limit: 500, sort: 'popularity' }), signal);
      this.throwIfAborted(signal);
      const rows = result.items.filter((poi) => this.inside(poi, iso.geojson) && poi.lat != null && poi.lon != null);
      if (!rows.length) throw new BadRequestException('В радиусе достигаемости нет интересных мест. Увеличьте время или выберите другую точку старта.');
      const preserved = state.places.filter((place) => place.source === 'manual' || place.locked);
      if (preserved.length) {
        const lockedRoute = await this.route(preserved, state, signal);
        const totals = lockedRoute && this.budget.calculate({ travelMinutes: lockedRoute.duration / 60, places: preserved, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
        if (!lockedRoute || !totals?.feasible) throw new LockedSetOverBudgetError('The preserved locked/manual Places do not fit the hard budget');
      }
      const known = new Set(preserved.flatMap((place) => place.pois.map((poi) => poi.id)));
      const projected = this.quota(rows.filter((poi) => !known.has(poi.id)), preferred, state.start, preset).map((poi) => this.project(poi));
      const mode: VisitMode = state.stopPace === 'pass_by' ? 'pass_by' : state.stopPace === 'quick' ? 'glance' : 'visit';
      const clustered = (await this.awaitAbortable(this.clustering.cluster(projected, state.profile), signal)).map((place) =>
        this.visitTime.apply({ ...place, source: 'auto' as const, visitMode: mode }, state.profile),
      );
      this.throwIfAborted(signal);
      if (!clustered.length && !preserved.length) throw new BadRequestException('В зоне достигаемости мало подходящих мест. Увеличьте время или выберите другую точку старта.');
      const evaluated: Evaluated[] = [];
      for (const places of this.variants(clustered, state.start, input.seed ?? 1, preset)) {
        this.throwIfAborted(signal);
        const candidate = await this.grow(preserved, places, state, preset, preferred, signal);
        if (candidate) evaluated.push(candidate);
      }
      if (!evaluated.length) throw new BadRequestException('Не удалось собрать маршрут в пределах бюджета — точки слишком далеко друг от друга. Увеличьте время или уберите часть мест.');
      // Exact-route quality is ranked before the additive v1 score so a clean
      // feasible loop cannot lose to an otherwise attractive degraded route.
      evaluated.sort((a, b) => this.compareEvaluated(a, b, state, preferred, preset));
      const best = evaluated[0];
      const buildSummary = (places: RoutePlace[], route: RouteResult): import('./itinerary.types').SelectionSummary => {
        const uniquePois = places.reduce((sum, place) => sum + place.pois.filter((p) => p.included).length, 0);
        const totals = this.budget.calculate({ travelMinutes: route.duration / 60, places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
        return {
          candidateClusters: clustered.length,
          selectedPlaces: places.length,
          selectedUniquePois: uniquePois,
          // The exact route is network-confirmed in quality; this separate
          // summary signal remains approximate because v1 used no directed
          // network costs to qualify the candidate pool.
          localityGuardApplied: false,
          unusedBudgetIntentional: false,
          networkConfidence: 'approximate_isochrone',
          maxAutomaticExcursionMinutes: null,
        };
      };
      const bestSummary = buildSummary(best.places, best.route);
      const alternatives = evaluated.slice(1).filter((item) => this.dissimilar(best, item)).slice(0, 2).map((item, index) => {
        const previewTotals = this.totalsFor(item.places, item.route, state);
        return {
          alternativeId: `auto-${index + 1}`,
          explanation: item.explanation,
          scoreBreakdown: item.score,
          places: item.places,
          previewTotals,
          selectionSummary: buildSummary(item.places, item.route),
          quality: this.assessQuality(item.places, item.route, previewTotals, state),
        };
      });
      const totals = this.totalsFor(best.places, best.route, state);
      const quality = this.assessQuality(best.places, best.route, totals, state);
      return { state: { ...state, preset, places: best.places, route: best.route, status: 'ready', totals, warnings: this.qualityWarnings(quality), suggestions: [], quality, scoreBreakdown: best.score, autoFillSummary: bestSummary, alternatives }, alternatives };
    } finally { clearTimeout(timeout); }
  }

  /**
   * V2 path: bounded cluster-before-quota + locality guard + lexicographic selection.
   *
   * Key differences from v1:
   * - Clustering happens BEFORE quota (so a Place whose value appears only
   *   after clustering is not dropped by a POI-level quota).
   * - One real OptimizationRunBudget gates every GraphHopper call.
   * - The locality guard uses confirmed directed network marginal costs.
   * - Selection uses lexicographic compare() instead of additive score.total.
   * - Final validation uses reserved budget slots.
   * - networkConfidence reflects actual network confirmation.
   */
  private async optimizeV2(state: ItineraryDraftState, input: AutoFillInput = {}): Promise<{ state: ItineraryDraftState; alternatives: AutoAlternative[] }> {
    const controller = new AbortController();
    const deadlineMs = Math.max(500, Math.min(input.deadlineMs ?? 12_000, 20_000));
    const timeout = setTimeout(() => controller.abort(new Error('Automatic planning deadline exceeded')), deadlineMs);
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    const preset = input.preset ?? state.preset;
    const budgetMinutes = state.budgetMinutes;
    if (state.budgetMode === 'unlimited' || budgetMinutes == null) {
      throw new BadRequestException('Automatic selection requires a time budget. Set a budget before choosing POIs automatically.');
    }
    // Final validation reserves enough slots for the winner + up to 2
    // alternatives (each gets an authoritative rebuild), with headroom for
    // drop-until-feasible loops inside final validation itself.
    const runBudget = new OptimizationRunBudget({ deadlineMs, maxRequests: 80, reservedFinalValidation: 5, reservedInitialCandidate: 3, maxConcurrency: 3 });
    const counters = new OptimizationRunCounters();
    // Mutable flag: set to true only when at least one real directed network
    // cost is returned by the evaluator and used by selection/locality.
    const networkConfirmed = { value: false };
    const graphVersion = await this.graphVersionProvider?.namespace();
    // Hoisted so the catch path can degrade to the confirmed initial candidate
    // (D6) instead of throwing when the deadline/request budget is exhausted.
    let bestConfirmed: Evaluated | null = null;
    let guardResult: { admissible: RoutePlace[]; excluded: RoutePlace[]; applied: boolean } = { admissible: [], excluded: [], applied: false };
    let clustered: RoutePlace[] = [];
    try {
      this.throwIfAborted(signal);
      const preferred = [...new Set((input.preferredCategories ?? input.categories ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean))];
      const invalid = preferred.filter((category) => !AUTO_CATEGORIES.has(category));
      if (invalid.length) throw new BadRequestException(`Unknown automatic-selection categories: ${invalid.join(', ')}`);

      // 1. Isochrone (coarse reachable-area filter).
      if (!runBudget.acquire()) throw new BadRequestException('Оптимизация не успела — попробуйте ещё раз.');
      counters.graphHopperRequests++;
      const iso = await this.awaitAbortable(this.routing.isochrone(state.start, state.profile, budgetMinutes, signal), signal);
      this.throwIfAborted(signal);
      if (!iso.geojson) throw new BadRequestException('Isochrone did not return a reachable polygon');
      // D5: reserve final-validation slots up front so no earlier stage
      // (guard pair-costs, greedy grow, local search) can starve the
      // authoritative rebuild that closes the run. D6 additionally reserves
      // slots for the deterministic initial candidate so probing can never
      // consume the whole run before a single feasible route is confirmed.
      runBudget.reserveFinalValidation();
      runBudget.reserveInitialCandidate();

      // 2. POIs from polygon.
      const result = await this.awaitAbortable(this.pois.listCoveredByPolygon(iso.geojson, { limit: 500, sort: 'popularity' }), signal);
      this.throwIfAborted(signal);
      const rows = result.items.filter((poi) => this.inside(poi, iso.geojson) && poi.lat != null && poi.lon != null);
      counters.isochronePois = rows.length;
      if (!rows.length) throw new BadRequestException('В радиусе достигаемости нет интересных мест. Увеличьте время или выберите другую точку старта.');

      // 3. Preserve manual/locked Places as mandatory.
      const preserved = state.places.filter((place) => place.source === 'manual' || place.locked);
      if (preserved.length) {
        const lockedRoute = await this.route(preserved, state, signal, runBudget);
        const totals = lockedRoute && this.budget.calculate({ travelMinutes: lockedRoute.duration / 60, places: preserved, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
        if (!lockedRoute || !totals?.feasible) throw new LockedSetOverBudgetError('The preserved locked/manual Places do not fit the hard budget');
      }

      // 4. CLUSTER BEFORE QUOTA with bounded budget.
      const known = new Set(preserved.flatMap((place) => place.pois.map((poi) => poi.id)));
      const candidatePois = rows.filter((poi) => !known.has(poi.id)).map((poi) => this.project(poi));
      const mode: VisitMode = state.stopPace === 'pass_by' ? 'pass_by' : state.stopPace === 'quick' ? 'glance' : 'visit';
      clustered = (await this.awaitAbortable(this.clustering.cluster(candidatePois, state.profile, undefined, { runBudget, signal, counters }), signal)).map((place) =>
        this.visitTime.apply({ ...place, source: 'auto' as const, visitMode: mode }, state.profile),
      );
      this.throwIfAborted(signal);
      counters.placesAfterClustering = clustered.length;
      if (!clustered.length && !preserved.length) throw new BadRequestException('В зоне достигаемости мало подходящих мест. Увеличьте время или выберите другую точку старта.');

      // 4b. D6: confirm a deterministic initial local solution EARLY — before
      //     any expensive locality/search probing. Mandatory anchors plus the
      //     nearest/densest local Places (geometric lower bounds only for the
      //     shortlist), then one exact GraphHopper route. This becomes the
      //     guaranteed best-confirmed candidate when the deadline or request
      //     budget hits before the search enriches the pool.
      bestConfirmed = await this.buildInitialCandidate(preserved, clustered, state, preset, preferred, signal, runBudget, counters);
      // Unused initial-candidate reservations return to the general pool.
      runBudget.releaseInitialCandidateReservation();

      // 5. LOCALITY GUARD: bounded geometric shortlist + capped directed
      //    network costs for plausible remote singletons only (D6). The guard
      //    never performs network pair-costs across the whole pool and stops
      //    issuing calls once the run budget is exhausted.
      const evaluatorCtx = { profile: state.profile, signal, runBudget, cacheStats: counters, networkConfirmed };
      const costFn = this.evaluator
        ? (a: Point, b: Point) => this.evaluator!.cost(a, b, evaluatorCtx).then((c) => c ? c.seconds : null)
        : undefined;
      const guardResultInner = this.localityGuard
        ? await this.localityGuard.guard(clustered, state.start, costFn, { runBudget, profileSpeedMs: this.profileSpeedMs(state.profile) })
        : { admissible: clustered, excluded: [], applied: false };
      guardResult = guardResultInner;
      if (guardResultInner.applied) {
        for (const excluded of guardResultInner.excluded) counters.recordExclusion('isolated_automatic_singleton');
      }
      const admissible = guardResultInner.admissible;

      // 6. Place-level quota (compactness + diversity).
      const quotaed = this.quotaPlaces(admissible, preferred, state.start, preset);

      // 7. Build topology-aware variants and grow each with bounded search.
      //    The confirmed initial candidate is seeded into the evaluated pool so
      //    optional enrichment can improve on it but can never lose it.
      //    A bounded ARCHIVE additionally keeps the feasible grow-step
      //    candidates (and each variant's pre-convergence greedy result) that
      //    local search would otherwise converge away from — they are the raw
      //    material for materially different alternatives on a rich pool.
      const variantLists = this.topologyVariants(quotaed, state.start, input.seed ?? 1, state.loop, preset);
      const evaluated: Evaluated[] = [];
      const archive: Evaluated[] = [];
      if (bestConfirmed) evaluated.push(bestConfirmed);
      for (const places of variantLists) {
        if (signal.aborted || runBudget.isExhausted()) {
          counters.deadlineExceeded ||= signal.aborted || runBudget.wasDeadlineExceeded();
          break;
        }
        this.throwIfAborted(signal);
        const candidate = await this.growWithSearch(preserved, places, state, preset, preferred, signal, runBudget, counters, networkConfirmed, archive);
        if (candidate) evaluated.push(candidate);
      }
      if (!evaluated.length) throw new BadRequestException('Не удалось собрать маршрут в пределах бюджета — точки слишком далеко друг от друга. Увеличьте время или уберите часть мест.');
      evaluated.sort((a, b) => this.compareEvaluated(a, b, state, preferred, preset));

      // 9. FINAL VALIDATION with reserved budget. The winner is ALWAYS rebuilt
      //     authoritatively (never trusted from the search phase), then the
      //     least-useful unlocked automatic Places are dropped if the fresh
      //     rebuild is over budget. Alternatives are final-validated or omitted.
      const best = await this.finalValidation(evaluated[0], state, preset, preferred, signal, runBudget, counters, true);
      if (!best) throw new LockedSetOverBudgetError('The preserved locked/manual Places do not fit the hard budget');

      // 10. Build SelectionSummary with real locality/confidence state.
      const bestSummary = this.buildSelectionSummary(best.places, best.route, state, budgetMinutes, clustered, guardResult, iso.approximate, networkConfirmed.value);
      // Alternatives are best-effort: final-validate each candidate or omit it.
      //
      // Candidate sources, in priority order:
      //  1. the bounded pre-convergence archive (feasible grow-step / greedy
      //     candidates from each variant, captured before local search
      //     converged them all onto the same Place set);
      //  2. deterministic families derived from the CONFIRMED primary: a
      //     compact densest subset and a local/category mix that swaps the
      //     least-dense winner Places for dense pool Places from other
      //     sectors — so even a request-budget-starved run (cold cache) still
      //     yields at least two reserved-slot-validated alternatives.
      //
      // Every alternative is final-validated authoritatively (its OWN ordered
      // Places, exact GraphHopper geometry, exact preview totals and a factual
      // Russian label). The dissimilar gate compares the actually confirmed
      // Place sets (Jaccard) / corridors; no unverified claims are made.
      const alternatives: AutoAlternative[] = [];
      const accepted: Evaluated[] = [];
      // Derived families are built from the GUARDED pool (admissible), not the
      // post-quota pool: the quota's per-sector/per-category caps can consume
      // every local Place into the winner and leave no eligible replacement in
      // `quotaed` even when the guarded pool still has local Places outside the
      // winner set (the live balanced rich-pool failure). They are validated
      // FIRST because they are constructed to be pairwise materially different
      // from the winner and from each other (Jaccard < 0.8 by construction); a
      // single pre-convergence archive candidate can otherwise crowd out both
      // derived alternatives before the second slot is filled. Archive
      // candidates still fill in when a derived candidate fails exact
      // validation.
      // Derived lists have no route until finalValidation; their inherited
      // verdict is used only for pre-routing pool ordering, never published.
      const derived = this.deriveAlternativePlaceLists(best, admissible, state)
        .map((places) => ({ places, route: best.route, score: best.score, quality: best.quality, explanation: '' }));
      const derivedSet = new Set(derived);
      const alternativePool = [...derived, ...archive];
      alternativePool.sort((a, b) =>
        (derivedSet.has(b) ? 1 : 0) - (derivedSet.has(a) ? 1 : 0)
        || this.compareEvaluated(a, b, state, preferred, preset));
      for (const item of alternativePool) {
        if (alternatives.length >= 2) break;
        if (signal.aborted) { counters.deadlineExceeded = true; break; }
        // General-slot exhaustion must NOT end the alternatives phase while
        // reserved final-validation slots remain: every alternative's exact
        // rebuild is a reserved-first-then-general call. Only stop when the
        // deadline passed AND nothing reserved is left to spend.
        if (runBudget.isExhausted() && !runBudget.hasReservedFinalValidation()) {
          counters.deadlineExceeded ||= runBudget.wasDeadlineExceeded();
          break;
        }
        this.throwIfAborted(signal);
        // Alternatives are final validation too: reserved-first-then-general
        // slots, so the search phase can never starve their authoritative
        // rebuild either. Unconfirmable candidates are omitted.
        const validated = await this.finalValidation(item, state, preset, preferred, signal, runBudget, counters, true);
        if (!validated) continue; // omitted: could not be authoritatively confirmed
        if (validated.places.length < 2) continue;
        if (!this.dissimilar(best, validated)) continue;
        // Pairwise material difference: each returned alternative must also
        // differ from every already-accepted alternative.
        if (accepted.some((other) => !this.dissimilar(other, validated))) continue;
        const label = this.variantLabel(validated, best);
        accepted.push(validated);
        const previewTotals = this.totalsFor(validated.places, validated.route, state);
        alternatives.push({
          alternativeId: `auto-${alternatives.length + 1}`,
          explanation: label,
          scoreBreakdown: validated.score,
          places: validated.places,
          previewTotals,
          selectionSummary: this.buildSelectionSummary(validated.places, validated.route, state, budgetMinutes, clustered, guardResult, iso.approximate, networkConfirmed.value),
          quality: this.assessQuality(validated.places, validated.route, previewTotals, state),
        });
      }
      counters.alternativesReturned = alternatives.length;

      // 11. Log aggregate diagnostics (no PII) — success path.
      counters.graphHopperRequests = runBudget.usedRequestCount;
      const payload = SelectionDiagnosticsLogger.buildPayload(counters, {
        selectedUniquePois: bestSummary.selectedUniquePois,
        selectedPlaces: bestSummary.selectedPlaces,
        maxAutomaticExcursionMinutes: bestSummary.maxAutomaticExcursionMinutes,
        graphVersion,
        modelVersion: 'nv-routing-v1',
      });
      this.diagnosticsLogger?.log(payload);

      const totals = this.totalsFor(best.places, best.route, state);
      const quality = this.assessQuality(best.places, best.route, totals, state);
      return {
        state: {
          ...state, preset, places: best.places, route: best.route, status: 'ready',
          totals, warnings: this.qualityWarnings(quality), suggestions: [], quality,
          scoreBreakdown: best.score, autoFillSummary: bestSummary, alternatives,
        },
        alternatives,
      };
    } catch (error) {
      // D6: on deadline/request exhaustion, if a deterministic initial
      // candidate was already confirmed BEFORE the probing stages, return it as
      // the best-confirmed feasible route instead of erroring. Still error when
      // no candidate could actually be routed.
      if (bestConfirmed && (signal.aborted || runBudget.isExhausted())) {
        counters.deadlineExceeded = true;
        counters.returnedBestConfirmed = true;
        counters.graphHopperRequests = runBudget.usedRequestCount;
        const summary = this.buildSelectionSummary(bestConfirmed.places, bestConfirmed.route, state, budgetMinutes, clustered, guardResult, false, false);
        const payload = SelectionDiagnosticsLogger.buildPayload(counters, {
          selectedUniquePois: summary.selectedUniquePois,
          selectedPlaces: summary.selectedPlaces,
          maxAutomaticExcursionMinutes: summary.maxAutomaticExcursionMinutes,
          graphVersion,
          modelVersion: 'nv-routing-v1',
        });
        this.diagnosticsLogger?.log(payload);
        const totals = this.totalsFor(bestConfirmed.places, bestConfirmed.route, state);
        const quality = this.assessQuality(bestConfirmed.places, bestConfirmed.route, totals, state);
        return {
          state: {
            ...state, preset, places: bestConfirmed.places, route: bestConfirmed.route, status: 'ready',
            totals, warnings: this.qualityWarnings(quality), suggestions: [], quality,
            scoreBreakdown: bestConfirmed.score, autoFillSummary: summary, alternatives: [],
          },
          alternatives: [],
        };
      }
      // Log degraded/error diagnostics.
      counters.deadlineExceeded ||= signal.aborted;
      counters.graphHopperRequests = runBudget.usedRequestCount;
      const payload = SelectionDiagnosticsLogger.buildPayload(counters, {
        selectedUniquePois: 0, selectedPlaces: 0, maxAutomaticExcursionMinutes: null,
      });
      this.diagnosticsLogger?.log(payload);
      if (signal?.aborted) { counters.deadlineExceeded = true; }
      throw error;
    } finally { clearTimeout(timeout); }
  }

  /** Final validation: ALWAYS rebuild the candidate authoritatively using a
   *  reserved slot — even when the search candidate looked feasible — and
   *  recompute totals. If the fresh rebuild is over the finite budget, drop the
   *  least-useful unlocked automatic Place and rebuild until feasible or no
   *  automatic Place remains. Returns null when the authoritative rebuild is
   *  unavailable/infeasible (winner => LockedSetOverBudgetError, alternatives
   *  are omitted). */
  private async finalValidation(candidate: Evaluated, state: ItineraryDraftState, preset: ItineraryDraftState['preset'], preferred: string[], signal: AbortSignal, runBudget: OptimizationRunBudget, counters: OptimizationRunCounters, useReserved = true): Promise<Evaluated | null> {
    let places = [...candidate.places];
    // ALWAYS rebuild: the search-phase route is a proposal, not a contract.
    let route = await this.route(places, state, signal, runBudget, useReserved);
    if (!route) return null;
    counters.finalValidationRebuilds++;
    let totals = this.budget.calculate({ travelMinutes: route.duration / 60, places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });

    while (!totals.feasible) {
      this.throwIfAborted(signal);
      const droppable = places.filter((p) => p.source !== 'manual' && !p.locked);
      if (droppable.length === 0) break; // locked-set over budget
      // Drop the least-useful (fewest unique POIs).
      droppable.sort((a, b) => a.pois.length - b.pois.length);
      places = places.filter((p) => p.id !== droppable[0].id);
      // Rebuild consumes a reserved slot (never the general search pool).
      const rebuilt = await this.route(places, state, signal, runBudget, useReserved);
      if (!rebuilt) return null;
      route = rebuilt;
      counters.finalValidationRebuilds++;
      totals = this.budget.calculate({ travelMinutes: route.duration / 60, places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
    }

    if (!totals.feasible) return null;
    return this.scored(places, route, state, preset, preferred);
  }

  /**
   * D6: deterministic initial local solution, confirmed BEFORE any expensive
   * locality/search probing.
   *
   * Shortlist = mandatory anchors (manual/locked) + nearest/densest automatic
   * Places ranked by a geometric lower bound only (no network costs). The
   * shortlist is then routed EXACTLY through GraphHopper using reserved
   * initial-candidate budget slots; least-useful automatic Places are dropped
   * and re-routed until the route fits the hard budget. Returns null only when
   * no feasible candidate can be routed at all (the run then falls through to
   * the normal guard/grow pipeline and errors only if that also finds nothing).
   */
  private async buildInitialCandidate(fixed: RoutePlace[], pool: RoutePlace[], state: ItineraryDraftState, preset: ItineraryDraftState['preset'], preferred: string[], signal: AbortSignal, runBudget: OptimizationRunBudget, counters: OptimizationRunCounters): Promise<Evaluated | null> {
    const start = state.start;
    const preferredSet = new Set(preferred);
    // Geometric lower-bound ranking only: closeness dominates, then density and
    // category preference break ties. Never spends network budget on the
    // shortlist itself.
    const shortlist = [...fixed];
    const autoRanked = [...pool]
      .map((place) => {
        const distKm = this.distanceMeters(start, place.center) / 1000;
        const preference = place.pois.some((p) => preferredSet.has(p.category)) ? 1 : 0;
        const density = Math.min(3, place.pois.length);
        return { place, key: distKm * 1.5 - density - preference };
      })
      .sort((a, b) => a.key - b.key || a.place.id.localeCompare(b.place.id));
    for (const { place } of autoRanked) {
      if (shortlist.length - fixed.length >= 8) break;
      if (!shortlist.some((p) => p.id === place.id)) shortlist.push(place);
    }
    if (shortlist.length === 0) return null;

    // Geographic ordering: the shortlist above is distance-ranked (closeness
    // first), which produces the reported zigzag when several Places sit at
    // similar distances around the start. Reorder it by nearest-neighbor
    // (geometric, free, no network budget) BEFORE the exact route so the
    // confirmed initial candidate visits Places in a smooth geographic sweep.
    // Manual/locked anchors keep their relative order.
    let places: RoutePlace[] = shortlist;
    if (this.evaluator && this.search) {
      const nnCtx: SearchContext = {
        evaluator: {
          cost: async () => null,
          insertionDelta: async () => null,
          haversineLowerBound: (a: Point, b: Point) => this.evaluator!.haversineLowerBound(a, b),
        },
        routeBuilder: async () => null,
        budgetSeconds: 0,
        loop: state.loop,
        finish: state.finish,
        start,
        profile: state.profile,
      };
      places = this.search.nearestNeighborOrder(start, shortlist, nnCtx);
    }

    let route = await this.route(places, state, signal, runBudget, 'initial');
    if (!route) return null;
    let totals = this.budget.calculate({ travelMinutes: route.duration / 60, places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
    while (!totals.feasible) {
      const droppable = places.filter((p) => p.source !== 'manual' && !p.locked);
      if (droppable.length === 0) return null; // locked-set over budget (already rejected earlier)
      // Drop the least-useful (fewest unique POIs), deterministic on ties.
      droppable.sort((a, b) => a.pois.length - b.pois.length || a.id.localeCompare(b.id));
      places = places.filter((p) => p.id !== droppable[0].id);
      const rebuilt = await this.route(places, state, signal, runBudget, 'initial');
      if (!rebuilt) return null;
      route = rebuilt;
      totals = this.budget.calculate({ travelMinutes: route.duration / 60, places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
    }
    if (places.length === 0 || !totals.feasible) return null;
    return this.scored(places, route, state, preset, preferred);
  }

  /** Display-safe SelectionSummary for a confirmed winner (or the degraded
   *  best-confirmed candidate). `forcedConfidence` overrides the computed
   *  confidence for degraded best-confirmed returns (D6). */
  private buildSelectionSummary(places: RoutePlace[], route: RouteResult, state: ItineraryDraftState, budgetMinutes: number, clustered: RoutePlace[], guardResult: { applied: boolean }, isoApproximate: boolean, networkConfirmed: boolean, forcedConfidence?: SelectionSummary['networkConfidence']): SelectionSummary {
    const uniquePois = places.reduce((sum, place) => sum + place.pois.filter((p) => p.included).length, 0);
    const totals = this.budget.calculate({ travelMinutes: route.duration / 60, places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
    const autoPlaces = places.filter((p) => p.source === 'auto');
    const maxAutoTime = autoPlaces.length > 0
      ? Math.max(...autoPlaces.map((p) => 2 * this.distanceMeters(state.start, p.center) / this.profileSpeedMs(state.profile))) / 60
      : null;
    return {
      candidateClusters: clustered.length,
      selectedPlaces: places.length,
      selectedUniquePois: uniquePois,
      localityGuardApplied: guardResult.applied,
      unusedBudgetIntentional: totals.feasible && totals.remainingMinutes != null && totals.remainingMinutes > budgetMinutes * 0.1,
      networkConfidence: forcedConfidence ?? (isoApproximate ? 'approximate_isochrone' : networkConfirmed ? 'verified' : 'best_confirmed'),
      maxAutomaticExcursionMinutes: maxAutoTime != null ? Math.round(maxAutoTime) : null,
    };
  }

  /** Grow with bounded local search (add → swap → relocate → 2-opt).
   *  Shares the run budget: every route rebuild consumes a slot, and the search
   *  phase additionally caps its own builds so it can never starve the reserved
   *  final rebuild. Manual/locked Places stay fixed throughout.
   *  `archive` (optional) collects a bounded set of feasible grow-step
   *  candidates BEFORE local search converges them onto the same Place set;
   *  the alternatives phase uses them as materially different candidates. */
  private async growWithSearch(fixed: RoutePlace[], pool: RoutePlace[], state: ItineraryDraftState, preset: ItineraryDraftState['preset'], preferred: string[], signal: AbortSignal, runBudget: OptimizationRunBudget, counters: OptimizationRunCounters, networkConfirmed: { value: boolean }, archive?: Evaluated[]): Promise<Evaluated | null> {
    const budgetMinutes = state.budgetMinutes!;
    const tryFeasible = async (candidate: RoutePlace[]): Promise<Evaluated | null> => {
      if (runBudget.isExhausted()) return null;
      const route = await this.route(candidate, state, signal, runBudget);
      if (!route) return null;
      const totals = this.budget.calculate({ travelMinutes: route.duration / 60, places: candidate, budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
      if (!totals.feasible) return null;
      return this.scored(candidate, route, state, preset, preferred);
    };

    // Add phase: bounded greedy grow (same as v1 but budget-gated), over a
    // pool that is FIRST ordered by geometric nearest-neighbor so the tour
    // grows as a smooth geographic sweep instead of in compactness-rank order
    // (the source of the reported zigzag). Each feasible intermediate step is
    // archived BEFORE the local-search convergence that would otherwise
    // collapse all variants onto one Place set — these pre-convergence
    // candidates are the raw alternatives.
    // The search context is built up front: NN ordering and the bounded local
    // search share it, and routeBuilder's build counter only ticks during the
    // local-search phase (the add phase routes through this.route directly).
    const evaluatorCtx = { profile: state.profile, signal, runBudget, cacheStats: counters, networkConfirmed };
    let searchBuilds = 0;
    const maxSearchBuilds = 40;
    const routeBuilder = async (places: RoutePlace[], loop: boolean, finish?: Point): Promise<RouteResult | null> => {
      if (searchBuilds >= maxSearchBuilds) return null;
      const lease = await runBudget.acquireLease();
      if (!lease) return null;
      searchBuilds++;
      counters.searchIterations++;
      this.throwIfAborted(signal);
      const waypoints = places.map((place) => place.accessPoint ?? place.center);
      if (!loop && finish) waypoints.push(finish);
      if (!waypoints.length) return null;
      try {
        const plan = await this.routing.plan({ start: state.start, waypoints, profile: state.profile, options: { loop, optimize: false } }, signal);
        this.throwIfAborted(signal);
        return plan.routes[0] ?? null;
      } catch (error) {
        if (signal.aborted) throw error;
        return null;
      } finally {
        lease.release();
      }
    };
    const ctx: SearchContext = {
      evaluator: {
        cost: (a: Point, b: Point) => this.evaluator!.cost(a, b, evaluatorCtx),
        insertionDelta: (i: Point, p: Point, j: Point) => this.evaluator!.insertionDelta(i, p, j, evaluatorCtx),
        haversineLowerBound: (a: Point, b: Point) => this.evaluator!.haversineLowerBound(a, b),
      },
      routeBuilder,
      budgetSeconds: budgetMinutes * 60,
      loop: state.loop,
      finish: state.finish,
      start: state.start,
      profile: state.profile,
      maxIterations: 4,
      isBetter: async (candidate, candidateRoute, current, currentRoute) => {
        const candidateEvaluated = this.scored(candidate, candidateRoute, state, preset, preferred);
        const currentEvaluated = this.scored(current, currentRoute, state, preset, preferred);
        return this.compareEvaluated(candidateEvaluated, currentEvaluated, state, preferred, preset) < 0;
      },
    };
    const orderedPool = this.search ? this.search.nearestNeighborOrder(state.start, pool, ctx) : pool;
    let selected = [...fixed];
    let best: Evaluated | null = null;
    for (const place of orderedPool.slice(0, preset === 'more_places' ? 12 : 8)) {
      if (runBudget.isExhausted()) break;
      const next = [...selected, place];
      const evaluated = await tryFeasible(next);
      if (!evaluated) continue;
      selected = next;
      this.archiveCandidate(archive, evaluated);
      if (!best || this.compareEvaluated(evaluated, best, state, preferred, preset) < 0) best = evaluated;
    }
    if (!best && fixed.length) {
      const evaluated = await tryFeasible(fixed);
      if (evaluated) best = evaluated;
    }
    if (!best || !this.evaluator || !this.search) return best;

    // Local search phase: bounded 2-opt/or-opt/swap/relocate over the FULL
    // quota pool. Ordering moves (2-opt/or-opt) are geometric-first, so the
    // bounded build budget goes to fixing the visit sequence first.
    const searched = await this.search.localSearch(best.places, pool, ctx, () => 0);
    if (searched.route) {
      const totals = this.budget.calculate({ travelMinutes: searched.route.duration / 60, places: searched.places, budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
      if (totals.feasible) {
        const improved = this.scored(searched.places, searched.route, state, preset, preferred);
        if (this.compareEvaluated(improved, best, state, preferred, preset) < 0) best = improved;
      }
    }
    return best;
  }

  /** Lexicographic comparison shared by ranking, grow and local search.
   *  Hard budget feasibility, locality and POI value remain first. Among
   *  otherwise comparable exact routes, quality precedes compactness so a
   *  confirmed route is not displaced solely by a shorter degraded one.
   *
   *  confirmed > degraded out-and-back fallback > other degraded > unconfirmed.
   *  This still returns the best feasible unavoidable out-and-back route when
   *  no clean loop exists, but it cannot beat a clean comparable route. */
  private compareEvaluated(a: Evaluated, b: Evaluated, state: ItineraryDraftState, preferred: string[], preset: ItineraryDraftState['preset']): number {
    const aTotals = this.budget.calculate({ travelMinutes: a.route.duration / 60, places: a.places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
    const bTotals = this.budget.calculate({ travelMinutes: b.route.duration / 60, places: b.places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
    return this.scorer.compare(
      { places: a.places, route: a.route, totals: aTotals, localityViolations: 0, budgetMinutes: state.budgetMinutes!, start: state.start, preferredCategories: preferred, profile: state.profile, preset, loop: state.loop, finish: state.finish, qualityRank: this.qualityRank(a.quality) },
      { places: b.places, route: b.route, totals: bTotals, localityViolations: 0, budgetMinutes: state.budgetMinutes!, start: state.start, preferredCategories: preferred, profile: state.profile, preset, loop: state.loop, finish: state.finish, qualityRank: this.qualityRank(b.quality) },
    ) || a.route.duration - b.route.duration || b.score.total - a.score.total;
  }

  private qualityRank(quality: ItineraryQuality): number {
    if (quality.verdict === 'confirmed') return 3;
    if (quality.verdict === 'degraded') {
      return quality.warnings.includes('LOOP_NOT_CLOSED') ? 1 : 2;
    }
    return 0;
  }

  /** Topology-aware variant generation (D7). */
  private topologyVariants(places: RoutePlace[], _start: { lat: number; lon: number }, seed: number, loop: boolean, preset: ItineraryDraftState['preset']): RoutePlace[][] {
    if (places.length < 2) return [places];
    const head = places.slice(0, Math.min(4, places.length));
    const tail = places.slice(head.length);
    const offset = tail.length ? Math.abs(seed) % tail.length : 0;
    const rotatedTail = tail.length ? [...tail.slice(offset), ...tail.slice(0, offset)] : [];
    const alternate = [...head, ...rotatedTail];
    // For loops, reversal explores the opposite direction around the ring.
    const reversed = [...places].reverse();
    // For more_places, keep more pool entries for the greedy insertion.
    if (preset === 'more_places') return [places, alternate, reversed];
    return [places, alternate, reversed];
  }

  /** Human-readable variant label (D7). Only claims differences that were
   *  actually evaluated: fewer Places (compact subset), more POIs, lower
   *  confirmed road overlap, or a plain set/category description. Never claims
   *  scenicness without evidence. */
  private variantLabel(item: Evaluated, best: Evaluated): string {
    const cats = new Set(item.places.flatMap((place) => place.pois.map((poi) => poi.category)));
    const itemPoiCount = item.places.reduce((s, p) => s + p.pois.length, 0);
    const bestPoiCount = best.places.reduce((s, p) => s + p.pois.length, 0);
    const bestIds = new Set(best.places.map((p) => p.id));
    const common = item.places.filter((p) => bestIds.has(p.id)).length;
    // Compact subset: every Place belongs to the winner, but there are fewer
    // of them — a factual shorter/compact alternative.
    if (item.places.length < best.places.length && common === item.places.length) {
      return `Компактный маршрут: ${item.places.length} мест, ${itemPoiCount} объектов — ${Math.ceil(item.route.duration / 60)} мин дороги вместо ${Math.ceil(best.route.duration / 60)}`;
    }
    // Local/category mix: >=2 winner Places replaced by Places outside the
    // winner set — a factual set-level difference (exact-routed before label).
    const replacedCount = best.places.filter((p) => !item.places.some((x) => x.id === p.id)).length;
    if (replacedCount >= 2) {
      return `Другой состав: ${item.places.length} мест, ${itemPoiCount} объектов — вместо ${replacedCount} мест основного маршрута добавлены новые`;
    }
    if (itemPoiCount > bestPoiCount) return `Больше мест рядом (${itemPoiCount} объектов)`;
    const itemOverlap = this.loops.assess(item.route.geojson.geometry?.coordinates ?? []).repeatedRoadRatio;
    const bestOverlap = this.loops.assess(best.route.geojson.geometry?.coordinates ?? []).repeatedRoadRatio;
    if (itemOverlap < bestOverlap) return 'Меньше повторов дорог';
    return `${item.places.length} мест, ${cats.size} категорий`;
  }

  /** Place-level quota (v2): cap per-category and per-sector over Places, not POI rows. */
  private quotaPlaces(places: RoutePlace[], preferred: string[], start: { lat: number; lon: number }, preset: ItineraryDraftState['preset']): RoutePlace[] {
    const preferredSet = new Set(preferred);
    const perCategory = new Map<string, number>();
    const perSector = new Map<number, number>();
    const maxPlaces = preset === 'more_places' ? 32 : 24;
    // Compactness: prefer Places with more POIs and closer to start, weighted by category preference.
    const scored = places.map((place) => {
      const neighbors = places.filter((other) => other.id !== place.id && this.distanceMeters(place.center, other.center) <= 800).length;
      const distanceKm = this.distanceMeters(start, place.center) / 1000;
      const preference = place.pois.some((p) => preferredSet.has(p.category)) ? 2 : 0;
      const featured = place.pois.some((p) => (p as any).featured) ? 1 : 0;
      return { place, score: preference + Math.min(3, neighbors) * 1.5 + featured + place.pois.length - Math.min(4, distanceKm) * .75 };
    }).sort((a, b) => b.score - a.score || a.place.id.localeCompare(b.place.id));
    const selected: RoutePlace[] = [];
    for (const { place } of scored) {
      const sector = this.sector(place.center, start);
      const cats = new Set(place.pois.map((p) => p.category));
      const catCount = Math.max(...[...cats].map((c) => perCategory.get(c) ?? 0));
      if (catCount >= 3 || (perSector.get(sector) ?? 0) >= 3) continue;
      cats.forEach((c) => perCategory.set(c, (perCategory.get(c) ?? 0) + 1));
      perSector.set(sector, (perSector.get(sector) ?? 0) + 1);
      selected.push(place);
      if (selected.length >= maxPlaces) break;
    }
    return selected;
  }

  private profileSpeedMs(profile: ItineraryDraftState['profile']): number {
    switch (profile) { case 'foot': case 'foot_scenic': return 1.4; case 'mtb': case 'mtb_leisure': return 4; case 'bike': case 'bike_touring': return 4.5; default: return 11; }
  }
  private async grow(fixed: RoutePlace[], pool: RoutePlace[], state: ItineraryDraftState, preset: ItineraryDraftState['preset'], preferred: string[], signal: AbortSignal): Promise<Evaluated | null> {
    let selected = [...fixed]; let best: Evaluated | null = null;
    for (const place of pool.slice(0, preset === 'more_places' ? 12 : 8)) {
      const next = [...selected, place]; const route = await this.route(next, state, signal); if (!route) continue;
      const totals = this.budget.calculate({ travelMinutes: route.duration / 60, places: next, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
      if (!totals.feasible) continue;
      selected = next;
      const scored = this.scored(selected, route, state, preset, preferred);
      if (!best || this.compareEvaluated(scored, best, state, preferred, preset) < 0) best = scored;
    }
    if (!best && fixed.length) { const route = await this.route(fixed, state, signal); if (route) { const totals = this.budget.calculate({ travelMinutes: route.duration / 60, places: fixed, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes }); if (totals.feasible) best = this.scored(fixed, route, state, preset, preferred); } }
    return best;
  }
  private totalsFor(places: RoutePlace[], route: RouteResult, state: ItineraryDraftState): import('./itinerary.types').ItineraryTotals {
    return this.budget.calculate({
      travelMinutes: route.duration / 60,
      places,
      budgetMinutes: state.budgetMinutes,
      budgetMode: state.budgetMode,
      reserveMinutes: state.reserveMinutes,
    });
  }

  /** All auto winner/alternative warnings originate from the same exact-route gate. */
  private assessQuality(places: RoutePlace[], route: RouteResult, totals: import('./itinerary.types').ItineraryTotals, state: ItineraryDraftState): ItineraryQuality {
    // This flag describes the route response itself. SelectionSummary's
    // networkConfidence separately describes directed costs used by selection.
    return this.qualityGate.assess({ route, totals, requestedLoop: state.loop, places, networkConfirmed: true });
  }

  private qualityWarnings(quality: ItineraryQuality): import('./itinerary.types').ItineraryWarning[] {
    return quality.warnings.map((code) => ({ code, message: itineraryQualityWarningMessage(code) }));
  }

  private async route(places: RoutePlace[], state: ItineraryDraftState, signal: AbortSignal, runBudget?: OptimizationRunBudget, useReserved: boolean | 'initial' = false): Promise<RouteResult | null> {
    this.throwIfAborted(signal);
    // D5: every GraphHopper call consumes a slot from the shared run budget
    // (concurrency+request lease). Cache hits bypass this entirely; this is a
    // real routing call. Reserved-first-then-general lets the winner's final
    // validation keep rebuilding even after drop loops exceed the reservation;
    // the 'initial' mode uses the initial-candidate reservation so the
    // deterministic first solution can never be starved by locality/search
    // probing.
    let lease: import('./optimization-run-budget').RunLease | null = null;
    if (runBudget) {
      lease = useReserved === 'initial'
        ? (await runBudget.acquireReservedInitialLease()) ?? (await runBudget.acquireLease())
        : useReserved
          ? (await runBudget.acquireReservedLease()) ?? (await runBudget.acquireLease())
          : await runBudget.acquireLease();
      if (!lease) return null;
    }
    try {
      const waypoints = places.map((place) => place.accessPoint ?? place.center);
      if (!state.loop && state.finish) waypoints.push(state.finish);
      if (!waypoints.length) return null;
      const plan = await this.routing.plan({ start: state.start, waypoints, profile: state.profile, options: { loop: state.loop, optimize: false } }, signal);
      this.throwIfAborted(signal);
      return plan.routes[0] ?? null;
    } catch (error) {
      if (signal.aborted) throw error;
      return null;
    } finally {
      lease?.release();
    }
  }
  private scored(places: RoutePlace[], route: RouteResult, state: ItineraryDraftState, preset: ItineraryDraftState['preset'], preferred: string[]): Evaluated {
    const { score, totals } = this.scorer.score({ places, route, start: state.start, profile: state.profile, preset, preferredCategories: preferred, budgetMinutes: state.budgetMinutes!, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes, loop: state.loop, finish: state.finish });
    const categories = new Set(places.flatMap((place) => place.pois.map((poi) => poi.category)));
    const quality = this.assessQuality(places, route, totals, state);
    return { places, route, score, quality, explanation: `${places.length} мест, ${categories.size} категорий, дорожное время ${Math.ceil(route.duration / 60)} мин, всего ${Math.ceil(totals.totalMinutes)} мин` };
  }
  private variants(places: RoutePlace[], _start: { lat: number; lon: number }, seed: number, preset: ItineraryDraftState['preset']): RoutePlace[][] {
    // `places` arrive ranked by compactness and preference. Preserve that
    // canonical route first; variants perturb only the tail for alternatives.
    if (places.length < 2) return [places];
    const head = places.slice(0, Math.min(4, places.length));
    const tail = places.slice(head.length);
    const offset = tail.length ? Math.abs(seed) % tail.length : 0;
    const rotatedTail = tail.length ? [...tail.slice(offset), ...tail.slice(0, offset)] : [];
    const alternate = [...head, ...rotatedTail];
    // A full reversal is a genuinely different loop (outbound becomes the
    // other road around the ring); the scorer already picks the variant with
    // the least road overlap, so this only ever helps.
    const reversed = [...places].reverse();
    return preset === 'training' ? [places, [...head, ...rotatedTail.reverse()], reversed] : [places, alternate, reversed];
  }
  private quota(rows: PoiRow[], preferred: string[], start: { lat: number; lon: number }, preset: ItineraryDraftState['preset']): PoiRow[] {
    const preferredSet = new Set(preferred);
    const perCategory = new Map<string, number>();
    const perSector = new Map<number, number>();
    const compactness = new Map(rows.map((row) => {
      const neighbors = rows.filter((other) => other.id !== row.id && this.distanceMeters(row, other) <= 800).length;
      const distanceKm = this.distanceMeters(start, row) / 1000;
      const preference = preferredSet.has(row.category) ? 2 : 0;
      const featured = row.featured ? 1 : 0;
      const popularity = Math.min(2, Math.max(0, row.popularityScore ?? 0) / 20);
      // Density can outweigh a distant featured singleton; distance is capped
      // so a sparse region remains usable instead of producing no route.
      return [row.id, preference + Math.min(3, neighbors) * 1.5 + featured + popularity - Math.min(4, distanceKm) * .75] as const;
    }));
    const ordered = [...rows].sort((a, b) => {
      const scoreDelta = (compactness.get(b.id) ?? 0) - (compactness.get(a.id) ?? 0);
      return scoreDelta || a.id.localeCompare(b.id);
    });
    const selected: PoiRow[] = [];
    for (const row of ordered) {
      const sector = this.sector({ lat: row.lat!, lon: row.lon! }, start);
      const categoryCount = perCategory.get(row.category) ?? 0;
      if (categoryCount >= 3 || (perSector.get(sector) ?? 0) >= 3) continue;
      selected.push(row);
      perCategory.set(row.category, categoryCount + 1);
      perSector.set(sector, (perSector.get(sector) ?? 0) + 1);
      if (selected.length >= (preset === 'more_places' ? 32 : 24)) break;
    }
    return selected;
  }
  private project(poi: PoiRow) { return projectItineraryPoi(poi); }
  private distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const radius = 6_371_000;
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
  }
  private sector(point: { lat: number; lon: number }, start: { lat: number; lon: number }): number { return Math.floor(((Math.atan2(point.lat - start.lat, point.lon - start.lon) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)); }
  /** Material-difference gate for alternatives: Jaccard index over the
   *  confirmed Place sets below 0.8, OR — for an identical Place set in a
   *  different order — a confirmed corridor overlap below 0.7 (e.g. a ring
   *  whose return path uses genuinely different roads). Near-identical subsets
   *  (Jaccard ≥ 0.8) never qualify: a 7-of-8 subset is not a materially
   *  different alternative even when the synthetic fixture reports a low
   *  straight-line corridor overlap. A compact subset qualifies via Jaccard
   *  (e.g. 6 of 8 Places ⇒ 0.75), which is what makes short/compact
   *  alternatives admissible. */
  private dissimilar(a: Evaluated, b: Evaluated): boolean {
    const common = b.places.filter((place) => a.places.some((x) => x.id === place.id)).length;
    const jaccard = common / Math.max(1, a.places.length + b.places.length - common);
    if (jaccard < 0.8) return true;
    const sameSet = common === a.places.length && common === b.places.length;
    return sameSet && this.loops.overlap(a.route.geojson.geometry?.coordinates ?? [], b.route.geojson.geometry?.coordinates ?? []) < .7;
  }

  /** Bounded pre-convergence archive (D7 alternatives): admits a feasible
   *  candidate only when it is pairwise materially different from every
   *  candidate already in the archive, so diversity survives until the
   *  alternatives phase instead of being converged away by local search. */
  private archiveCandidate(archive: Evaluated[] | undefined, candidate: Evaluated): void {
    if (!archive || candidate.places.length < 2) return;
    const signature = candidate.places.map((p) => p.id).join('|');
    if (archive.some((a) => a.places.map((p) => p.id).join('|') === signature)) return;
    for (const existing of archive) {
      if (!this.dissimilar(existing, candidate)) return;
    }
    archive.push(candidate);
    // Bound the archive deterministically: largest first, drop the tail.
    archive.sort((a, b) => b.places.length - a.places.length || a.places.map((p) => p.id).join('|').localeCompare(b.places.map((p) => p.id).join('|')));
    if (archive.length > 8) archive.pop();
  }

  /** Deterministic alternative families derived from the CONFIRMED primary
   *  (D7 alternatives). Purely geometric construction — every returned list is
   *  exact-routed by the alternatives final-validation phase, so nothing is
   *  fabricated. Family 1 is a compact densest subset (fewer Places, same
   *  local core). Family 2 swaps the least-dense winner Places for dense pool
   *  Places that add a new category or sector, staying inside the confirmed
   *  local excursion so the first exact rebuild stays feasible and locality
   *  (and every manual/locked anchor) is preserved. Family 3 (fallback) is a
   *  clearly different smaller thematic subset used when the pool has no
   *  eligible replacement Places. `pool` must be the GUARDED pool: quota caps
   *  can hide local replacement Places from the post-quota list. Returns [] on
   *  sparse pools — fewer alternatives are allowed then. */
  private deriveAlternativePlaceLists(primary: Evaluated, pool: RoutePlace[], state: ItineraryDraftState): RoutePlace[][] {
    const lists: RoutePlace[][] = [];
    const order = new Map(primary.places.map((place, index) => [place.id, index]));
    const fixed = primary.places.filter((p) => p.source === 'manual' || p.locked);
    const auto = primary.places.filter((p) => p.source !== 'manual' && !p.locked);
    if (auto.length < 3) return lists;
    const byPrimaryOrder = (ids: Set<string>): RoutePlace[] =>
      [...primary.places].filter((p) => ids.has(p.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const jaccard = (a: RoutePlace[], b: RoutePlace[]): number => {
      const bIds = new Set(b.map((p) => p.id));
      const common = a.filter((p) => bIds.has(p.id)).length;
      return common / Math.max(1, a.length + b.length - common);
    };

    // Family 1 — compact densest subset.
    const keepCount = Math.max(3, Math.ceil(auto.length * 0.7));
    let compactIds: Set<string> | null = null;
    if (keepCount < auto.length) {
      const densest = [...auto].sort((a, b) => b.pois.length - a.pois.length || a.id.localeCompare(b.id)).slice(0, keepCount);
      const compact = byPrimaryOrder(new Set([...fixed, ...densest].map((p) => p.id)));
      if (compact.length >= 2) {
        lists.push(compact);
        compactIds = new Set(compact.map((p) => p.id));
      }
    }

    // Family 2 — local/category mix with pool replacements.
    const maxExcursionM = Math.max(1, ...auto.map((p) => this.distanceMeters(state.start, p.center)));
    const winnerIds = new Set(primary.places.map((p) => p.id));
    const winnerCats = new Set(primary.places.flatMap((p) => p.pois.map((poi) => poi.category)));
    const winnerSectors = new Set(primary.places.map((p) => this.sector(p.center, state.start)));
    const replacements = pool
      .filter((p) => p.source === 'auto' && !p.locked && !winnerIds.has(p.id)
        && this.distanceMeters(state.start, p.center) <= maxExcursionM * 1.1)
      .map((p) => {
        const cats = new Set(p.pois.map((poi) => poi.category));
        const newCats = [...cats].filter((c) => !winnerCats.has(c)).length;
        const newSector = winnerSectors.has(this.sector(p.center, state.start)) ? 0 : 1;
        return { place: p, score: p.pois.length * 2 + newCats + newSector - this.distanceMeters(state.start, p.center) / maxExcursionM };
      })
      .sort((a, b) => b.score - a.score || a.place.id.localeCompare(b.place.id));
    if (replacements.length > 0) {
      // Drop enough least-dense automatic Places for the result to clear the
      // Jaccard gate (≈15%, minimum 2), then add the best replacements.
      const dropCount = Math.min(Math.max(2, Math.ceil(auto.length * 0.15)), auto.length - 2);
      const addCount = Math.min(dropCount, replacements.length);
      const dropped = new Set([...auto].sort((a, b) => a.pois.length - b.pois.length || a.id.localeCompare(b.id)).slice(0, dropCount).map((p) => p.id));
      const kept = auto.filter((p) => !dropped.has(p.id));
      const mix = [...fixed, ...byPrimaryOrder(new Set(kept.map((p) => p.id))), ...replacements.slice(0, addCount).map((r) => r.place)];
      if (mix.length >= 2) lists.push(mix);
    } else if (compactIds) {
      // Family 3 — fallback: a clearly different smaller thematic subset when
      // no eligible replacement exists. Always includes the Places OUTSIDE the
      // compact subset (so the Jaccard gate clears deterministically, even on
      // score ties), then the richest/category-diverse compact Places, so the
      // result is a genuinely different theme, not a near-copy.
      const themeSize = Math.max(3, Math.ceil(auto.length * 0.55));
      if (themeSize < auto.length) {
        const nonCompact = auto.filter((place) => !compactIds!.has(place.id));
        const fromNonCompact = Math.min(nonCompact.length, themeSize);
        const rankedCompact = auto
          .filter((place) => compactIds!.has(place.id))
          .map((place) => {
            const cats = new Set(place.pois.map((poi) => poi.category));
            return { place, score: cats.size + Math.min(3, place.pois.length) };
          })
          .sort((a, b) => b.score - a.score || a.place.id.localeCompare(b.place.id))
          .slice(0, themeSize - fromNonCompact)
          .map((entry) => entry.place);
        const themed = [...nonCompact.slice(0, fromNonCompact), ...rankedCompact];
        const subset = byPrimaryOrder(new Set([...fixed, ...themed].map((p) => p.id)));
        if (subset.length >= 2 && jaccard(subset, lists[0]) < 0.8) lists.push(subset);
      }
    }
    return lists;
  }
  private inside(poi: PoiRow, geometry: any): boolean { const rings: number[][][][] = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]; const contains = (ring: number[][]) => { let hit = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > poi.lat!) !== (yj > poi.lat!) && poi.lon! < (xj - xi) * (poi.lat! - yi) / (yj - yi) + xi) hit = !hit; } return hit; }; return rings.some((polygon) => contains(polygon[0]) && !polygon.slice(1).some(contains)); }
  private throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Automatic planning aborted'); }
  private async awaitAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    this.throwIfAborted(signal);
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Automatic planning aborted'));
      signal.addEventListener('abort', abort, { once: true });
      promise.then((value) => { signal.removeEventListener('abort', abort); resolve(value); }, (error) => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
}
