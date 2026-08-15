/**
 * Nearventure — кастомные Protomaps Flavor'ы для вело и пеших маршрутов.
 *
 * Protomaps Flavor = ~60 цветовых констант, которые управляют всеми слоями
 * базовой карты. Наследуем от встроенных LIGHT / DARK и переопределяем
 * outdoor-специфичные цвета.
 *
 * Использование:
 *   import { layers, namedFlavor } from '@protomaps/basemaps';
 *   import { CYCLING, PEDESTRIAN } from '@/styles/flavors';
 *
 *   const style = {
 *     layers: layers('protomaps', CYCLING, { lang: 'ru' }),
 *     ...
 *   };
 */
import type { Flavor } from '@protomaps/basemaps';

// ──────────────────────────────────────────────
// Вспомогательные цвета
// ──────────────────────────────────────────────

const C = {
  // Лес
  forest: '#2d5a27',
  forest_light: '#b8d9b0',
  forest_dark: '#6b9b6b',
  // Парк
  park: '#4caf50',
  park_light: '#c5e1c5',
  // Вода
  water: '#4fc3f7',
  water_dark: '#1a6e8a',
  // Тропы
  trail: '#8B6914',      // коричневый — лесные/грунтовые тропы
  trail_cycle: '#2e7d32', // зелёный — cycleway/велодорожка
  trail_cycle_light: '#66bb6a',
  // Дороги
  highway: '#8b0000',     // тёмно-красный — магистрали
  major_road: '#e8853c',  // оранжевый — основные дороги
  minor_road: '#d4c5a9',  // песочный — второстепенные
  // Фон
  earth: '#f5f0e8',       // тёплый бежевый — суша
  earth_dark: '#2d2d2d',
  earth_night: '#1a1a2e',
  // Застройка
  building: '#e0dcd0',
  building_dark: '#3a3a3a',
  industrial: '#d1dde1',
  // Подписи
  label_road: '#5a4a3a',
  label_water: '#1565c0',
  label_city: '#3a2a1a',
};

// ──────────────────────────────────────────────
// CYCLING — велосипедный стиль
// ──────────────────────────────────────────────
// Акцент на велодорожки, трейлы и покрытие.
// Cycleway — ярко-зелёные, трейлы — коричневые пунктиры,
// дороги — чёткая иерархия, парки/леса — естественные тона.

