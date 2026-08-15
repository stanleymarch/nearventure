/* Route URL/deep-link helpers — single source for all surfaces. */

/**
 * Build the canonical web URL for a route.
 * Used for share, Telegram Mini App redirect, and bot deep links.
 */
export function routeWebUrl(routeId: string, publicBase?: string): string {
  const path = `/#/route/${encodeURIComponent(routeId)}`;
  if (!publicBase) return path;

  const base = new URL(publicBase);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    throw new Error('publicBase must be an HTTPS origin only.');
  }
  return `${base.origin}${path}`;
}

/**
 * Build the Mini App deep-link path.
 */
export function routeMiniAppUrl(routeId: string): string {
  return `/tg/#/route/${encodeURIComponent(routeId)}`;
}

/**
 * Build a `startapp` parameter for Telegram bot deep links.
 * Example: `route_a1b2c3d4`
 */
export function routeStartAppParam(routeId: string): string {
  return `route_${routeId}`;
}

/**
 * Build full Telegram bot share URL.
 * Uses `startapp` so the Mini App opens directly on the route.
 */
export function routeTelegramShareUrl(
  botUsername: string,
  appShortName: string,
  routeId: string,
): string {
  const param = routeStartAppParam(routeId);
  return `https://t.me/${botUsername}/${appShortName}?startapp=${param}`;
}

/**
 * Parse a Telegram `startapp` parameter and extract the route ID.
 * Returns null if the param doesn't match `route_<id>`.
 */
export function parseRouteStartParam(startapp: string): string | null {
  const match = startapp.match(/^route_(.+)$/);
  return match ? match[1] : null;
}

/**
 * Build the canonical share payload for native Share API.
 */
export function routeSharePayload(routeId: string, title: string, text: string) {
  return {
    title,
    text,
    url: routeWebUrl(routeId),
  };
}
