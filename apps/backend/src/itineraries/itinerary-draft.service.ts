import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PoisService } from '../pois/pois.service';
import type { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ItineraryBudgetService } from './itinerary-budget.service';
import { ItineraryCommandEntity } from './entities/itinerary-command.entity';
import { ItineraryDraftEntity } from './entities/itinerary-draft.entity';
import type { AdditionSuggestion, ItineraryDraft, ItineraryDraftState, ItineraryPoi, ItineraryWarning, Point, RoutePlace, VisitMode } from './itinerary.types';
import { PlaceClusteringService } from './place-clustering.service';
import { projectItineraryPoi, type ItineraryPoiSource } from './itinerary-poi-projection';
import { VisitTimeService } from './visit-time.service';
import { RoutesService } from '../routes/routes.service';
import { RoutingService } from '../routing/routing.service';
import type { PlanResult } from '../routing/routing.types';
import { AutoItineraryOptimizerService, LockedSetOverBudgetError } from './auto-itinerary-optimizer.service';
import { ItineraryQualityGateService, itineraryQualityWarningMessage } from './itinerary-quality-gate.service';
import { LoopQualityService } from '../routing/loop-quality.service';

type PersistedDraftState = ItineraryDraftState & { history?: ItineraryDraftState[] };

const TTL_MS = 24 * 60 * 60 * 1000;
@Injectable()
export class ItineraryDraftService {
  constructor(
    @InjectRepository(ItineraryDraftEntity) private readonly drafts: Repository<ItineraryDraftEntity>,
    @InjectRepository(ItineraryCommandEntity) private readonly commands: Repository<ItineraryCommandEntity>,
    private readonly pois: PoisService,
    private readonly budget: ItineraryBudgetService,
    private readonly visitTime: VisitTimeService,
    private readonly clustering: PlaceClusteringService,
    private readonly routes: RoutesService,
    private readonly routing: RoutingService,
    @Optional() private readonly optimizer?: AutoItineraryOptimizerService,
    private readonly qualityGate: ItineraryQualityGateService = new ItineraryQualityGateService(new LoopQualityService()),
  ) {}

  async create(ownerKey: string, input: CreateItineraryDto): Promise<ItineraryDraft> {
    const budgetMode = input.budgetMode ?? 'whole_trip';
    const budgetMinutes = budgetMode === 'unlimited' ? null : input.budgetMinutes!;
    const state = this.withTotals({
      status: 'ready', start: input.start, finish: input.finish, profile: input.profile, loop: input.loop,
      preset: input.preset ?? 'balanced', intent: input.intent ?? 'auto_budget', stopPace: input.stopPace ?? 'pass_by', budgetMode, budgetMinutes,
      reserveMinutes: Math.max(input.reserveMinutes ?? 0, this.budget.reserve(budgetMinutes)), places: [], warnings: [], suggestions: [], additions: [], replacements: [],
      selectionPolicyVersion: 'v2',
    });
    const now = new Date();
    const entity = this.drafts.create({ id: randomUUID(), version: 1, ownerKey, state: { ...state, history: [] } as PersistedDraftState, expiresAt: new Date(now.getTime() + TTL_MS) });
    const saved = await this.drafts.save(entity);
    return this.snapshot(saved);
  }

  async get(ownerKey: string, id: string): Promise<ItineraryDraft> { return this.snapshot(await this.findOwned(ownerKey, id)); }