export const CYCLING: Flavor = {
  // Фон
  background: '#e8e4dd',
  earth: C.earth,

  // Природа
  park_a: '#c5e1c5',
  park_b: '#81c784',
  wood_a: '#c8e6c9',
  wood_b: '#66bb6a',
  scrub_a: '#dcedc8',
  scrub_b: '#aed581',
  glacier: '#e8eaf6',
  sand: '#f5f0e0',
  beach: '#fff3e0',

  // Вода
  water: C.water,

  // Инфраструктура
  hospital: '#fce4ec',
  industrial: C.industrial,
  school: '#fff8e1',
  pedestrian: C.trail,        // пешеходные зоны — коричневый оттенок
  pier: '#e0e0e0',
  buildings: C.building,
  aerodrome: '#e8eaf6',
  runway: '#fafafa',
  zoo: '#e8f5e9',
  military: '#f3e5f5',

  // Туннели
  tunnel_other_casing: '#cfcfcf',
  tunnel_minor_casing: '#cfcfcf',
  tunnel_link_casing: '#cfcfcf',
  tunnel_major_casing: '#cfcfcf',
  tunnel_highway_casing: '#cfcfcf',
  tunnel_other: '#eaeaea',
  tunnel_minor: '#eaeaea',
  tunnel_link: '#eaeaea',
  tunnel_major: '#eaeaea',
  tunnel_highway: '#eaeaea',

  // Дороги — основа для вело
  minor_service_casing: '#d4c5a9',
  minor_casing: C.minor_road,
  link_casing: '#e8853c',
  major_casing_late: '#e8853c',
  highway_casing_late: C.highway,

  other: C.trail,             // highway=path / track — коричневый
  minor_service: '#e0d5c0',   // service — светлый, не отвлекает
  minor_a: C.trail_cycle,     // cycleway — ЗЕЛЁНЫЙ (ключевой для вело)
  minor_b: C.trail,           // path/track/unsurfaced — коричневый
  link: '#e8853c',
  major_casing_early: '#d4a574',
  major: C.major_road,        // secondary/tertiary — оранжевый
  highway_casing_early: '#d4a574',
  highway: C.highway,         // trunk/motorway — красный

  // Ж/д и границы
  railway: '#9e9e9e',
  boundaries: '#bdbdbd',

  // Мосты
  bridges_other_casing: '#d4c5a9',
  bridges_minor_casing: '#d4c5a9',
  bridges_link_casing: '#e8853c',
  bridges_major_casing: '#e8853c',
  bridges_highway_casing: C.highway,
  bridges_other: C.trail,
  bridges_minor: C.trail_cycle,
  bridges_link: '#e8853c',
  bridges_major: C.major_road,
  bridges_highway: C.highway,

  // Подписи
  roads_label_minor: C.label_road,
  roads_label_minor_halo: '#ffffff',
  roads_label_major: C.label_road,
  roads_label_major_halo: '#ffffff',
  ocean_label: C.label_water,
  subplace_label: C.label_city,
  subplace_label_halo: '#ffffff',
  city_label: C.label_city,
  city_label_halo: '#ffffff',
  state_label: '#7a6a5a',
  state_label_halo: '#ffffff',
  country_label: '#5a4a3a',

  address_label: '#5a4a3a',
  address_label_halo: '#ffffff',
};

// ──────────────────────────────────────────────
// CYCLING_DARK — тёмный велосипедный стиль
// ──────────────────────────────────────────────

export const CYCLING_DARK: Flavor = {
  ...CYCLING,
  background: '#1a1a1a',
  earth: C.earth_night,

  park_a: '#1a3a1a',
  park_b: '#2a5a2a',
  wood_a: '#0a2a0a',
  wood_b: '#1a4a1a',
  scrub_a: '#1a2a1a',
  scrub_b: '#2a3a2a',

  water: C.water_dark,

  hospital: '#2a1a1a',
  industrial: '#2a2a2a',
  school: '#2a2a1a',
  pedestrian: '#5a4a2a',
  buildings: C.building_dark,
  aerodrome: '#2a2a2a',
  military: '#2a1a2a',

  tunnel_other_casing: '#3a3a3a',
  tunnel_minor_casing: '#3a3a3a',
  tunnel_link_casing: '#3a3a3a',
  tunnel_major_casing: '#3a3a3a',
  tunnel_highway_casing: '#3a3a3a',
  tunnel_other: '#2a2a2a',
  tunnel_minor: '#2a2a2a',
  tunnel_link: '#2a2a2a',
  tunnel_major: '#2a2a2a',
  tunnel_highway: '#2a2a2a',

  // В тёмной теме дороги — светлее
  minor_a: C.trail_cycle_light,
  minor_b: '#c4a050',

  roads_label_minor: '#c0b0a0',
  roads_label_major: '#d0c0b0',
  subplace_label: '#d0c0b0',
  city_label: '#e0d0c0',
  address_label: '#a09080',

  bridges_other_casing: '#3a3a3a',
  bridges_minor_casing: '#3a3a3a',
  bridges_link_casing: '#3a3a3a',
  bridges_major_casing: '#3a3a3a',
  bridges_highway_casing: '#3a3a3a',
};

