<script setup lang="ts">
/**
 * Icon — Lucide-backed icon wrapper.
 *
 * Why: Frontend used Material Symbols (font + glyph names like "arrow_back").
 * This component provides a drop-in replacement that renders a Lucide
 * SVG icon by the same name, with a fallback to MapPin for unknown names.
 *
 * Usage:
 *   <Icon name="explore" />
 *   <Icon name="favorite" filled class="text-2xl text-red-500" />
 *   <Icon :name="iconName" :class="..." :filled="..." />
 *
 * Notes:
 *  - $attrs (class, style) are bound to the outer span so external
 *    Tailwind utilities like `text-2xl` or inline `style="color:..."`
 *    keep controlling size and color.
 *  - `filled` toggles the `.filled` class on the wrapper, which uses
 *    CSS to set `fill: currentColor; stroke: none;` on the SVG.
 *  - In dev mode, an unknown icon name logs a `console.warn` and falls
 *    back to `MapPin` so the UI doesn't break.
 */
import { computed } from 'vue';
import * as LucideIcons from 'lucide-vue-next';
import type { Component } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Material Symbols name (e.g. "arrow_back", "favorite"). */
    name: string;
    /** When true, render a filled variant of the icon. */
    filled?: boolean;
  }>(),
  { filled: false },
);

defineOptions({ inheritAttrs: false });

/**
 * Map Material Symbols names to Lucide icon components.
 * Keep this table in sync with usages under `apps/frontend/src/`.
 */
const ICONS: Record<string, Component> = {
  // Navigation / arrows
  explore: LucideIcons.Compass,
  arrow_back: LucideIcons.ArrowLeft,
  arrow_forward: LucideIcons.ArrowRight,
  near_me: LucideIcons.Navigation,
  navigation: LucideIcons.Navigation,
  chevron_left: LucideIcons.ChevronLeft,
  chevron_right: LucideIcons.ChevronRight,
  expand_less: LucideIcons.ChevronUp,
  expand_more: LucideIcons.ChevronDown,

  // Map / location
  map: LucideIcons.Map,
  my_location: LucideIcons.MapPin,
  location_on: LucideIcons.MapPin,
  place: LucideIcons.MapPin,
  map_pin: LucideIcons.MapPin,
  'map-pin': LucideIcons.MapPin, // RouteDetailView uses the hyphenated form
  add_location_alt: LucideIcons.MapPinPlus,
  layers: LucideIcons.Layers,
  flag: LucideIcons.Flag,

  // Person / contact
  person: LucideIcons.User,
  account_circle: LucideIcons.UserCircle,
  how_to_reg: LucideIcons.UserCheck,
  telegram: LucideIcons.Send,
  share: LucideIcons.Share2,

  // Routes / transport
  route: LucideIcons.Route,
  directions_bike: LucideIcons.Bike,
  directions_walk: LucideIcons.PersonStanding,
  directions_car: LucideIcons.Car,
  directions_bus: LucideIcons.Bus,

  // Time
  clock: LucideIcons.Clock,
  schedule: LucideIcons.Clock,

  // Compass / exploration
  compass: LucideIcons.Compass,

  // Status / feedback
  star: LucideIcons.Star,
  check: LucideIcons.Check,
  close: LucideIcons.X,
  check_circle: LucideIcons.CircleCheck,
  error: LucideIcons.AlertCircle,
  reviews: LucideIcons.MessageSquareText,
  send: LucideIcons.Send,

  // Theme / ui
  light_mode: LucideIcons.Sun,
  dark_mode: LucideIcons.Moon,
  info: LucideIcons.Info,
  search: LucideIcons.Search,
  filter_alt: LucideIcons.Filter,
  edit: LucideIcons.Pencil,
  delete: LucideIcons.Trash2,
  add: LucideIcons.Plus,
  remove: LucideIcons.Minus,
  more_horiz: LucideIcons.MoreHorizontal,
  lightbulb: LucideIcons.Lightbulb,

  // Action verbs / content
  download: LucideIcons.Download,
  progress_activity: LucideIcons.Loader2,
  language: LucideIcons.Globe,
  public: LucideIcons.Globe,
  favorite: LucideIcons.Heart,
  touch_app: LucideIcons.Hand,
  auto_awesome: LucideIcons.Sparkles,
  open_in_new: LucideIcons.ExternalLink,
  code: LucideIcons.Code,
  storage: LucideIcons.Database,
  verified: LucideIcons.BadgeCheck,

  // Analytics / data viz
  analytics: LucideIcons.BarChart3,
  trending_up: LucideIcons.TrendingUp,
  trending_down: LucideIcons.TrendingDown,
  signal_cellular_alt: LucideIcons.Activity,
  show_chart: LucideIcons.LineChart,
  data_object: LucideIcons.Database,

  // Categories / landmarks
  account_balance: LucideIcons.Landmark,
  military_tech: LucideIcons.Medal,
  landscape: LucideIcons.Mountain,
  church: LucideIcons.Church,
  forest: LucideIcons.TreePine,
  museum: LucideIcons.Building2,
  water_drop: LucideIcons.Droplets,
  castle: LucideIcons.Castle,
  nature_people: LucideIcons.Trees,
  park: LucideIcons.Trees,
  emoji_events: LucideIcons.Trophy,
  auto_stories: LucideIcons.BookOpen,
  menu_book: LucideIcons.BookOpen,
  link: LucideIcons.Link,

  // More, found in AboutView / share flow
  privacy_tip: LucideIcons.ShieldCheck,
  photo_camera: LucideIcons.Camera,
  bug_report: LucideIcons.Bug,
  translate: LucideIcons.Languages,
  dataset: LucideIcons.Database,
  photo_library: LucideIcons.Images,
  offline_bolt: LucideIcons.Zap,
};

const FALLBACK: Component = LucideIcons.MapPin;

const resolved = computed<Component>(() => {
  const found = ICONS[props.name];
  if (found) return found;
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[Icon] Unknown Material Symbol name: "${props.name}" — falling back to MapPin`);
  }
  return FALLBACK;
});
</script>

<template>
  <span
    class="ms-icon"
    :class="[{ filled: filled }, $attrs.class]"
    :style="$attrs.style"
    aria-hidden="true"
  >
    <component :is="resolved" />
  </span>
</template>
