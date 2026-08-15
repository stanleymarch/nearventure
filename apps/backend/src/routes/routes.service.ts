import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, Not, IsNull } from 'typeorm';
import { randomBytes, randomUUID } from 'crypto';

import type { RoutingProfile, RouteResult } from '../routing/routing.types';
import type { CreateRouteDto, UpdateRouteDto } from './dto/create-route.dto';
import { RouteEntity, RouteStatus } from './entities/route.entity';
import type { ItineraryDraft } from '../itineraries/itinerary.types';
import { publicBaseUrl } from '../common/app-config';

export interface RoutePoiSnapshot {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  distance?: number;
  description?: string;
  /** Legacy snapshots may contain this raw value; never return it publicly. */
  imageUrl?: string | null;
  /** A safe proxy may be attempted, subject to the POI's current policy. */
  hasMedia?: boolean;
}

export type PublicRoute = Omit<RouteEntity, 'loop' | 'pois'> & {
  loop: boolean | null;
  pois: RoutePoiSnapshot[] | null;
  options: { loop: boolean | null; optimize: boolean };
};

@Injectable()
export class RoutesService {
  constructor(
    @InjectRepository(RouteEntity)
    private readonly routeRepo: Repository<RouteEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Keep the public topology nullable: legacy rows must not become false. */
  toPublicRoute(route: RouteEntity): PublicRoute {
    const loop = typeof route.loop === 'boolean' ? route.loop : null;
    // Snapshots predate the public image-evidence policy and can retain raw
    // external URLs. Do not expose any snapshot URL: the browser receives only
    // a media hint and must re-check the current POI through the safe proxy.
    const pois = route.pois?.map((poi) => {
      const { imageUrl, ...snapshot } = poi;
      return imageUrl || snapshot.hasMedia === true
        ? { ...snapshot, hasMedia: true }
        : snapshot;
    }) ?? null;
    return { ...route, pois, loop, options: { loop, optimize: false } };
  }

  /** Canonical SPA hash route; absent outside production until configured. */
  private publicRouteUrl(routeId: string): string | null {
    const base = publicBaseUrl();
    return base ? `${base}/#/route/${encodeURIComponent(routeId)}` : null;
  }

  /** Persist an immutable, owner-attributed snapshot from a feasible draft. */
  async publishFromItinerary(draft: ItineraryDraft, ownerKey: string, manager?: EntityManager): Promise<RouteEntity> {
    if (!draft.route || !draft.totals.feasible) throw new Error('Only a feasible routed itinerary can be published');
    const repo = manager?.getRepository(RouteEntity) ?? this.routeRepo;
    const id = randomUUID();
    const publicToken = randomBytes(18).toString('hex');
    const now = new Date();
    const pois = draft.places.flatMap((place) => place.pois.filter((poi) => poi.included));
    const route = repo.create({
      id, title: `Маршрут #${id.substring(0, 8)}`, description: null,
      status: RouteStatus.PUBLISHED, transport: draft.profile, loop: draft.loop, timeAvailable: draft.budgetMinutes,
      selectedCategories: [...new Set(pois.map((poi) => poi.category))], distance: draft.route.distance,
      duration: draft.route.duration, ascend: draft.route.ascend, descend: draft.route.descend,
      geojson: draft.route.geojson, pois: pois.map((poi) => ({ id: poi.id, name: poi.name, category: poi.category, lat: poi.lat, lon: poi.lon })),
      publicToken, publicUrl: this.publicRouteUrl(id),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), isPublished: true,
      createdBy: ownerKey, sourceDraftId: draft.id, itinerarySnapshot: structuredClone(draft) as unknown as Record<string, unknown>,
      createdAt: now, updatedAt: now,
    });
    return repo.save(route);
  }

  /**
   * Enrich raw POI ids with real names/categories/coordinates/descriptions from
   * `poi_product` (the canonical, app-facing POI projection). Used by
   * `createRouteFromMap` so route snapshots on the public share page are not
   * empty `sights` placeholders (B7 in logs/qa/REPORT.md).
   *
   * Falls back to a thin placeholder for any id we can't resolve (e.g. an
   * older localStorage route referencing a since-deleted POI), so the
   * snapshot list always has a stable shape.
   */
  async enrichPois(ids: string[]): Promise<RoutePoiSnapshot[]> {
    if (!ids?.length) return [];
    const rows = (await this.dataSource.query(
      `SELECT poi_uuid, name, category, lat, lon, description
       FROM poi_product
       WHERE poi_uuid = ANY($1::text[]) AND is_active = true`,
      [ids],
    )) as {
      poi_uuid: string;
      name: string | null;
      category: string | null;
      lat: number | null;
      lon: number | null;
      description: string | null;
    }[];
    const byId = new Map(rows.map((r) => [r.poi_uuid, r]));
    return ids.map((id, i) => {
      const r = byId.get(id);
      if (r) {
        return {
          id,
          name: r.name || 'Без названия',
          category: r.category || 'sights',
          lat: r.lat ?? 0,
          lon: r.lon ?? 0,
          description: r.description || undefined,
          distance: i,
        };
      }
      // Unknown id — keep the shape so the share page still renders a card.
      return {
        id,
        name: 'Без названия',
        category: 'sights',
        lat: 0,
        lon: 0,
        distance: i,
      };
    });
  }