// ──────────────────────────────────────────────
// PEDESTRIAN — пешеходный/походный стиль
// ──────────────────────────────────────────────
// Леса и парки — доминируют. Тропы — самые заметные, дороги — приглушены.
// Вода яркая, здания — минималистичные.
//
// Отличия от CYCLING:
//   • Highway=path/track — максимально заметные (толще, ярче)
//   • Cycleway — менее яркие (не отвлекают пешехода)
//   • Леса и парки — насыщеннее
//   • Дороги — тусклые, серые
//   • Здания — бледные, полупрозрачные

export const PEDESTRIAN: Flavor = {
  // Фон
  background: '#e8e4dd',
  earth: C.earth,

  // Природа — более насыщенная
  park_a: '#a8d8a8',
  park_b: '#66bb6a',
  wood_a: '#9ccc9c',
  wood_b: '#4caf50',
  scrub_a: '#c5e1a5',
  scrub_b: '#8bc34a',
  glacier: '#e8eaf6',
  sand: '#f5f0e0',
  beach: '#fff3e0',

  // Вода — яркая
  water: '#29b6f6',

  // Инфраструктура — приглушена
  hospital: '#fce4ec',
  industrial: '#e0e0e0',
  school: '#fff8e1',
  pedestrian: '#8B6914',    // пешеходные зоны
  pier: '#e0e0e0',
  buildings: '#e8e4dc',
  aerodrome: '#e8eaf6',
  runway: '#fafafa',
  zoo: '#e8f5e9',
  military: '#f3e5f5',

  // Туннели
  tunnel_other_casing: '#d0d0d0',
  tunnel_minor_casing: '#d0d0d0',
  tunnel_link_casing: '#d0d0d0',
  tunnel_major_casing: '#d0d0d0',
  tunnel_highway_casing: '#d0d0d0',
  tunnel_other: '#e8e8e8',
  tunnel_minor: '#e8e8e8',
  tunnel_link: '#e8e8e8',
  tunnel_major: '#e8e8e8',
  tunnel_highway: '#e8e8e8',

  // Дороги — тусклые, серые, не отвлекают
  minor_service_casing: '#c0c0c0',
  minor_casing: '#b0b0b0',
  link_casing: '#a0a0a0',
  major_casing_late: '#909090',
  highway_casing_late: '#707070',

  other: C.trail,             // path/track — коричневый, заметный
  minor_service: '#d0d0d0',
  minor_a: '#90a090',         // cycleway — серо-зелёный, неяркий
  minor_b: C.trail,           // path — активный коричневый
  link: '#a0a0a0',
  major_casing_early: '#b0b0b0',
  major: '#808080',           // secondary — серый
  highway_casing_early: '#b0b0b0',
  highway: '#606060',         // trunk/motorway — тёмно-серый

  // Ж/д и границы
  railway: '#bdbdbd',
  boundaries: '#bdbdbd',

  // Мосты
  bridges_other_casing: '#c0c0c0',
  bridges_minor_casing: '#c0c0c0',
  bridges_link_casing: '#a0a0a0',
  bridges_major_casing: '#909090',
  bridges_highway_casing: '#707070',
  bridges_other: C.trail,
  bridges_minor: '#90a090',
  bridges_link: '#a0a0a0',
  bridges_major: '#808080',
  bridges_highway: '#606060',

  // Подписи — приглушённые
  roads_label_minor: '#707070',
  roads_label_minor_halo: '#ffffff',
  roads_label_major: '#606060',
  roads_label_major_halo: '#ffffff',
  ocean_label: C.label_water,
  subplace_label: '#5a5a5a',
  subplace_label_halo: '#ffffff',
  city_label: '#3a3a3a',
  city_label_halo: '#ffffff',
  state_label: '#5a5a5a',
  state_label_halo: '#ffffff',
  country_label: '#3a3a3a',

  address_label: '#707070',
  address_label_halo: '#ffffff',
};

// ──────────────────────────────────────────────
// PEDESTRIAN_DARK — тёмный пешеходный
// ──────────────────────────────────────────────

