/* Canonical map states — machine-readable diagnostics for every map surface. */

export type MapDiagnostic =
  | 'loading-route'
  | 'route-not-found'
  | 'invalid-geometry'
  | 'map-container-not-ready'
  | 'style-or-tile-failure'
  | 'webgl-unavailable'
  | 'ready';

export interface MapState {
  diagnostic: MapDiagnostic;
  /** Human-readable description for user-facing UI. */
  message: string;
  /** Whether user action is expected (e.g. Retry). */
  actionable: boolean;
  /** Whether the last-valid map content should remain visible. */
  preserveLastContent: boolean;
}

export const MAP_STATES: Record<MapDiagnostic, MapState> = {
  'loading-route': {
    diagnostic: 'loading-route',
    message: 'Загружаем маршрут…',
    actionable: false,
    preserveLastContent: true,
  },
  'route-not-found': {
    diagnostic: 'route-not-found',
    message: 'Маршрут не найден. Соберите новый.',
    actionable: true,
    preserveLastContent: false,
  },
  'invalid-geometry': {
    diagnostic: 'invalid-geometry',
    message: 'Геометрия маршрута не задана или пуста.',
    actionable: false,
    preserveLastContent: false,
  },
  'map-container-not-ready': {
    diagnostic: 'map-container-not-ready',
    message: 'Карта ещё не готова.',
    actionable: false,
    preserveLastContent: false,
  },
  'style-or-tile-failure': {
    diagnostic: 'style-or-tile-failure',
    message: 'Ошибка загрузки тайлов или стиля.',
    actionable: true,
    preserveLastContent: true,
  },
  'webgl-unavailable': {
    diagnostic: 'webgl-unavailable',
    message: 'WebGL недоступен на этом устройстве. Попробуйте другой браузер.',
    actionable: false,
    preserveLastContent: true,
  },
  ready: {
    diagnostic: 'ready',
    message: '',
    actionable: false,
    preserveLastContent: true,
  },
};

export function createMapState(diagnostic: MapDiagnostic): MapState {
  return MAP_STATES[diagnostic];
}