  /**
   * Создать публичный маршрут и вернуть его publicUrl.
   */
  async createPublicRoute(
    data: CreateRouteDto,
    routeResult: RouteResult,
    pois: any[],
    publicRequester: string,
    publicRequesterName?: string,
    anonymousId?: string,
  ): Promise<{
    routeId: string;
    publicUrl: string | null;
    publicToken: string;
  }> {
    const publicToken = randomBytes(18).toString('hex');
    const routeId = randomUUID();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 дней

    const route = this.routeRepo.create({
      id: routeId,
      title: data.title || `Маршрут #${routeId.substring(0, 8)}`,
      description: data.description,
      status: RouteStatus.PUBLISHED,
      transport: data.transport,
      loop: typeof data.loop === 'boolean' ? data.loop : null,
      timeAvailable: data.timeAvailable,
      selectedCategories: data.selectedCategories || [],
      distance: routeResult.distance,
      duration: routeResult.duration,
      ascend: routeResult.ascend,
      descend: routeResult.descend,
      geojson: routeResult.geojson,
      pois: pois.map(p => ({
        id: p.id,
        name: p.name || 'Без названия',
        category: p.category as string,
        lat: p.lat || 0,
        lon: p.lon || 0,
      })), // could be enriched via enrichPois(ids) here, but the planner
          // already passes real names from pois.service — leave as-is.
      publicToken,
      publicUrl: this.publicRouteUrl(routeId),
      expiresAt,
      isPublished: true,
      createdBy: publicRequester,
      createdAt: now,
      updatedAt: now,
    });

    await this.routeRepo.save(route);

    return {
      routeId,
      publicUrl: this.publicRouteUrl(routeId),
      publicToken,
    };
  }

