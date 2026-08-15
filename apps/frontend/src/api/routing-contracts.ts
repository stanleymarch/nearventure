/** Shared routing capability and evidence contracts used by both browser clients. */
export type RoutingProfile = 'bike' | 'mtb' | 'foot' | 'car' | 'bike_touring' | 'mtb_leisure' | 'foot_scenic';

export const ROUTING_PROFILES: readonly RoutingProfile[] = [
  'bike', 'bike_touring', 'mtb', 'mtb_leisure', 'foot', 'foot_scenic', 'car',
];

/** Public GraphHopper profile names with user-facing labels. Keep aliases distinct. */
export const ROUTING_PROFILE_LABELS: Record<RoutingProfile, string> = {
  bike: 'Велосипед',
  bike_touring: 'Велотуринг',
  mtb: 'Горный велосипед (MTB)',
  mtb_leisure: 'MTB: прогулочный',
  foot: 'Пешком',
  foot_scenic: 'Пешком: живописный',
  car: 'Авто',
};

/** Parse a deep-link profile without collapsing supported aliases to a family. */
export function routingProfileFromQuery(value: unknown): RoutingProfile | null {
  return typeof value === 'string' && ROUTING_PROFILES.includes(value as RoutingProfile)
    ? value as RoutingProfile
    : null;
}

/** Monotonic token gate for retries: only the newest response may update UI state. */
export function createLatestRequestGate() {
  let latest = 0;
  return {
    begin: () => ++latest,
    isCurrent: (token: number) => token === latest,
  };
}

export interface RoutingHealth {
  available: boolean;
  /** Live GraphHopper profile names. Clients must not infer regional support. */
  profiles: string[];
}

export type RouteQualityWarning =
  | 'ROUTE_UNAVAILABLE'
  | 'ROUTE_NOT_NETWORK_CONFIRMED'
  | 'BUDGET_EXCEEDED'
  | 'LOOP_NOT_CLOSED'
  | 'UNAVOIDABLE_OUT_AND_BACK';

/** Backend-provided quality evidence. It is optional for legacy/plain routes. */
export interface RouteQuality {
  version?: string;
  verdict?: 'confirmed' | 'degraded' | 'unconfirmed';
  feasible?: boolean;
  networkConfirmed?: boolean;
  warnings?: RouteQualityWarning[];
}

export type RoadFactKind = 'road_class' | 'surface' | 'road_environment' | 'track_type';
export interface RoadFactValue {
  value: string;
  distance: number;
  /** Share calculated from route geometry by the server; it is not coverage. */
  share: number;
}
export interface RoadFact {
  kind: RoadFactKind;
  values: RoadFactValue[];
}

/** `null` means capability discovery is still in progress: do not claim a mode is unsupported. */
export function availableRoutingProfiles(health: RoutingHealth | null): RoutingProfile[] | null {
  if (health === null) return null;
  if (!health.available) return [];
  const live = new Set(health.profiles);
  return ROUTING_PROFILES.filter((profile) => live.has(profile));
}

/** Unknown health leaves a choice usable; a failed/unavailable health check never does. */
export function isRoutingProfileAvailable(profile: RoutingProfile, health: RoutingHealth | null): boolean {
  const available = availableRoutingProfiles(health);
  return available === null || available.includes(profile);
}

/** Keep a valid selected profile after a live capability update when possible. */
export function preserveRoutingProfile(
  selected: RoutingProfile,
  health: RoutingHealth | null,
): RoutingProfile | null {
  const available = availableRoutingProfiles(health);
  if (available === null) return selected;
  return available.includes(selected) ? selected : (available[0] ?? null);
}