export const PEDESTRIAN_DARK: Flavor = {
  ...PEDESTRIAN,
  background: '#1a1a1a',
  earth: C.earth_night,

  park_a: '#0a2a0a',
  park_b: '#1a4a1a',
  wood_a: '#0a2a0a',
  wood_b: '#1a4a1a',
  scrub_a: '#1a2a1a',
  scrub_b: '#2a3a2a',

  water: C.water_dark,

  hospital: '#2a1a1a',
  industrial: '#2a2a2a',
  school: '#2a2a1a',
  buildings: C.building_dark,
  aerodrome: '#2a2a2a',
  military: '#2a1a2a',

  // В тёмном — трейлы светлее
  other: '#c4a050',
  minor_b: '#c4a050',

  tunnel_other_casing: '#3a3a3a',
  tunnel_minor_casing: '#3a3a3a',
  tunnel_link_casing: '#3a3a3a',
  tunnel_major_casing: '#3a3a3a',
  tunnel_highway_casing: '#3a3a3a',
  tunnel_other: '#2a2a2a',
  tunnel_minor: '#2a2a2a',
  tunnel_link: '#2a2a2a',
  tunnel_major: '#2a2a2a',
  tunnel_highway: '#2a2a2a',

  roads_label_minor: '#909090',
  roads_label_major: '#a0a0a0',
  subplace_label: '#909090',
  city_label: '#b0b0b0',
  address_label: '#808080',

  bridges_other_casing: '#3a3a3a',
  bridges_minor_casing: '#3a3a3a',
  bridges_link_casing: '#3a3a3a',
  bridges_major_casing: '#3a3a3a',
  bridges_highway_casing: '#3a3a3a',
};

// ──────────────────────────────────────────────
// URBAN — городской пешеходный навигационный стиль
// ──────────────────────────────────────────────
// Минималистичная тёмная карта для режима «вести по маршруту».
// Всё, кроме нужного пешеходу, — максимально приглушено:
// дороги серые и тонкие, здания плоские и тёмные, вода приглушена.
// Пешеходные пути — самое яркое, что есть на карте.
// Акцент — на readability в солнечный день на телефоне.

export const URBAN: Flavor = {
  background: '#111111',
  earth: '#181818',

  // Природа — тёмная, ненавязчивая
  park_a: '#1a2a1a',
  park_b: '#2a3a2a',
  wood_a: '#0a1a0a',
  wood_b: '#1a2a1a',
  scrub_a: '#1a1a1a',
  scrub_b: '#2a2a1a',
  glacier: '#1e1e1e',
  sand: '#1e1e1e',
  beach: '#1a1a1a',

  // Вода — тёмно-синяя, не кричит
  water: '#1a3a5a',

  // Инфраструктура — минимум
  hospital: '#1a1a1a',
  industrial: '#1a1a1a',
  school: '#1a1a1a',
  pedestrian: '#4a7a4a',     // пешеходные зоны — мягкий зелёный
  pier: '#1a1a1a',
  buildings: '#222222',
  aerodrome: '#1a1a1a',
  runway: '#1e1e1e',
  zoo: '#1a1a1a',
  military: '#1a1a1a',

  // Туннели — чуть светлее фона
  tunnel_other_casing: '#2a2a2a',
  tunnel_minor_casing: '#2a2a2a',
  tunnel_link_casing: '#2a2a2a',
  tunnel_major_casing: '#2a2a2a',
  tunnel_highway_casing: '#2a2a2a',
  tunnel_other: '#1a1a1a',
  tunnel_minor: '#1a1a1a',
  tunnel_link: '#1a1a1a',
  tunnel_major: '#1a1a1a',
  tunnel_highway: '#1a1a1a',

  // Дороги — очень тёмные, почти невидимые
  minor_service_casing: '#2a2a2a',
  minor_casing: '#2a2a2a',
  link_casing: '#2a2a2a',
  major_casing_late: '#2a2a2a',
  highway_casing_late: '#2a2a2a',

  other: '#8a8a6a',           // path/track — серо-бежевый, заметный
  minor_service: '#3a3a3a',
  minor_a: '#3a5a3a',         // cycleway — тёмно-зелёный
  minor_b: '#7a7a5a',         // pedestrian path — заметный серо-жёлтый
  link: '#3a3a3a',
  major_casing_early: '#2a2a2a',
  major: '#3a3a3a',           // secondary — тёмно-серый
  highway_casing_early: '#2a2a2a',
  highway: '#4a4a4a',         // trunk/motorway — виден, не ярок

  // Ж/д и границы
  railway: '#3a3a3a',
  boundaries: '#3a3a3a',

  // Мосты — чуть светлее
  bridges_other_casing: '#2a2a2a',
  bridges_minor_casing: '#2a2a2a',
  bridges_link_casing: '#2a2a2a',
  bridges_major_casing: '#2a2a2a',
  bridges_highway_casing: '#2a2a2a',
  bridges_other: '#8a8a6a',
  bridges_minor: '#3a5a3a',
  bridges_link: '#3a3a3a',
  bridges_major: '#3a3a3a',
  bridges_highway: '#4a4a4a',

  // Подписи — белые, контрастные
  roads_label_minor: '#808080',
  roads_label_minor_halo: '#000000',
  roads_label_major: '#a0a0a0',
  roads_label_major_halo: '#000000',
  ocean_label: '#4a6a8a',
  subplace_label: '#d0d0d0',
  subplace_label_halo: '#000000',
  city_label: '#ffffff',
  city_label_halo: '#000000',
  state_label: '#a0a0a0',
  state_label_halo: '#000000',
  country_label: '#808080',

  address_label: '#707070',
  address_label_halo: '#000000',
};