  /**
   * Create a route from frontend map data (AdventureView persistRoute).
   * Frontend sends: { routeData, pois, profile, options, title, startPoint, waypoints }.
   * The `pois` array may be either:
   *   - bare ids (legacy shape from the in-browser draft)
   *   - already-enriched snapshot objects (new shape from AdventureView)
   * We unify both into enriched snapshots via `enrichPois` so the public
   * share page always renders real POI names / categories (B7 in REPORT.md).
   */
  async createRouteFromMap(body: any): Promise<RouteEntity> {
    const routeId = randomUUID();
    const publicToken = randomBytes(18).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { routeData, pois, profile, title } = body;
    const loop = typeof body?.options?.loop === 'boolean' ? body.options.loop : null;

    let snapshots: RoutePoiSnapshot[];
    if (Array.isArray(pois) && pois.length && typeof pois[0] === 'string') {
      // Legacy: bare ids
      snapshots = await this.enrichPois(pois as string[]);
    } else if (Array.isArray(pois) && pois.length && typeof pois[0] === 'object') {
      // New shape: pre-enriched objects from AdventureView. We still
      // re-validate names / category via the DB so a tampered share URL
      // doesn't display attacker-controlled text on the share page.
      const ids = (pois as Array<{ id: string }>).map((p) => p.id);
      const enriched = await this.enrichPois(ids);
      const byId = new Map(enriched.map((e) => [e.id, e]));
      snapshots = (pois as Array<{ id: string }>).map((p, i) => {
        const e = byId.get(p.id);
        return {
          id: p.id,
          name: e?.name && e.name !== 'Без названия' ? e.name : p.id,
          category: e?.category || 'sights',
          lat: e?.lat ?? 0,
          lon: e?.lon ?? 0,
          description: e?.description,
          distance: i,
        };
      });
    } else {
      snapshots = [];
    }

    const route = this.routeRepo.create({
      id: routeId,
      title: title || `Маршрут #${routeId.substring(0, 8)}`,
      description: null,
      status: RouteStatus.PUBLISHED,
      transport: profile || 'bike',
      loop,
      timeAvailable: null,
      selectedCategories: [],
      distance: routeData?.distance ?? 0,
      duration: routeData?.duration ?? 0,
      ascend: routeData?.ascend ?? 0,
      descend: routeData?.descend ?? 0,
      geojson: routeData?.geojson ?? null,
      pois: snapshots,
      publicToken,
      publicUrl: this.publicRouteUrl(routeId),
      expiresAt,
      isPublished: true,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.routeRepo.save(route);
    return route;
  }

  /** Get a raw route entity by id (for GPX export). */
  async getRouteEntity(id: string): Promise<RouteEntity | null> {
    return this.routeRepo.findOne({ where: { id } });
  }

  /** Increment GPX download counter. */
  async incrementGpxDownloads(id: string): Promise<void> {
    const route = await this.routeRepo.findOne({ where: { id } });
    if (!route) return;
    const analytics = route.analytics || { views: 0, shares: 0, gpxDownloads: 0 };
    analytics.gpxDownloads = (analytics.gpxDownloads || 0) + 1;
    route.analytics = analytics;
    await this.routeRepo.save(route);
  }

  /**
   * Получить маршрут по publicUrl или напрямую по ID.
   *
   * Поддерживает два формата URL:
   *   - /route/{uuid}/{publicToken}  — полная публичная ссылка
   *   - /route/{uuid}/               — короткая ссылка (только ID, без токена)
   */
  async getRouteByPublicUrl(
    publicUrl: string,
    anonymousId?: string,
  ): Promise<{
    route: RouteEntity | null;
    anonymousId: string | null;
  }> {
    // Legacy URLs may include the now-unpublished token path.
    let match = publicUrl.match(/\/route\/([a-f0-9-]+)\/([a-f0-9]+)/);
    let routeId: string | undefined;
    let publicToken: string | undefined;

    if (match) {
      routeId = match[1];
      publicToken = match[2];
    } else {
      match = publicUrl.match(/\/route\/([a-f0-9-]+)\/?$/);
      if (match) routeId = match[1];
    }

    if (!routeId) return { route: null, anonymousId: anonymousId || null };
    return this.getRouteById(routeId, anonymousId, publicToken);
  }

  /** Retrieve a route by ID without manufacturing a host-dependent URL. */
  async getRouteById(
    routeId: string,
    anonymousId?: string,
    publicToken?: string,
  ): Promise<{
    route: RouteEntity | null;
    anonymousId: string | null;
  }> {
    const route = await this.routeRepo.findOne({ where: { id: routeId } });

    if (publicToken && route?.publicToken !== publicToken) {
      return { route: null, anonymousId: anonymousId || null };
    }

    if (!route) return { route: null, anonymousId: anonymousId || null };

    if (route.expiresAt && new Date() > new Date(route.expiresAt)) {
      await this.routeRepo.update(route.id, { status: RouteStatus.HIDDEN });
      return { route: null, anonymousId: anonymousId || null };
    }

    if (!route.analytics) route.analytics = { views: 0, shares: 0, gpxDownloads: 0 };
    route.analytics.views += 1;
    route.analytics.lastViewedAt = new Date().toISOString();
    await this.routeRepo.save(route);

    return { route, anonymousId: anonymousId || null };
  }

  /**
   * Получить статистику по всем маршрутам.
   */
  async getRouteStats(): Promise<{
    totalRoutes: number;
    activeRoutes: number;
    expiredRoutes: number;
    popularRoutes: Array<{
      id: string;
      title: string;
      views: number;
      shares: number;
      downloads: number;
    }>;
  }> {
    const totalRoutes = await this.routeRepo.count();
    const activeRoutes = await this.routeRepo.count({ 
      where: { status: RouteStatus.PUBLISHED, expiresAt: Not(IsNull()) } 
    });
    const expiredRoutes = totalRoutes - activeRoutes;

    // Популярные маршруты
    const popularRoutes = await this.routeRepo.find({
      where: { status: RouteStatus.PUBLISHED },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return {
      totalRoutes,
      activeRoutes,
      expiredRoutes,
      popularRoutes: popularRoutes.map(r => ({
        id: r.id,
        title: r.title,
        views: r.analytics?.views || 0,
        shares: r.analytics?.shares || 0,
        downloads: r.analytics?.gpxDownloads || 0,
      })),
    };
  }

  /**
   * Обновить маршрут.
   */
  async updateRoute(routeId: string, updates: UpdateRouteDto): Promise<RouteEntity | null> {
    const route = await this.routeRepo.findOne({ where: { id: routeId } });
    if (!route) return null;

    if (updates.title) route.title = updates.title;
    if (updates.description) route.description = updates.description;
    if (updates.status) route.status = updates.status;
    if (updates.hidden !== undefined) route.isArchived = updates.hidden;

    route.updatedAt = new Date();
    return this.routeRepo.save(route);
  }

  /**
   * Удаление маршрута.
   */
  async deleteRoute(routeId: string): Promise<boolean> {
    const result = await this.routeRepo.delete({ id: routeId });
    return !!result.affected;
  }
}