  async addPoi(ownerKey: string, id: string, input: { poiId: string; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    // Read and cluster before the CAS transaction: network walkability never
    // holds a draft row lock. The later version check rejects stale results.
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const poi = await this.pois.byId(input.poiId);
    const child = projectItineraryPoi(poi);
    const currentState = this.withoutHistory(current.state as PersistedDraftState);
    const places = await this.rebuildManualPlaces(currentState, currentState.places.some((place) => place.pois.some((item) => item.id === child.id)) ? undefined : child);
    return this.mutate(ownerKey, id, input, (state) => { const next = this.invalidateRoute({ ...state, places }); return { ...next, suggestions: this.smartFixes(next) }; });
  }

  async removePlace(ownerKey: string, id: string, input: { placeId: string; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const currentState = this.withoutHistory(current.state as PersistedDraftState);
    if (!currentState.places.some((place) => place.id === input.placeId)) throw new NotFoundException('Place not found');
    const remaining = currentState.places.filter((place) => place.id !== input.placeId);
    // Replan through the remaining places so the route line, totals and loop
    // warning stay truthful, then surface nearby additions that fit the freed
    // budget. Mirrors the `Мимо`/setVisitMode flow so a removal never leaves
    // the user with a vanished route and no transparent next step.
    const next = remaining.length
      ? this.withTotals(await this.routeState({ ...currentState, places: remaining, suggestions: [] }))
      : this.invalidateRoute({ ...currentState, places: remaining, warnings: [] });
    const additions = await this.computeAdditions(next);
    return this.mutate(ownerKey, id, input, () => ({ ...next, additions, suggestions: this.smartFixes(next) }), { preserveAdditions: true });
  }

  async setVisitMode(ownerKey: string, id: string, input: { placeId: string; mode: VisitMode; customVisitMinutes?: number; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const currentState = this.withoutHistory(current.state as PersistedDraftState);
    if (!currentState.places.some((place) => place.id === input.placeId)) throw new NotFoundException('Place not found');
    const places = currentState.places.map((place) => place.id === input.placeId
      ? this.visitTime.apply({ ...place, visitMode: input.mode, customVisitMinutes: input.customVisitMinutes }, currentState.profile)
      : place);
    const next = this.withTotals({ ...currentState, places });
    // `Мимо` (pass_by) and shorter visits free stop budget: surface transparent
    // nearby additions the user may accept. Nothing is added without consent.
    const additions = await this.computeAdditions(next);
    return this.mutate(ownerKey, id, input, () => ({ ...next, additions, suggestions: this.smartFixes(next) }), { preserveAdditions: true });
  }

  setLocked(ownerKey: string, id: string, input: { placeId: string; locked: boolean; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    return this.mutate(ownerKey, id, input, (state) => {
      if (!state.places.some((place) => place.id === input.placeId)) throw new NotFoundException('Place not found');
      return { ...state, places: state.places.map((place) => place.id === input.placeId ? { ...place, locked: input.locked } : place) };
    });
  }

  reorder(ownerKey: string, id: string, input: { orderedPlaceIds: string[]; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    return this.mutate(ownerKey, id, input, (state) => {
      const current = state.places.map((place) => place.id).sort();
      const requested = [...input.orderedPlaceIds].sort();
      if (current.length !== requested.length || current.some((placeId, index) => placeId !== requested[index])) throw new ConflictException('orderedPlaceIds must contain each place exactly once');
      const byId = new Map(state.places.map((place) => [place.id, place]));
      return this.invalidateRoute({ ...state, places: input.orderedPlaceIds.map((placeId) => byId.get(placeId)!) });
    });
  }

  updateSettings(ownerKey: string, id: string, input: { budgetMode?: 'whole_trip' | 'travel_only' | 'unlimited'; budgetMinutes?: number; loop?: boolean; finish?: Point | null; profile?: import('../routing/routing.types').RoutingProfile; stopPace?: import('./itinerary.types').StopPace; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    return this.mutate(ownerKey, id, input, (state) => {
      if (input.budgetMode === undefined && input.budgetMinutes === undefined && input.loop === undefined && input.finish === undefined && input.profile === undefined && input.stopPace === undefined) throw new BadRequestException('At least one setting is required');
      const nextLoop = input.loop ?? state.loop;
      if (input.finish != null && nextLoop) throw new BadRequestException('finish is available only for a linear route');
      const nextFinish = nextLoop ? undefined : input.finish === undefined ? state.finish : input.finish ?? undefined;
      const finishChanged = state.finish?.lat !== nextFinish?.lat || state.finish?.lon !== nextFinish?.lon;
      const routeInputsChanged = nextLoop !== state.loop || finishChanged || (input.profile !== undefined && input.profile !== state.profile);
      const budgetMode = input.budgetMode ?? state.budgetMode;
      const budgetMinutes = budgetMode === 'unlimited' ? null : input.budgetMinutes ?? state.budgetMinutes;
      if (budgetMode !== 'unlimited' && budgetMinutes == null) throw new BadRequestException('budgetMinutes is required when budget mode is limited');
      const nextProfile = input.profile ?? state.profile;
      const next = {
        ...state,
        budgetMode,
        budgetMinutes,
        reserveMinutes: budgetMode === 'unlimited' ? 0 : state.reserveMinutes,
        loop: nextLoop,
        finish: nextFinish,
        profile: nextProfile,
        stopPace: input.stopPace ?? state.stopPace,
        places: input.profile === undefined ? state.places : state.places.map((place) => this.visitTime.apply(place, nextProfile)),
      };
      return routeInputsChanged ? this.invalidateRoute(next) : next;
    });
  }

  undo(ownerKey: string, id: string, input: { expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    return this.mutate(ownerKey, id, input, (state) => state, { undo: true });
  }

  async autoFill(ownerKey: string, id: string, input: { categories?: string[]; preferredCategories?: string[]; seed?: number; preset?: ItineraryDraftState['preset']; expectedVersion: number; commandId: string }, signal?: AbortSignal): Promise<ItineraryDraft> {
    if (!this.optimizer) throw new ServiceUnavailableException('Automatic itinerary optimizer is unavailable');
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const state = this.withoutHistory(current.state as PersistedDraftState);
    try {
      const result = await this.optimizer.optimize(state, { categories: input.categories, preferredCategories: input.preferredCategories, seed: input.seed, preset: input.preset, signal });
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Automatic planning aborted');
      // D4: recheck abort immediately before the transactional CAS update.
      // Once the DB transaction starts, the command may commit atomically.
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Automatic planning aborted');
      return this.mutate(ownerKey, id, input, () => result.state, { preserveAutoFillSummary: true, preserveQuality: true });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!(error instanceof LockedSetOverBudgetError)) throw error;
      return this.mutate(ownerKey, id, input, (latest) => ({ ...latest, status: 'ready', warnings: [{ code: 'LOCKED_SET_OVER_BUDGET', message: 'Закреплённые или вручную добавленные места не помещаются в бюджет.' }], suggestions: this.smartFixes(latest) }));
    }
  }

  /** Select a lightweight persisted alternative and rebuild its road geometry under CAS. */
  async selectAlternative(ownerKey: string, id: string, input: { alternativeId: string; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const state = this.withoutHistory(current.state as PersistedDraftState);
    const alternative = this.findAlternative(state, input.alternativeId);
    const next = await this.rebuildAlternative(state, alternative, true);
    return this.mutate(ownerKey, id, input, () => ({ ...next, suggestions: this.smartFixes(next) }), { preserveAutoFillSummary: true, preserveQuality: true });
  }

  /** Read-only exact geometry for an alternative. It intentionally never calls mutate. */
  async previewAlternative(ownerKey: string, id: string, alternativeId: string, expectedVersion: number) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new BadRequestException('expectedVersion must be a positive integer');
    const current = await this.findOwned(ownerKey, id);
    if (current.version !== expectedVersion) throw this.versionConflict(this.snapshot(current));
    const state = this.withoutHistory(current.state as PersistedDraftState);
    const alternative = this.findAlternative(state, alternativeId);
    const next = await this.rebuildAlternative(state, alternative, false);
    return { draftId: current.id, version: current.version, alternativeId, route: next.route!, places: next.places, totals: next.totals, quality: next.quality, warnings: next.warnings };
  }

  private findAlternative(state: ItineraryDraftState, alternativeId: string) {
    const alternative = state.alternatives?.find((item) => item.alternativeId === alternativeId);
    if (!alternative) throw new NotFoundException('Alternative not found');
    return alternative;
  }

  /** Exact common alternative rebuild. `selectAlternative` persists it; preview never does. */
  private async rebuildAlternative(state: ItineraryDraftState, alternative: NonNullable<ItineraryDraftState['alternatives']>[number], selecting: boolean): Promise<ItineraryDraftState> {
    const waypoints = alternative.places.map((place) => place.accessPoint ?? place.center);
    if (!state.loop && state.finish) waypoints.push(state.finish);
    const plan = await this.routing.plan({ start: state.start, waypoints, profile: state.profile, options: { loop: state.loop, optimize: false } });
    const route = plan.routes[0]; if (!route) throw new BadRequestException('Routing returned no route for alternative');
    let next = this.withTotals({ ...state, places: alternative.places, route, routeFingerprint: this.fingerprint({ ...state, places: alternative.places }), status: 'ready', scoreBreakdown: alternative.scoreBreakdown, alternatives: selecting ? [] : state.alternatives, autoFillSummary: alternative.selectionSummary });
    if (!next.totals.feasible) throw new ConflictException({ message: 'Alternative no longer fits the itinerary budget', details: { code: 'ALTERNATIVE_NO_LONGER_FEASIBLE' } });
    const quality = this.qualityGate.assess({ route, totals: next.totals, requestedLoop: next.loop, places: next.places, networkConfirmed: true });
    return { ...next, quality, warnings: quality.warnings.map((code) => ({ code, message: itineraryQualityWarningMessage(code) })) };
  }

  async regenerate(ownerKey: string, id: string, input: { categories?: string[]; preferredCategories?: string[]; seed?: number; preset?: ItineraryDraftState['preset']; expectedVersion: number; commandId: string }, signal?: AbortSignal): Promise<ItineraryDraft> {
    return this.autoFill(ownerKey, id, input, signal);
  }

  async applySmartFix(ownerKey: string, id: string, input: { suggestionId: string; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const state = this.withoutHistory(current.state as PersistedDraftState);
    const fix = state.suggestions.find((item) => item.suggestionId === input.suggestionId);
    if (!fix) throw new NotFoundException('Smart fix not found');
    let next: ItineraryDraftState;
    if (fix.kind === 'reduce_visit_mode') {
      const place = state.places.find((item) => item.id === fix.affectedIds[0]);
      if (!place || place.locked || !fix.targetMode) throw new ConflictException('This smart fix can no longer be applied');
      next = { ...state, places: state.places.map((item) => item.id === place.id ? this.visitTime.apply({ ...item, visitMode: fix.targetMode, customVisitMinutes: undefined }, state.profile) : item), warnings: state.warnings, suggestions: [] };
    } else if (fix.kind === 'remove_worst_unlocked') {
      const place = state.places.find((item) => item.id === fix.affectedIds[0]);
      if (!place || place.locked) throw new ConflictException('This smart fix can no longer be applied');
      const places = state.places.filter((item) => item.id !== place.id); if (!places.length) throw new BadRequestException('Smart fix would leave no routeable Places');
      next = await this.routeState({ ...state, places, warnings: [], suggestions: [] });
    } else if (fix.kind === 'make_linear') {
      if (!state.loop) throw new ConflictException('This smart fix can no longer be applied');
      next = await this.routeState({ ...state, loop: false, warnings: [], suggestions: [] });
    } else {
      if (!fix.targetBudgetMinutes || fix.targetBudgetMinutes <= state.budgetMinutes) throw new ConflictException('This smart fix can no longer be applied');
      next = { ...state, budgetMinutes: fix.targetBudgetMinutes, warnings: state.warnings, suggestions: [] };
    }
    next = this.withTotals(next);
    if (next.totals.overBudgetMinutes >= state.totals.overBudgetMinutes) throw new ConflictException('Smart fix did not reduce the budget overage');
    return this.mutate(ownerKey, id, input, () => ({ ...next, suggestions: this.smartFixes(next) }));
  }

  /** Accept a previewed addition: the POI becomes a manual anchor and the
   *  route is replanned for real. Frees the client from any domain arithmetic. */
  async acceptAddition(ownerKey: string, id: string, input: { suggestionId: string; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const currentState = this.withoutHistory(current.state as PersistedDraftState);
    const suggestion = currentState.additions.find((item) => item.suggestionId === input.suggestionId);
    if (!suggestion) throw new NotFoundException('Addition no longer available — regenerate suggestions after editing the route');
    // Accepted POI is an explicit anchor: it survives replans and automatic selection.
    const places = await this.rebuildManualPlaces({ ...currentState, additions: [] }, suggestion.poi);
    const waypoints = places.map((place) => place.accessPoint ?? place.center);
    if (!currentState.loop && currentState.finish) waypoints.push(currentState.finish);
    if (!waypoints.length) throw new BadRequestException('Accepted addition produced no routeable Places');
    const plan = await this.routing.plan({ start: currentState.start, waypoints, profile: currentState.profile, options: { loop: currentState.loop, optimize: false } });
    const route = plan.routes[0];
    if (!route) throw new BadRequestException('Routing returned no real route snapshot');
    let next = this.withTotals({ ...currentState, places, route, routeFingerprint: this.fingerprint({ ...currentState, places }), status: 'ready', warnings: this.loopWarnings(plan) });
    next = { ...next, additions: await this.computeAdditions(next), suggestions: this.smartFixes(next) };
    return this.mutate(ownerKey, id, input, () => next, { preserveAdditions: true });
  }

  /** Preview 2–3 distinct swap options for a place: nearby, same category where
   *  possible, minimal detour, excluding every POI already in the route.
   *  Other locked/manual anchors are never disturbed by the preview. */
  async replacePlace(ownerKey: string, id: string, input: { placeId: string; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const currentState = this.withoutHistory(current.state as PersistedDraftState);
    if (!currentState.places.some((place) => place.id === input.placeId)) throw new NotFoundException('Place not found');
    const replacements = await this.computeReplacements(currentState, input.placeId);
    return this.mutate(ownerKey, id, input, () => ({ ...currentState, replacements }), { preserveReplacements: true });
  }

  /** Apply a previewed replacement: drop the target place, add the candidate as
   *  a manual anchor, replan for real. */
  async acceptReplacement(ownerKey: string, id: string, input: { suggestionId: string; expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const currentState = this.withoutHistory(current.state as PersistedDraftState);
    const option = currentState.replacements.find((item) => item.suggestionId === input.suggestionId);
    if (!option) throw new NotFoundException('Replacement no longer available — regenerate after editing the route');
    const placeId = input.suggestionId.split(':')[1];
    if (!currentState.places.some((place) => place.id === placeId)) throw new ConflictException('Place to replace no longer exists');
    const remaining = currentState.places.filter((place) => place.id !== placeId);
    const places = await this.rebuildManualPlaces({ ...currentState, places: remaining, replacements: [] }, option.poi);
    const waypoints = places.map((place) => place.accessPoint ?? place.center);
    if (!currentState.loop && currentState.finish) waypoints.push(currentState.finish);
    if (!waypoints.length) throw new BadRequestException('Replacement produced no routeable Places');
    const plan = await this.routing.plan({ start: currentState.start, waypoints, profile: currentState.profile, options: { loop: currentState.loop, optimize: false } });
    const route = plan.routes[0];
    if (!route) throw new BadRequestException('Routing returned no real route snapshot');
    let next = this.withTotals({ ...currentState, places, route, routeFingerprint: this.fingerprint({ ...currentState, places }), status: 'ready', warnings: this.loopWarnings(plan) });
    next = { ...next, additions: await this.computeAdditions(next), suggestions: this.smartFixes(next) };
    return this.mutate(ownerKey, id, input, () => next, { preserveAdditions: true });
  }

  async replan(ownerKey: string, id: string, input: { expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const currentState = this.withoutHistory(current.state as PersistedDraftState);
    const rebuiltState = { ...currentState, places: await this.rebuildManualPlaces(currentState) };
    const waypoints = rebuiltState.places.map((place) => place.accessPoint ?? place.center);
    if (!rebuiltState.loop && rebuiltState.finish) waypoints.push(rebuiltState.finish);
    if (waypoints.length === 0) return this.mutate(ownerKey, id, input, (state) => this.invalidateRoute(state), { recordHistory: false });
    const plan = await this.routing.plan({ start: rebuiltState.start, waypoints, profile: rebuiltState.profile, options: { loop: rebuiltState.loop, optimize: false } });
    const route = plan.routes[0];
    if (!route) throw new BadRequestException('Routing returned no real route snapshot');
    let routedState = this.withTotals({ ...rebuiltState, route, routeFingerprint: this.fingerprint(rebuiltState), status: 'ready', warnings: this.loopWarnings(plan) });
    routedState = { ...routedState, suggestions: this.smartFixes(routedState), additions: await this.computeAdditions(routedState) };
    // Overbudget is a valid editable state; unlike publish, replanning never blocks it.
    return this.mutate(ownerKey, id, input, () => routedState, { recordHistory: false, preserveAdditions: true });
  }

  /**
   * Delete an unpublished draft. Missing and foreign ids deliberately succeed so
   * this command cannot disclose another owner's draft. Retrying after a lost
   * 204 is therefore safe; published snapshots remain immutable.
   */
  async discard(ownerKey: string, id: string, input: { expectedVersion: number; commandId: string }): Promise<void> {
    const current = await this.drafts.findOne({ where: { id, ownerKey } });
    if (!current) return;
    const state = this.withoutHistory(current.state as PersistedDraftState);
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    if (state.status === 'published' || state.publishedRouteId) throw new ConflictException({ message: 'Published itineraries are immutable', details: { code: 'PUBLISHED_ITINERARY_IMMUTABLE' } });

    await this.drafts.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ItineraryDraftEntity);
      const result = await repo.delete({ id, ownerKey, version: current.version });
      if (result.affected === 1) return;
      const latest = await repo.findOne({ where: { id, ownerKey } });
      if (!latest) return;
      throw this.versionConflict(this.snapshot(latest));
    });
  }

  async publish(ownerKey: string, id: string, input: { expectedVersion: number; commandId: string }): Promise<ItineraryDraft> {
    // Fast idempotency check avoids rebuilding a route on network retry.
    const current = await this.findOwned(ownerKey, id);
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const currentState = this.withoutHistory(current.state as PersistedDraftState);
    if (currentState.status === 'published') throw new ConflictException('Published itinerary is immutable');
    const waypoints = currentState.places.map((place) => place.accessPoint ?? place.center);
    if (!currentState.loop && currentState.finish) waypoints.push(currentState.finish);
    if (waypoints.length === 0) throw new BadRequestException('At least one current Place or finish is required for publish');
    // GraphHopper work is intentionally outside the DB transaction. The later
    // version CAS rejects this geometry if any command changed the Places.
    const plan = await this.routing.plan({
      start: currentState.start,
      waypoints,
      profile: currentState.profile,
      options: { loop: currentState.loop, optimize: false },
    });
    const route = plan.routes[0];
    if (!route) throw new BadRequestException('Routing returned no real route snapshot');
    const routedState = this.withTotals({
      ...currentState,
      route,
      routeFingerprint: this.fingerprint(currentState),
      status: 'published',
      warnings: this.loopWarnings(plan),
    });
    if (!routedState.totals.feasible) throw new ConflictException('An infeasible itinerary cannot be published');
    return this.mutate(ownerKey, id, input, () => routedState, { publish: true, recordHistory: false });
  }

  private async mutate<T extends { expectedVersion: number; commandId: string }>(
    ownerKey: string,
    id: string,
    input: T,
    change: (state: ItineraryDraftState) => ItineraryDraftState,
    options: { undo?: boolean; publish?: boolean; recordHistory?: boolean; preserveAdditions?: boolean; preserveReplacements?: boolean; preserveAutoFillSummary?: boolean; preserveQuality?: boolean } = {},
  ): Promise<ItineraryDraft> {
    // Verify ownership before returning any persisted idempotency receipt.
    const current = await this.findOwned(ownerKey, id);
    const persistedCurrent = current.state as PersistedDraftState;
    const currentState = this.withoutHistory(persistedCurrent);
    if (currentState.status === 'published') throw new ConflictException('Published itinerary is immutable');
    const receipt = await this.commands.findOne({ where: { draftId: id, commandId: input.commandId } });
    if (receipt) return receipt.resultSnapshot;
    if (current.version !== input.expectedVersion) throw this.versionConflict(this.snapshot(current));
    const existingHistory = persistedCurrent.history ?? [];
    if (options.undo && existingHistory.length === 0) throw new ConflictException('Nothing to undo');
    let state = options.undo
      ? this.withTotals(structuredClone(existingHistory[existingHistory.length - 1]))
      : this.withTotals(change(structuredClone(currentState)));
    // Additions are a transient preview tied to the current route. Any command
    // that did not explicitly recompute them clears the stale list so the UI
    // never offers an addition for a route that no longer exists.
    if (!options.preserveAdditions) state = { ...state, additions: [] };
    if (!options.preserveReplacements) state = { ...state, replacements: [] };
    // autoFillSummary, alternatives and scoreBreakdown are snapshots of the
    // last automatic fill's candidate pool and its evidence. Any manual edit
    // invalidates them, so they never describe a stale pool.
    if (!options.preserveAutoFillSummary) state = { ...state, autoFillSummary: undefined, alternatives: undefined, scoreBreakdown: undefined };
    // Quality is evidence for one exact auto-routing result, never a claim
    // about geometry or totals changed by a later manual command. Undo instead
    // restores an unchanged historical snapshot, including its evidence.
    if (!options.preserveQuality && !options.undo) state = { ...state, quality: undefined };
    let history = options.undo
      ? existingHistory.slice(0, -1)
      : options.recordHistory === false
        ? existingHistory
        : [...existingHistory, currentState].slice(-20);
    let persistedState: PersistedDraftState = { ...state, history };
    const nextVersion = current.version + 1;
    return this.drafts.manager.transaction(async (manager) => {
      const draftRepo = manager.getRepository(ItineraryDraftEntity);
      const commandRepo = manager.getRepository(ItineraryCommandEntity);
      // Receipt and state transition commit atomically: a successful state
      // change can never be left without the idempotency result for a retry.
      const concurrentReceipt = await commandRepo.findOne({ where: { draftId: id, commandId: input.commandId } });
      if (concurrentReceipt) return concurrentReceipt.resultSnapshot;
      const result = await draftRepo.update({ id, ownerKey, version: current.version }, { state: persistedState, version: nextVersion });
      if (result.affected !== 1) {
        // A concurrent retry of this same command may have won the CAS while
        // our UPDATE waited. READ COMMITTED sees its receipt now.
        const winningReceipt = await commandRepo.findOne({ where: { draftId: id, commandId: input.commandId } });
        if (winningReceipt) return winningReceipt.resultSnapshot;
        const latest = await draftRepo.findOne({ where: { id, ownerKey } });
        if (!latest) throw new NotFoundException('Itinerary draft not found');
        throw this.versionConflict(this.snapshot(latest));
      }
      let snapshot: ItineraryDraft = {
        ...state,
        id: current.id,
        version: nextVersion,
        createdAt: current.createdAt.toISOString(),
        expiresAt: current.expiresAt.toISOString(),
      };
      if (options.publish) {
        const saved = await this.routes.publishFromItinerary(snapshot, ownerKey, manager);
        state = { ...state, publishedRouteId: saved.id };
        persistedState = { ...state, history };
        await draftRepo.update({ id, ownerKey, version: nextVersion }, { state: persistedState });
        snapshot = { ...snapshot, ...state };
      }
      await commandRepo.insert({ draftId: id, commandId: input.commandId, resultVersion: nextVersion, resultSnapshot: snapshot });
      return snapshot;
    });
  }

  /** Rebuild only manual Places through the network-backed clusterer while
   * retaining each existing stop's visit mode, lock and child projection. */
  private async rebuildManualPlaces(state: ItineraryDraftState, added?: ItineraryPoi): Promise<RoutePlace[]> {
    const manual = state.places.filter((place) => place.source === 'manual');
    if (manual.length === 0 && !added) return state.places;
    const children = [...manual.flatMap((place) => place.pois), ...(added ? [added] : [])];
    const clustered = await this.clustering.cluster(children, state.profile);
    const indexByPlace = new Map(state.places.map((place, index) => [place.id, index]));
    const previousByChild = new Map(manual.flatMap((place) => place.pois.map((child) => [child.id, { place, child }])));
    const rebuilt = clustered.map((candidate) => {
      const previous = candidate.pois
        .map((child) => previousByChild.get(child.id)?.place)
        .filter((place): place is RoutePlace => !!place)
        .sort((a, b) => (indexByPlace.get(a.id) ?? 0) - (indexByPlace.get(b.id) ?? 0));
      const primary = previous[0];
      const pois = candidate.pois.map((child) => {
        const { notable: _notable, ...previousChild } = previousByChild.get(child.id)?.child ?? {};
        // `notable` is recalculated by the clusterer, never restored from a
        // previous headline after membership/ranking changes.
        return { ...child, ...previousChild };
      });
      const unchangedSingle = primary && previous.length === 1 && primary.pois.length === 1 && candidate.pois.length === 1 && primary.pois[0].id === candidate.pois[0].id;
      return this.visitTime.apply({
        ...candidate, id: unchangedSingle ? primary.id : candidate.pois.length === 1 ? `poi_${candidate.pois[0].id}` : candidate.id,
        pois, visitMode: primary?.visitMode ?? (state.stopPace === 'pass_by' ? 'pass_by' : state.stopPace === 'quick' ? 'glance' : 'visit'),
        customVisitMinutes: primary?.customVisitMinutes, locked: previous.some((place) => place.locked),
      }, state.profile);
    });
    // Keep the established manual ordering where possible; a new compound takes
    // the earliest position of any child it absorbed.
    rebuilt.sort((a, b) => {
      const order = (place: RoutePlace) => Math.min(...place.pois.map((child) => indexByPlace.get(previousByChild.get(child.id)?.place.id ?? '') ?? Number.MAX_SAFE_INTEGER));
      return order(a) - order(b) || a.id.localeCompare(b.id);
    });
    const nonManual = state.places.filter((place) => place.source !== 'manual');
    return [...rebuilt, ...nonManual];
  }

  private smartFixes(state: ItineraryDraftState): import('./itinerary.types').SmartFix[] {
    if (state.budgetMinutes == null || state.totals.feasible) return [];
    const delta = (previewTotals: ItineraryDraftState['totals']) => ({ travelMinutes: previewTotals.travelMinutes - state.totals.travelMinutes, stopMinutes: previewTotals.stopMinutes - state.totals.stopMinutes, reserveMinutes: previewTotals.reserveMinutes - state.totals.reserveMinutes, totalMinutes: previewTotals.totalMinutes - state.totals.totalMinutes, overBudgetMinutes: previewTotals.overBudgetMinutes - state.totals.overBudgetMinutes, remainingMinutes: previewTotals.remainingMinutes - state.totals.remainingMinutes });
    const fixes: import('./itinerary.types').SmartFix[] = [];
    const reducible = state.places.filter((place) => !place.locked && (place.visitMode === 'visit' || place.visitMode === 'glance')).sort((a, b) => b.dwellMinutes - a.dwellMinutes)[0];
    if (reducible) { const targetMode = reducible.visitMode === 'visit' ? 'glance' : 'pass_by'; const places = state.places.map((place) => place.id === reducible.id ? this.visitTime.apply({ ...place, visitMode: targetMode }, state.profile) : place); const previewTotals = this.budget.calculate({ travelMinutes: state.totals.travelMinutes, places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes }); fixes.push({ suggestionId: `mode:${reducible.id}:${targetMode}`, kind: 'reduce_visit_mode', reason: `Сократить остановку «${reducible.name}» до ${targetMode === 'glance' ? 'осмотра' : 'проезда'}`, previewTotals, delta: delta(previewTotals), affectedIds: [reducible.id], targetMode }); }
    const worst = state.places.filter((place) => !place.locked).sort((a, b) => b.dwellMinutes - a.dwellMinutes)[0];
    if (worst) { const previewTotals = this.budget.calculate({ travelMinutes: state.totals.travelMinutes, places: state.places.filter((place) => place.id !== worst.id), budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes }); fixes.push({ suggestionId: `remove-worst:${worst.id}`, kind: 'remove_worst_unlocked', reason: `Убрать наиболее затратное незакреплённое место «${worst.name}»`, previewTotals, delta: delta(previewTotals), affectedIds: [worst.id], estimatedRoute: true }); }
    if (state.loop) { const previewTotals = this.budget.calculate({ travelMinutes: Math.ceil(state.totals.travelMinutes * .65), places: state.places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes }); fixes.push({ suggestionId: 'make-linear', kind: 'make_linear', reason: 'Сделать маршрут линейным без возврата к старту', previewTotals, delta: delta(previewTotals), affectedIds: [], estimatedRoute: true }); }
    const targetBudgetMinutes = state.budgetMinutes + state.totals.overBudgetMinutes; const previewTotals = this.budget.calculate({ travelMinutes: state.totals.travelMinutes, places: state.places, budgetMinutes: targetBudgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes }); fixes.push({ suggestionId: `increase-budget:${targetBudgetMinutes}`, kind: 'increase_budget', reason: `Увеличить бюджет до ${targetBudgetMinutes} мин`, previewTotals, delta: delta(previewTotals), affectedIds: [], targetBudgetMinutes });
    return fixes.filter((fix) => fix.previewTotals.overBudgetMinutes < state.totals.overBudgetMinutes);
  }

  private async routeState(state: ItineraryDraftState): Promise<ItineraryDraftState> {
    const waypoints = state.places.map((place) => place.accessPoint ?? place.center); if (!state.loop && state.finish) waypoints.push(state.finish);
    const plan = await this.routing.plan({ start: state.start, waypoints, profile: state.profile, options: { loop: state.loop, optimize: false } }); const route = plan.routes[0]; if (!route) throw new BadRequestException('Routing returned no real route snapshot');
    return { ...state, route, routeFingerprint: this.fingerprint(state), status: 'ready', warnings: this.loopWarnings(plan) };
  }

  /** Map routing plan warnings to user-facing itinerary warnings. A replan is
   *  the authoritative source for loop quality, so callers that route through
   *  `routeState` always derive warnings from the fresh geometry instead of
   *  trusting a stale list from before the edit. */
  private loopWarnings(plan: PlanResult): ItineraryWarning[] {
    const codes = plan.warnings ?? plan.loopQuality?.warnings ?? [];
    return codes.includes('UNAVOIDABLE_OUT_AND_BACK')
      ? [{ code: 'UNAVOIDABLE_OUT_AND_BACK', message: 'Часть пути неизбежно повторяется — часть дороги придётся пройти туда и обратно.' }]
      : [];
  }

  /** Preview nearby POIs that fit budget freed by shorter visits or removal.
   *  Uses a geometric detour estimate so the preview is cheap and deterministic;
   *  accepting triggers a real replan. Returns [] with no route or no budget left. */
  private async computeAdditions(state: ItineraryDraftState): Promise<AdditionSuggestion[]> {
    if (!state.route || state.budgetMinutes == null || state.budgetMode === 'unlimited') return [];
    const remaining = state.totals.remainingMinutes ?? 0;
    if (remaining < 5 || !state.places.length) return [];
    const [minLon, minLat, maxLon, maxLat] = state.route.bbox as number[];
    const buffer = 0.012; // ~1.3 km corridor around the route bbox
    const res = await this.pois.list({ bbox: `${minLon - buffer},${minLat - buffer},${maxLon + buffer},${maxLat + buffer}`, limit: 80, sort: 'popularity' });
    const included = new Set(state.places.flatMap((place) => place.pois.map((child) => child.id)));
    const speedMs = this.profileSpeedMs(state.profile);
    const suggestions: AdditionSuggestion[] = [];
    for (const row of res.items) {
      if (included.has(row.id) || row.lat == null || row.lon == null) continue;
      const nearest = Math.min(...state.places.map((place) => this.haversine({ lat: row.lat!, lon: row.lon! }, place.center)));
      const detourMinutes = (2 * nearest / speedMs) / 60;
      if (detourMinutes > remaining) continue; // cheap prune before any clustering
      const estimate = await this.estimateAddition(state, row, detourMinutes);
      if (!estimate || !estimate.previewTotals.feasible) continue;
      suggestions.push(estimate);
      if (suggestions.length >= 5) break;
    }
    return suggestions;
  }
  /** Estimate the impact of adding one POI to the current route. Returns null
   *  when there is no route/budget to estimate against. The preview is a
   *  geometric detour proxy; a real replan runs on accept. */
  private async estimateAddition(state: ItineraryDraftState, row: ItineraryPoiSource, detourMinutesOverride?: number): Promise<AdditionSuggestion | null> {
    if (!state.route || state.budgetMinutes == null || state.budgetMode === 'unlimited' || !state.places.length || row.lat == null || row.lon == null) return null;
    const speedMs = this.profileSpeedMs(state.profile);
    const nearest = Math.min(...state.places.map((place) => this.haversine({ lat: row.lat, lon: row.lon }, place.center)));
    const detourMinutes = detourMinutesOverride ?? (2 * nearest / speedMs) / 60;
    const projected = projectItineraryPoi(row);
    const mode: VisitMode = state.stopPace === 'pass_by' ? 'pass_by' : state.stopPace === 'quick' ? 'glance' : 'visit';
    const clustered = await this.clustering.cluster([projected], state.profile);
    const place = this.visitTime.apply({ ...clustered[0], source: 'auto' as const, visitMode: mode }, state.profile);
    const previewTotals = this.budget.calculate({ travelMinutes: state.totals.travelMinutes + detourMinutes, places: [...state.places, place], budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
    return {
      suggestionId: `add:${row.id}`, poi: projected,
      reason: `Рядом с маршрутом, +${Math.ceil(detourMinutes + place.dwellMinutes)} мин`,
      detourMinutes, dwellMinutes: place.dwellMinutes, previewTotals,
      delta: { travelMinutes: previewTotals.travelMinutes - state.totals.travelMinutes, stopMinutes: previewTotals.stopMinutes - state.totals.stopMinutes, totalMinutes: previewTotals.totalMinutes - state.totals.totalMinutes, overBudgetMinutes: previewTotals.overBudgetMinutes - state.totals.overBudgetMinutes, remainingMinutes: (previewTotals.remainingMinutes ?? 0) - (state.totals.remainingMinutes ?? 0) },
    };
  }

  /** Batch route-impact preview for a POI shop/catalog: for each requested POI,
   *  return the estimated add-impact against the current draft. Read-only — no
   *  version bump, no mutation. Powers the catalog «+N мин» affordance without
   *  N separate requests. */
  async routeImpact(ownerKey: string, id: string, poiIds: string[]): Promise<Array<{ poiId: string; available: boolean; estimate?: AdditionSuggestion }>> {
    const current = await this.findOwned(ownerKey, id);
    const state = this.withoutHistory(current.state as PersistedDraftState);
    const results: Array<{ poiId: string; available: boolean; estimate?: AdditionSuggestion }> = [];
    for (const poiId of poiIds) {
      let row: Awaited<ReturnType<PoisService['byId']>>;
      try { row = await this.pois.byId(poiId); } catch { results.push({ poiId, available: false }); continue; }
      if (row.lat == null || row.lon == null) { results.push({ poiId, available: false }); continue; }
      results.push({ poiId, available: true, estimate: await this.estimateAddition(state, row) ?? undefined });
    }
    return results;
  }
  /** Preview swap options for one place: same category where possible, minimal
   *  detour against the REMAINING places, excluding every POI already in the
   *  route. Other locked/manual anchors are untouched. */
  private async computeReplacements(state: ItineraryDraftState, placeId: string): Promise<AdditionSuggestion[]> {
    const target = state.places.find((place) => place.id === placeId);
    if (!target || !state.route || state.budgetMinutes == null || state.budgetMode === 'unlimited') return [];
    const basePlaces = state.places.filter((place) => place.id !== placeId);
    if (!basePlaces.length) return []; // swapping the only place is just an add
    const targetCategory = target.pois[0]?.category;
    const [minLon, minLat, maxLon, maxLat] = state.route.bbox as number[];
    const buffer = 0.012;
    const res = await this.pois.list({ bbox: `${minLon - buffer},${minLat - buffer},${maxLon + buffer},${maxLat + buffer}`, limit: 80, sort: 'popularity' });
    const included = new Set(state.places.flatMap((place) => place.pois.map((child) => child.id)));
    const speedMs = this.profileSpeedMs(state.profile);
    const ranked = res.items
      .filter((row) => !included.has(row.id) && row.lat != null && row.lon != null)
      .map((row) => ({ row, near: Math.min(...basePlaces.map((place) => this.haversine({ lat: row.lat!, lon: row.lon! }, place.center))), sameCategory: row.category === targetCategory ? 1 : 0 }))
      .sort((a, b) => b.sameCategory - a.sameCategory || a.near - b.near);
    const options: AdditionSuggestion[] = [];
    for (const { row, near } of ranked) {
      const detourMinutes = (2 * near / speedMs) / 60;
      const projected = projectItineraryPoi(row);
      const clustered = await this.clustering.cluster([projected], state.profile);
      const place = this.visitTime.apply({ ...clustered[0], source: target.source, visitMode: target.visitMode, customVisitMinutes: target.customVisitMinutes }, state.profile);
      const previewTotals = this.budget.calculate({ travelMinutes: state.totals.travelMinutes + detourMinutes, places: [...basePlaces, place], budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes });
      options.push({
        suggestionId: `replace:${placeId}:${row.id}`, poi: projected,
        reason: `${row.category === targetCategory ? 'та же категория' : 'рядом'}, +${Math.ceil(detourMinutes + place.dwellMinutes)} мин`,
        detourMinutes, dwellMinutes: place.dwellMinutes, previewTotals,
        delta: { travelMinutes: previewTotals.travelMinutes - state.totals.travelMinutes, stopMinutes: previewTotals.stopMinutes - state.totals.stopMinutes, totalMinutes: previewTotals.totalMinutes - state.totals.totalMinutes, overBudgetMinutes: previewTotals.overBudgetMinutes - state.totals.overBudgetMinutes, remainingMinutes: (previewTotals.remainingMinutes ?? 0) - (state.totals.remainingMinutes ?? 0) },
      });
      if (options.length >= 3) break;
    }
    return options;
  }
  private profileSpeedMs(profile: ItineraryDraftState['profile']): number {
    switch (profile) { case 'foot': case 'foot_scenic': return 1.4; case 'mtb': case 'mtb_leisure': return 4; case 'bike': case 'bike_touring': return 4.5; default: return 11; }
  }
  private haversine(a: Point, b: Point): number {
    const radius = 6_371_000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
  }
  private invalidateRoute(state: ItineraryDraftState): ItineraryDraftState {
    const { route: _route, routeFingerprint: _fingerprint, publishedRouteId: _publishedRouteId, quality: _quality, ...rest } = state;
    return { ...rest, status: 'ready' };
  }
  private fingerprint(state: ItineraryDraftState): string {
    const input = {
      start: state.start, finish: state.finish, profile: state.profile, loop: state.loop,
      places: state.places.map((place) => ({ id: place.id, point: place.accessPoint ?? place.center })),
    };
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }
  private withTotals(state: Omit<ItineraryDraftState, 'totals'> & Partial<Pick<ItineraryDraftState, 'totals'>>): ItineraryDraftState {
    return { ...state, totals: this.budget.calculate({ travelMinutes: state.route ? state.route.duration / 60 : 0, places: state.places, budgetMinutes: state.budgetMinutes, budgetMode: state.budgetMode, reserveMinutes: state.reserveMinutes }) };
  }
  private async findOwned(ownerKey: string, id: string): Promise<ItineraryDraftEntity> {
    const entity = await this.drafts.findOne({ where: { id, ownerKey } });
    if (!entity || entity.expiresAt.getTime() <= Date.now()) throw new NotFoundException('Itinerary draft not found');
    return entity;
  }
  private withoutHistory(state: PersistedDraftState): ItineraryDraftState {
    const { history: _history, ...snapshot } = state;
    // JSONB drafts predate intent and stopPace. Normalize on every read so
    // deployed snapshots remain usable without a destructive data migration.
    const inferredIntent = snapshot.intent
      ?? (snapshot.places.some((place) => place.source === 'manual' || place.locked)
        ? 'manual_collection'
        : snapshot.finish ? 'destination' : 'auto_budget');
    const inferredStopPace = snapshot.stopPace ?? (snapshot.selectionPolicyVersion === 'v2' ? 'pass_by' : 'quick');
    return { ...snapshot, intent: inferredIntent, stopPace: inferredStopPace, additions: snapshot.additions ?? [], replacements: snapshot.replacements ?? [] };
  }
  private snapshot(entity: ItineraryDraftEntity): ItineraryDraft {
    return { ...this.withoutHistory(entity.state as PersistedDraftState), id: entity.id, version: entity.version, createdAt: entity.createdAt.toISOString(), expiresAt: entity.expiresAt.toISOString() };
  }
  private versionConflict(snapshot: ItineraryDraft): ConflictException {
    return new ConflictException({ message: 'Itinerary draft has changed', details: { code: 'ITINERARY_VERSION_CONFLICT', snapshot } });
  }
}