// ──────────────────────────────────────────────
// URBAN_LIGHT — светлый городской пешеходный стиль
// ──────────────────────────────────────────────
// Минималистичный, светлый, пешеход-центричный.

export const URBAN_LIGHT: Flavor = {
  background: '#f5f5f5',
  earth: '#eeeeee',

  park_a: '#e0f0e0',
  park_b: '#c0e0c0',
  wood_a: '#e0ede0',
  wood_b: '#c0dcc0',
  scrub_a: '#eee8e0',
  scrub_b: '#ddd8d0',
  glacier: '#f0f0f0',
  sand: '#f0ede8',
  beach: '#f5f0e8',

  water: '#a0c8e8',

  hospital: '#f0ece8',
  industrial: '#e0e0e0',
  school: '#f0f0e8',
  pedestrian: '#8aba8a',
  pier: '#e0e0e0',
  buildings: '#e8e8e8',
  aerodrome: '#e8e8e8',
  runway: '#f0f0f0',
  zoo: '#e8f0e8',
  military: '#e8e8e8',

  tunnel_other_casing: '#d0d0d0',
  tunnel_minor_casing: '#d0d0d0',
  tunnel_link_casing: '#d0d0d0',
  tunnel_major_casing: '#d0d0d0',
  tunnel_highway_casing: '#d0d0d0',
  tunnel_other: '#e8e8e8',
  tunnel_minor: '#e8e8e8',
  tunnel_link: '#e8e8e8',
  tunnel_major: '#e8e8e8',
  tunnel_highway: '#e8e8e8',

  minor_service_casing: '#d0d0d0',
  minor_casing: '#d0d0d0',
  link_casing: '#c0c0c0',
  major_casing_late: '#c0c0c0',
  highway_casing_late: '#c0c0c0',

  other: '#8a8a6a',
  minor_service: '#d8d8d8',
  minor_a: '#a0c0a0',
  minor_b: '#b0b090',
  link: '#c0c0c0',
  major_casing_early: '#d0d0d0',
  major: '#b0b0b0',
  highway_casing_early: '#d0d0d0',
  highway: '#909090',

  railway: '#c0c0c0',
  boundaries: '#c0c0c0',

  bridges_other_casing: '#d0d0d0',
  bridges_minor_casing: '#d0d0d0',
  bridges_link_casing: '#c0c0c0',
  bridges_major_casing: '#c0c0c0',
  bridges_highway_casing: '#c0c0c0',
  bridges_other: '#8a8a6a',
  bridges_minor: '#a0c0a0',
  bridges_link: '#c0c0c0',
  bridges_major: '#b0b0b0',
  bridges_highway: '#909090',

  roads_label_minor: '#808080',
  roads_label_minor_halo: '#ffffff',
  roads_label_major: '#666666',
  roads_label_major_halo: '#ffffff',
  ocean_label: '#6890b0',
  subplace_label: '#444444',
  subplace_label_halo: '#ffffff',
  city_label: '#222222',
  city_label_halo: '#ffffff',
  state_label: '#666666',
  state_label_halo: '#ffffff',
  country_label: '#444444',

  address_label: '#888888',
  address_label_halo: '#ffffff',
};

