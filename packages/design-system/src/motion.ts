/* Nearventure motion tokens — single source for all animation timings. */
import type { Spring, Easing } from 'motion-v';

export const motion = {
  /** Imperceptible — layout only, no user-facing animation. */
  instant: 100,
  /** Micro-interaction — button press, check toggle. */
  fast: 160,
  /** Standard transition — panel open, route crossfade. */
  standard: 240,
  /** Expressive panels — Sheet/Drawer entrance. */
  panel: 320,

  /** Emphasized ease for content that arrives or leaves. */
  emphasizedEase: [0.16, 1, 0.3, 1] as Easing,

  /** Spring for selection / layout animations. */
  selectionSpring: { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 } satisfies Spring,

  /** Gentle reorder spring. */
  reorderSpring: { type: 'spring', stiffness: 320, damping: 32 } satisfies Spring,

  /** Max delay between sequenced child entrance. */
  maxStagger: 120,
} as const;

/** Reduced-motion variants — applied when user prefers reduced motion. */
export const reducedVariants = {
  /** Fade-only entrance (no scale/transform). */
  fadeIn: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
  /** Instant camera fit (no flyTo animation). */
  cameraInstant: { duration: 0 },
  /** Disabled stagger — all items appear at once. */
  noStagger: { delay: 0 },
} as const;
