import { createRouter, createWebHashHistory } from 'vue-router';
import { useTelegram } from '@/composables/useTelegram';

/**
 * Telegram appends `tgWebAppData`, `tgWebAppPlatform`, `tgWebAppThemeParams`
 * to the URL hash when opening a Mini App. vue-router's hash history would
 * misread them as a route path → blank page. The primary strip happens in
 * index.html (inline, before this module loads); this is a defensive
 * fallback for any HMR / edge case.
 */
function stripTelegramHashParams(): void {
  const raw = window.location.hash;
  if (!raw || !raw.includes('tgWebApp')) return;
  const content = raw.slice(1);
  const keep = content
    .split('&')
    .filter((p) => {
      const trimmed = p.replace(/^\/+/, '');
      return trimmed.length > 0 && !trimmed.startsWith('tgWebApp');
    });
  const clean = keep.join('&') || '/';
  window.history.replaceState(null, '', '#' + (clean.startsWith('/') ? clean : '/' + clean));
}
stripTelegramHashParams();

/**
 * Hash router — Mini Apps run from a single index.html served at /tg/, and
 * hash routing avoids server-side route config. Telegram's web_app button URL
 * can include a hash (#/poi?id=...) for deep entry.
 *
 * Deep links via start_param (t.me/bot/app?startapp=...) are parsed on launch
 * in App.vue and pushed here.
 */
const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
    {
      path: '/route',
      name: 'route-preview',
      component: () => import('@/views/RoutePreviewView.vue'),
    },
    {
      path: '/nearby',
      name: 'nearby',
      component: () => import('@/views/NearbyView.vue'),
    },
    {
      path: '/catalog',
      name: 'catalog',
      component: () => import('@/views/CatalogView.vue'),
    },
    {
      path: '/poi/:id',
      name: 'poi-detail',
      component: () => import('@/views/PoiDetailView.vue'),
    },
    {
      path: '/wizard',
      name: 'wizard',
      component: () => import('@/views/WizardView.vue'),
    },
    {
      path: '/draft/:id',
      name: 'draft',
      component: () => import('@/views/RoutePreviewView.vue'),
    },
  ],
});

/**
 * Telegram's tgWebApp* hash params leak into the route path under hash
 * history (the SDK appends and may restore them after our inline pre-strip).
 * This guard is the authoritative fix: it detects a polluted path and
 * redirects to the clean route, preserving any real query params.
 *
 * Examples handled:
 *   /tgWebAppData=...&tgWebAppPlatform=weba   →  /
 *   /wizard?lat=58&tgWebAppData=...          →  /wizard?lat=58
 */
router.beforeEach((to) => {
  if (!to.fullPath.includes('tgWebApp')) return;
  const [path, query = ''] = to.fullPath.split('?');
  // Path itself polluted (no real route) → home.
  if (path.includes('tgWebApp')) {
    return { path: '/', replace: true };
  }
  // Keep real query params, drop tgWebApp* ones.
  const cleanQuery = query
    .split('&')
    .filter((p) => p.length > 0 && !p.startsWith('tgWebApp'))
    .join('&');
  return { path: cleanQuery ? `${path}?${cleanQuery}` : path, replace: true };
});

/**
 * Navigate from a Telegram start_param string (e.g. "poi?id=abc" or
 * "auto?lat=..&lon=..&profile=bike"). Returns true if a route matched.
 */
export function navigateFromStartParam(param: string | undefined): boolean {
  if (!param) return false;
  // start_param uses the format "<screen>?<query>" (no leading #/).
  const [path, query = ''] = param.split('?');
  const map: Record<string, string> = {
    home: '/',
    route: '/route',
    nearby: '/nearby',
    catalog: '/catalog',
    auto: '/wizard',
    poi: '/poi',
    wizard: '/wizard',
  };
  const target = map[path] || ('/' + path);
  // Reconstruct hash with query so views can read start data.
  const hash = query ? `${target}?${query}` : target;
  router.push(hash);
  return true;
}

export default router;

// Re-export so screens can read start_param-driven query easily.
export { useTelegram };