// ──────────────────────────────────────────────
// NEUTRAL — нейтральная подложка (light)
// ──────────────────────────────────────────────
// Чистая базовая карта без акцентов.
// Для «подложки» под свои данные: POI, маршруты, треки.
// Ничего не отвлекает, все приглушено.

export const NEUTRAL: Flavor = {
  background: '#e8e8e8',
  earth: '#e0e0e0',

  park_a: '#d0d8d0',
  park_b: '#c0c8c0',
  wood_a: '#d8ddd8',
  wood_b: '#c8d0c8',
  scrub_a: '#d8d8d8',
  scrub_b: '#d0d0d0',
  glacier: '#e8e8e8',
  sand: '#e0e0e0',
  beach: '#e0e0d8',

  water: '#b8c8d8',

  hospital: '#dcd8d8',
  industrial: '#d0d0d0',
  school: '#d8d8d8',
  pedestrian: '#c8c8b8',
  pier: '#d8d8d8',
  buildings: '#d8d8d8',
  aerodrome: '#d8d8d8',
  runway: '#e0e0e0',
  zoo: '#d8d8d8',
  military: '#d8d0d0',

  tunnel_other_casing: '#c8c8c8',
  tunnel_minor_casing: '#c8c8c8',
  tunnel_link_casing: '#c8c8c8',
  tunnel_major_casing: '#c8c8c8',
  tunnel_highway_casing: '#c8c8c8',
  tunnel_other: '#d8d8d8',
  tunnel_minor: '#d8d8d8',
  tunnel_link: '#d8d8d8',
  tunnel_major: '#d8d8d8',
  tunnel_highway: '#d8d8d8',

  minor_service_casing: '#c8c8c8',
  minor_casing: '#c0c0c0',
  link_casing: '#b8b8b8',
  major_casing_late: '#b0b0b0',
  highway_casing_late: '#a0a0a0',

  other: '#b0b090',
  minor_service: '#d0d0d0',
  minor_a: '#b8b8b8',
  minor_b: '#b8b8a0',
  link: '#b8b8b8',
  major_casing_early: '#c0c0c0',
  major: '#a8a8a8',
  highway_casing_early: '#c0c0c0',
  highway: '#909090',

  railway: '#b8b8b8',
  boundaries: '#c0c0c0',

  bridges_other_casing: '#c8c8c8',
  bridges_minor_casing: '#c8c8c8',
  bridges_link_casing: '#b8b8b8',
  bridges_major_casing: '#b0b0b0',
  bridges_highway_casing: '#a0a0a0',
  bridges_other: '#b0b090',
  bridges_minor: '#b8b8b8',
  bridges_link: '#b8b8b8',
  bridges_major: '#a8a8a8',
  bridges_highway: '#909090',

  roads_label_minor: '#808080',
  roads_label_minor_halo: '#e8e8e8',
  roads_label_major: '#707070',
  roads_label_major_halo: '#e8e8e8',
  ocean_label: '#8090a0',
  subplace_label: '#505050',
  subplace_label_halo: '#e8e8e8',
  city_label: '#333333',
  city_label_halo: '#e8e8e8',
  state_label: '#606060',
  state_label_halo: '#e8e8e8',
  country_label: '#505050',

  address_label: '#808080',
  address_label_halo: '#e8e8e8',
};

