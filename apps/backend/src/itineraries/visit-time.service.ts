import { BadRequestException, Injectable } from '@nestjs/common';
import type { ItineraryPoi, RoutePlace, VisitMode } from './itinerary.types';
import type { RoutingProfile } from '../routing/routing.types';

export interface VisitTimeBreakdown { dwellMinutes: number; arrivalOverheadMinutes: number; primaryMinutes: number; marginalMinutes: number; }
const TIMES: Record<string, { glance: number; visit: number }> = {
  monument: { glance: 2, visit: 5 }, heritage: { glance: 3, visit: 8 }, architecture: { glance: 3, visit: 8 },
  religion: { glance: 3, visit: 9 }, museum: { glance: 5, visit: 30 }, viewpoint: { glance: 4, visit: 10 },
  nature: { glance: 5, visit: 18 }, park: { glance: 5, visit: 25 }, territory: { glance: 5, visit: 25 },
  sights: { glance: 3, visit: 8 }, service: { glance: 2, visit: 5 },
};
@Injectable()
export class VisitTimeService {
  validate(mode: VisitMode, customMinutes?: number): void {
    if (mode !== 'custom') { if (customMinutes !== undefined) throw new BadRequestException('customVisitMinutes is only valid for custom mode'); return; }
    if (!Number.isInteger(customMinutes) || customMinutes! < 1 || customMinutes! > 480) throw new BadRequestException('customVisitMinutes must be an integer between 1 and 480');
  }
  estimate(pois: ItineraryPoi[], mode: VisitMode, profile: RoutingProfile, customMinutes?: number): VisitTimeBreakdown {
    this.validate(mode, customMinutes);
    const included = pois.filter((poi) => poi.included);
    if (mode === 'pass_by' || !included.length) return { dwellMinutes: 0, arrivalOverheadMinutes: 0, primaryMinutes: 0, marginalMinutes: 0 };
    if (mode === 'custom') return { dwellMinutes: customMinutes!, arrivalOverheadMinutes: 0, primaryMinutes: customMinutes!, marginalMinutes: 0 };
    const times = included.map((poi) => this.categoryTime(poi.category, mode)).sort((a, b) => b - a);
    const primary = times[0];
    const independent = included.some((poi) => /^(museum|park|territory)$/.test(poi.category));
    const marginal = times.slice(1).reduce((sum, value, index) => sum + Math.ceil(value * (index === 0 ? .35 : index === 1 ? .2 : .1)), 0);
    const cappedMarginal = independent ? marginal : Math.min(marginal, Math.ceil(primary * .7));
    const overhead = this.overhead(profile, mode);
    return { dwellMinutes: overhead + primary + cappedMarginal, arrivalOverheadMinutes: overhead, primaryMinutes: primary, marginalMinutes: cappedMarginal };
  }
  apply(place: RoutePlace, profile: RoutingProfile): RoutePlace {
    const result = this.estimate(place.pois, place.visitMode, profile, place.customVisitMinutes);
    return { ...place, dwellMinutes: result.dwellMinutes, arrivalOverheadMinutes: result.arrivalOverheadMinutes };
  }
  private categoryTime(category: string, mode: 'glance' | 'visit'): number { return (TIMES[category] ?? TIMES.sights)[mode]; }
  private overhead(profile: RoutingProfile, mode: 'glance' | 'visit'): number {
    if (profile === 'car') return mode === 'visit' ? 5 : 2;
    if (profile === 'bike' || profile === 'mtb') return mode === 'visit' ? 2 : 1;
    return mode === 'visit' ? 1 : 0;
  }
}
