import { Injectable } from '@nestjs/common';
import { GpxService } from '../routes/gpx.service';
import type { RoutingProfile } from '../routing/routing.types';

export interface BuiltRoute {
  geojson: { type: string; coordinates: number[][] | number[][][] } | null;
  distance: number; // m
  duration: number; // s
  ascend: number; // m
  descend: number; // m
  profile: RoutingProfile;
  /** Selected POIs in visiting order (for chat cards + Mini App). */
  pois: Array<{
    id: string; // poi_uuid
    name: string;
    category: string;
    lat: number;
    lon: number;
  }>;
  /** Optional itinerary context preserved from the draft for honest rendering. */
  totals?: { travelMinutes: number; stopMinutes: number; reserveMinutes: number; totalMinutes: number; feasible: boolean };
  warnings?: Array<{ code: string; message: string }>;
  selectionSummary?: import('../itineraries/itinerary.types').SelectionSummary;
}

/**
 * Presentation-shaped wrapper for the bot/Mini App: turns an itinerary draft
 * snapshot into a GPX and the `BuiltRoute` shape the chat formatter expects.
 *
 * The product selection itself lives in the canonical `AutoItineraryOptimizer`
 * (reached via `ItineraryDraftService`); this service no longer orchestrates a
 * separate greedy/GRASP pipeline — that legacy `buildAuto`/`nearRoutePois`
 * path was removed once the bot switched to the draft flow.
 */
@Injectable()
export class RouteBuilderService {
  constructor(private readonly gpx: GpxService) {}

  /** GPX string from the built route geometry. */
  buildGpx(route: BuiltRoute, title?: string): string {
    return this.gpx.generate(route.geojson as any, title);
  }
}