// ──────────────────────────────────────────────
// NEUTRAL_DARK — нейтральная подложка (dark)
// ──────────────────────────────────────────────

export const NEUTRAL_DARK: Flavor = {
  background: '#181818',
  earth: '#1e1e1e',

  park_a: '#202020',
  park_b: '#282828',
  wood_a: '#1a1a1a',
  wood_b: '#222222',
  scrub_a: '#202020',
  scrub_b: '#282828',
  glacier: '#202020',
  sand: '#202020',
  beach: '#202020',

  water: '#283848',

  hospital: '#202020',
  industrial: '#202020',
  school: '#202020',
  pedestrian: '#383838',
  pier: '#202020',
  buildings: '#282828',
  aerodrome: '#202020',
  runway: '#242424',
  zoo: '#202020',
  military: '#202020',

  tunnel_other_casing: '#282828',
  tunnel_minor_casing: '#282828',
  tunnel_link_casing: '#282828',
  tunnel_major_casing: '#282828',
  tunnel_highway_casing: '#282828',
  tunnel_other: '#1a1a1a',
  tunnel_minor: '#1a1a1a',
  tunnel_link: '#1a1a1a',
  tunnel_major: '#1a1a1a',
  tunnel_highway: '#1a1a1a',

  minor_service_casing: '#2a2a2a',
  minor_casing: '#2a2a2a',
  link_casing: '#2a2a2a',
  major_casing_late: '#2a2a2a',
  highway_casing_late: '#2a2a2a',

  other: '#505050',
  minor_service: '#323232',
  minor_a: '#383838',
  minor_b: '#404040',
  link: '#353535',
  major_casing_early: '#2a2a2a',
  major: '#3a3a3a',
  highway_casing_early: '#2a2a2a',
  highway: '#484848',

  railway: '#3a3a3a',
  boundaries: '#3a3a3a',

  bridges_other_casing: '#282828',
  bridges_minor_casing: '#282828',
  bridges_link_casing: '#282828',
  bridges_major_casing: '#282828',
  bridges_highway_casing: '#282828',
  bridges_other: '#505050',
  bridges_minor: '#383838',
  bridges_link: '#353535',
  bridges_major: '#3a3a3a',
  bridges_highway: '#484848',

  roads_label_minor: '#606060',
  roads_label_minor_halo: '#181818',
  roads_label_major: '#808080',
  roads_label_major_halo: '#181818',
  ocean_label: '#486078',
  subplace_label: '#909090',
  subplace_label_halo: '#181818',
  city_label: '#b0b0b0',
  city_label_halo: '#181818',
  state_label: '#808080',
  state_label_halo: '#181818',
  country_label: '#909090',

  address_label: '#606060',
  address_label_halo: '#181818',
};

// ──────────────────────────────────────────────
// Хелпер: выбрать flavor по режиму и теме
// ──────────────────────────────────────────────

export type MapMode = 'cycling' | 'pedestrian' | 'urban' | 'neutral';

export function getFlavor(mode: MapMode, dark: boolean): Flavor {
  switch (mode) {
    case 'cycling':
      return dark ? CYCLING_DARK : CYCLING;
    case 'urban':
      return dark ? URBAN : URBAN_LIGHT;
    case 'neutral':
      return dark ? NEUTRAL_DARK : NEUTRAL;
    case 'pedestrian':
    default:
      return dark ? PEDESTRIAN_DARK : PEDESTRIAN;
  }
}
