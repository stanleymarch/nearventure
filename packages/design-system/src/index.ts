/* Nearventure Design System — public API */

export { motion, reducedVariants } from './motion.js';
export type { MotionConfig } from 'motion-v';

export { POI_CATEGORIES, POI_CATEGORY_MAP, categoryStyle, catIcon } from './poi-categories.js';
export type { POICategory, PoiCategory } from './poi-categories.js';

export {
  routeWebUrl,
  routeMiniAppUrl,
  routeStartAppParam,
  routeTelegramShareUrl,
  parseRouteStartParam,
  routeSharePayload,
} from './route-links.js';
