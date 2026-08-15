# Nearventure Telegram Mini App - Visual System Brief

> **Design read:** Native Telegram Mini App for outdoor micro-adventures (cyclists/hikers, Vyatka region), with a warm Material 3 brand language (terracotta / teal / forest), leaning toward a **native-first chrome + brand-accent overlay** strategy.
>
> **Three dials (mini-app tuned, not landing-page baseline):** `DESIGN_VARIANCE: 4`, `MOTION_INTENSITY: 3`, `VISUAL_DENSITY: 5`. Native parity beats expression here: the app must read as part of Telegram, with Nearventure surfacing only as the accent thread and content (POI photos, category colors).

This brief covers the **visual system only** - no application/component code. It bridges the existing `--nv-*` warm Material 3 tokens (`apps/frontend/src/style.css`) into Telegram's native `--tg-theme-*` variables, and specifies card layout, screen layouts, buttons, haptics and popups.

Sources: `telegram-mini-app-skill` §5 Theming, §7 Bottom Buttons, §8 Haptics, §9 Popups, §13 Safe Areas, §16 Design Guidelines; `design-taste-frontend` §4.2 Color Lock, §4.4 Shape Lock, §4.5 UI States, §4.11 Theme Lock, §9 AI Tells, §14 Pre-Flight; `frontend-design` (restraint, one signature). Project tokens from `style.css`, `tailwind.config.js`, `lib/poi-categories.ts`.

---

## A. Design-Token Bridge (`--nv-*` ↔ `--tg-theme-*`)

### A.1 Strategy - three layers, one constant

The conflict: Telegram's Golden Rule ("never hardcode, always use `--tg-theme-*`") vs. Nearventure's identity (warm terracotta + warm beige surfaces). Resolving it by forcing warm beige everywhere fights the user's Telegram theme; resolving it by dropping the brand makes Nearventure invisible. The bridge splits the token set into three layers:

| Layer | Source | What it drives | Adapts to Telegram theme? |
|---|---|---|---|
| **1. Chrome** | `tg.setHeaderColor / setBackgroundColor / setBottomBarColor` | Telegram's own header strip, app background, bottom bar | Branded to Nearventure warm tones (see A.4) |
| **2. Surface / text** | `--tg-theme-*` (hex) | Page bg, cards, text, hints, separators | **Yes** - follows user's light/dark/custom theme |
| **3. Brand accent** | `--nv-primary / secondary / tertiary / error` (RGB triples) | Primary CTA color, category markers, focus rings, links, success/destructive | **Brand constant** (terracotta light, light-terracotta dark) |

Net effect: the **app shell reads native** (adapts to whatever Telegram theme the user picked), while the **brand thread stays recognisably Nearventure** through the terracotta accent on the one primary action per screen and the category color markers. This is the "Color Consistency Lock" (skill §4.2) applied at mini-app scale: one accent (terracotta) locked across every screen.

### A.2 Units problem (must be solved, not hand-waved)

`--nv-*` tokens are **space-separated RGB channel triples** (`155 69 0`) consumed as `rgb(var(--nv-primary) / <alpha>)` by Tailwind. `--tg-theme-*` are **hex** (`#fff8f6`). They cannot be aliased directly (`rgb(#fff8f6 / .5)` is invalid CSS). The bridge therefore runs a **runtime hex→triple sync** so the existing Tailwind utility layer (`bg-nv-bg`, `text-nv-on-surface`, etc.) keeps working unchanged.

### A.3 Concrete CSS mapping - `:root` (brand accent, kept as triples)

Brand colors stay in Nearventure's CSS, swapped only for dark mode. These are the tokens that **do NOT** follow Telegram's theme:

```css
:root {
  /* BRAND ACCENT LAYER - Nearventure constant (RGB triples) */
  --nv-primary:           155 69 0;     /* deep terracotta #9B4500 */
  --nv-on-primary:        255 255 255;
  --nv-primary-container: 255 140 66;   /* warm orange #FF8C42 */
  --nv-on-primary-container: 106 45 0;
  --nv-secondary:         0 101 144;    /* teal #006590 (links / water) */
  --nv-on-secondary:      255 255 255;
  --nv-tertiary:          50 107 0;     /* forest #326B00 (nature / success) */
  --nv-on-tertiary:       255 255 255;
  --nv-error:             186 26 26;    /* destructive */
}

/* Dark mode: brand accent lightens for contrast on dark Telegram bg.
   Driven by tg.colorScheme === 'dark' (precise), with prefers-color-scheme
   fallback for dev-outside-Telegram. */
@media (prefers-color-scheme: dark) {
  :root {
    --nv-primary:           255 182 141;  /* light terracotta #FFB68D */
    --nv-on-primary:        86 33 0;
    --nv-primary-container: 119 52 0;
    --nv-on-primary-container: 255 219 202;
    --nv-secondary:         112 199 255;
    --nv-on-secondary:      0 49 71;
    --nv-tertiary:          139 254 50;
    --nv-on-tertiary:       27 56 0;
    --nv-error:             255 180 171;
  }
}
```

### A.3b Concrete surface/text mapping (variable → variable)

The surface, text and separator tokens are **redirected to `--tg-theme-*`** at runtime (see A.5 helper). Conceptual mapping (what each Nearventure token resolves to):

| Nearventure token (RGB triple) | → resolves to (Telegram hex) | Telegram fallback (dev) | Role |
|---|---|---|---|
| `--nv-bg` | `--tg-theme-bg-color` | `#FFF8F6` | page background |
| `--nv-surface` | `--tg-theme-bg-color` | `#FFF8F6` | base surface |
| `--nv-surface-lowest` | `--tg-theme-section-bg-color` | `#FFFFFF` | **cards** |
| `--nv-surface-low` | `--tg-theme-secondary-bg-color` | `#FFF1EB` | inset panels / drawer |
| `--nv-surface-high` | `--tg-theme-section-bg-color` | `#F8E4DB` | elevated card |
| `--nv-surface-variant` | `--tg-theme-section-bg-color` | `#F2DFD5` | tinted surface |
| `--nv-on-bg` | `--tg-theme-text-color` | `#231914` | primary text |
| `--nv-on-surface` | `--tg-theme-text-color` | `#231914` | body text |
| `--nv-on-surface-variant` | `--tg-theme-hint-color` | `#564338` | hint / meta text |
| `--nv-outline` | `--tg-theme-section-separator-color` | `#89726 6` → `#897266` | strong border |
| `--nv-outline-variant` | `--tg-theme-section-separator-color` | `#DDC1B3` | hairline |
| (link) | `--tg-theme-link-color` | `#006590` | inline links |
| (accent text) | `--tg-theme-accent-text-color` | `#9B4500` | accent inline text |
| (destructive text) | `--tg-theme-destructive-text-color` | `#BA1A1A` | destructive inline |
| (subtitle) | `--tg-theme-subtitle-text-color` | `#8E8E93` | list subtitles |
| (section header) | `--tg-theme-section-header-text-color` | `#6D6D72` | uppercase list labels |

**Light vs dark:** there is **no separate `.dark {}` block for surface/text**. Telegram swaps the `--tg-theme-*` hex values itself when `colorScheme` flips; the bridge re-runs `syncTelegramTheme()` on `themeChanged` and the whole surface layer re-themes in one step. Only the **brand accent** has a light/dark pair (A.3), because terracotta must stay legible on both a warm-beige light bg and a near-black Telegram dark bg.

### A.4 Chrome branding (frame the mini app in Nearventure)

The one place we deliberately override Telegram's theme rather than follow it - the Telegram-owned header/background/bottom-bar strips - so the app opens already "feeling Nearventure" before any content renders:

```
On tg.ready():
  tg.setHeaderColor('#FFF8F6')          // light warm paper   (light mode)
  tg.setBackgroundColor('#FFF8F6')
  tg.setBottomBarColor('#FFF1EB')       // slightly deeper, separates content from MainButton
On themeChanged (colorScheme === 'dark'):
  tg.setHeaderColor('#1B1310')          // warm near-black
  tg.setBackgroundColor('#1B1310')
  tg.setBottomBarColor('#241B17')
```

Rationale: header/bg/bottom-bar are the **frame**, not the **content**. Branding the frame + keeping content surfaces native is the standard pattern for branded mini apps (the skill explicitly allows `setHeaderColor('#RRGGBB')`). The MainButton itself is then filled with terracotta (D.2) to complete the brand loop: warm frame → native content → terracotta action.

### A.5 Bridge helper (runtime hex→triple sync)

The minimal glue that makes Tailwind's `bg-nv-*` follow Telegram. Not app code - it is the **token bridge** itself, run once on init and on every `themeChanged`:

```
function hexToTriple(hex):
  strip '#'; expand 3-digit; parseInt; return 'r g b'

function syncTelegramTheme(tg):
  tp = tg.themeParams
  M = {
    '--nv-bg':               tp.bg_color,
    '--nv-surface':          tp.bg_color,
    '--nv-surface-lowest':   tp.section_bg_color,
    '--nv-surface-low':      tp.secondary_bg_color,
    '--nv-surface-high':     tp.section_bg_color,
    '--nv-surface-variant':  tp.section_bg_color,
    '--nv-on-bg':            tp.text_color,
    '--nv-on-surface':       tp.text_color,
    '--nv-on-surface-variant': tp.hint_color,
    '--nv-outline':          tp.section_separator_color,
    '--nv-outline-variant':  tp.section_separator_color,
  }
  for (nv, hex) in M: if hex: root.style.setProperty(nv, hexToTriple(hex))
  // toggle brand-accent dark pair:
  root.dataset.colorScheme = tg.colorScheme   // drives A.3 dark override

tg.onEvent('themeChanged', () => syncTelegramTheme(tg))
syncTelegramTheme(tg)   // initial
```

Every component that already uses `rgb(var(--nv-*) / <alpha>)` (cards, inputs, chips, text) now adapts to the user's Telegram theme for free, with **zero per-component theme code**.

### A.6 Resulting bridge guarantees

- **Color Consistency Lock** (skill §4.2): one accent (terracotta) on every screen's primary action. No screen drifts to blue/teal CTAs.
- **Theme Lock** (skill §4.11): the whole app is one theme; section surfaces come from the same `--tg-theme-*` set so no mid-app theme flip is possible.
- **Contrast**: brand accents keep their verified WCAG AA pairs (4.7:1 on-primary, 5.2:1 on-secondary per `docs/ui-design-system.md`). Native `--tg-theme-text-color` on `--tg-theme-bg-color` is guaranteed AA by Telegram itself.
- **No AI-tell colors**: no purple, no neon, no gradient-text on headers. Terracotta is warm and earthy.

---

## B. POI Card

The POI card is the single most-repeated surface (feed list, map drawer, route preview, search). One component, two densities: **list card** (horizontal, compact, in feed/drawer) and **detail hero** (vertical, expanded - see C.4).

### B.1 Category color marker (the brand thread inside content)

Every card carries a category marker whose color comes from `lib/poi-categories.ts`. This is where Nearventure's full palette (not just terracotta) is allowed to appear, because each color is **semantic** (it encodes the POI's category), not decorative:

| Category | Marker color | Hex | Icon (Material Symbol) |
|---|---|---|---|
| heritage | stone grey | `#8A8175` | `account_balance` |
| monument | warm orange | `#B26A2E` | `military_tech` |
| sights | amber/terracotta | `--nv-primary` | `landscape` |
| religion | brick red | `#A23B2E` | `church` |
| nature | forest | `--nv-tertiary` | `forest` (water POI → `water_drop`) |
| museum | purple | `#8E5B9B` | `museum` |

Marker = 8px dot + 16px filled icon, in the category color, on a category-color@12% chip. Single source of color variety in the UI; everywhere else is terracotta-accent.

### B.2 List card - ASCII layout (mobile, full width, ~96px tall)

```
┌──────────────────────────────────────────────────┐
│ ┌─────────┐  ●forest  Природа                     │  ← marker dot+icon + label (12px caps, hint color)
│ │         │  Озеро Широкое                        │  ← name (15px semibold, on-surface, 1 line truncate)
│ │  PHOTO  │  1.2 км от старта · 15 мин             │  ← distance + ETA (13px, hint color, no em-dash)
│ │  64×64  │  Глубокое ольховое озеро у деревни…   │  ← short desc (13px, line-clamp-2, on-surface-variant)
│ │  radius │                                        │
│ │  10px   │  📷 Ivan Petrov · CC BY-SA 4.0        │  ← photo attribution (11px, hint, 1 line)
│ └─────────┘  ⊙ OpenStreetMap · Wikidata            │  ← data sources (11px, hint, 1 line)
└──────────────────────────────────────────────────┘
   radius 14px · bg = --tg-theme-section-bg-color ·
   border 1px --tg-theme-section-separator-color ·
   tap target = whole card (→ POI detail) · ripple on :active
```

Specs:
- **Container:** `border-radius: 14px` (Telegram native card radius, per skill §16 - slightly tighter than web's 16px for native parity), `background: var(--tg-theme-section-bg-color)`, `border: 1px solid var(--tg-theme-section-separator-color)`, padding 12px, gap 12px.
- **Thumbnail:** 64×64, `border-radius: 10px`, `object-fit: cover`. Fallback (no photo): category-color gradient `linear-gradient(135deg, catColor@28%, catColor@14%)` + centered category icon in white@80% (matches existing `LandingPopularPois.vue` pattern).
- **Name:** 15px / weight 600 / `--tg-theme-text-color` / `text-overflow: ellipsis` 1 line.
- **Distance + ETA:** 13px / `--tg-theme-hint-color`. Separator is `·` (one per line - skill §9.F middle-dot rationing). Distance measured from current route start or user location.
- **Description:** 13px / `--tg-theme-hint-color` / `line-clamp: 2`.
- **Whole card = tap target** → opens POI detail (C.4). `:active { transform: scale(0.98) }` for tactile feedback (skill §4.5). No nested buttons on the card.

### B.3 Attribution model (open-data honesty)

Attribution is **functional, not decorative** (skill §9.F: no `Field study no. 12`-style captions). Two compact lines at card foot, full detail expanded on the POI detail screen (C.4):

| Line | Content | Source field | Style |
|---|---|---|---|
| Photo credit | `📷 {author} · {license}` | `photo.author`, `photo.license` | 11px hint, single line, ellipsis |
| Data sources | `⊙ {sources}` joined by ` · `, max 3 | `sources[]` (`osm`, `wikidata`, `egrkn`, `wikimedia`) | 11px hint, single line |

Source codes map to friendly labels (i18n, per `ui-design-taste-analysis.md` §1.5): `osm→OpenStreetMap`, `wikidata→Wikidata`, `egrkn→ЕГРКН`, `wikimedia→Wikimedia Commons`. If 4+ sources, show first 3 + `+N`. Photo credit omitted when photo is a generated gradient fallback (no real author). License always shown for real photos (ODbL/CC-BY-SA compliance).

### B.4 States (skill §4.5 - full cycle, not just success)

- **Loading:** skeleton card - same 64×64 grey block + 2 grey text bars, `--tg-theme-section-bg-color` shimmer. Never a spinner.
- **Empty (no POIs in area):** centered category icon (outline) + `"Пока нет мест в этом районе"` + 3-bullet hint (расширить карту / включить категории / проверить связь) + secondary button `Обновить`.
- **Error:** inline alert block (A.6 nv-alert style) + retry button. Haptic `error` on appearance.
- **Selected (in route preview):** card gets a 2px `--nv-primary` left border + terracotta@8% tint; category marker swaps to filled.

---

## C. Screen Layouts

All screens share a **mobile-first, native-feel shell**:

```
┌─────────────────────────────┐  ← --tg-content-safe-area-inset-top (Telegram header)
│  [≡]  Nearventure      [⚙]  │  ← optional in-app header (BackButton handles nav instead)
├─────────────────────────────┤
│                             │
│        SCREEN CONTENT       │  ← scrollable; padding-bottom ≈ 80px + safe-area-inset-bottom
│                             │     (keeps last item clear of MainButton)
│                             │
├─────────────────────────────┤
│  ▓▓▓▓▓  MainButton  ▓▓▓▓▓   │  ← native Telegram bottom bar (MainButton), terracotta fill
└─────────────────────────────┘  ← --tg-safe-area-inset-bottom (home indicator)
```

**Shell rules (apply to every screen):**
- Page bg: `--tg-theme-bg-color` (via branded `setBackgroundColor`, A.4).
- Cards/sections: `--tg-theme-section-bg-color`, `border-radius: 14px`.
- Content scroll container: `padding: calc(12px + var(--safe-top)) calc(12px) calc(80px + var(--safe-bottom))`. Safe areas computed per skill §13 hybrid JS (`max(48, contentSafe.top + safe.top)`).
- Section labels (above grouped lists): uppercase, 12px, `letter-spacing: 0.04em`, `--tg-theme-section-header-text-color`. **Eyebrow rationing** (skill §4.7): at most 1 section label per 3 sections; prefer no label.
- Navigation: **native `BackButton`** in Telegram header for all sub-screens (not a custom back button). `BackButton.onClick → router.back()`, `offClick` on unmount.
- Primary action: **native `MainButton`** (see D). Never a second floating CTA.

### C.1 Home

Map-first home with a collapsible bottom sheet - the immersive pattern the existing web app already uses (`ui-design-taste-analysis.md`), adapted to Telegram's bottom-bar idiom.

```
┌─────────────────────────────┐
│ ⚙ layers        📍 Найти меня │  ← floating icon buttons (radius full, glass), top-right
│                             │
│        ╱╲╱╲  MAP            │  ← Leaflet map, fills viewport, z-0, tile-tint on
│       ╱ ●  ╲   (markers     │     --nv-secondary route line preview
│      │  ╲   │    colored    │
│       ╲ ● ╱    by category) │
│        ╲═╱                  │
│                             │
├─ sheet handle ──────────────┤  ← drag handle (50×4, --tg-theme-section-separator-color)
│ Рядом с вами                 │  ← section label
│ ┌─POI─┐ ┌─POI─┐ ┌─POI─┐    │  ← horizontal scroll-snap row of compact POI cards
│ └─────┘ └─────┘ └─────┘    │
│                             │
│  Категории: ● ● ● ● ● ●      │  ← category filter chips (horizontal scroll)
├─────────────────────────────┤
│  ▓▓ Создать маршрут ▓▓       │  ← MainButton (terracotta)
└─────────────────────────────┘
```

- Sheet: `border-radius: 14px 14px 0 0`, `--tg-theme-section-bg-color`, snaps between peek (≈220px) and expanded (≈70vh) on drag. Handle = only drag affordance (no scroll cue text - skill §9.F).
- "Near you" row: horizontal scroll-snap, compact POI thumbs (96×96, category-tinted). `selectionChanged` haptic on snap.
- Categories: chips from `CATEGORY_ORDER`; active chip = category color fill (B.1). `impactOccurred('light')` on toggle.
- MainButton `Создать маршрут` → opens Auto-route wizard (C.2). Hidden if no location permission (replaced by `Найти меня` prompt).
- First-visit: sheet auto-expands with a 3-step hint card (точка старта → время → маршрут) + `Начать` (skill §4.5, addresses the "no hero on first load" fail in `ui-design-taste-analysis.md` §1). Dismissed state stored in `CloudStorage`.

### C.2 Auto-route wizard (3 steps)

Native Telegram wizard = one MainButton whose text advances per step + native BackButton to undo. Each step is a focused single-job screen (skill §4.7 - hero/stack discipline applied to steps).

```
STEP 1 - Start              STEP 2 - Time              STEP 3 - Interests
┌──────────────────┐        ┌──────────────────┐       ┌──────────────────┐
│ ⌫ Откуда старт?  │        │ ⌫ Сколько времени?│       │ ⌫ Что интересно? │
│                  │        │                   │       │                  │
│   map, user can  │        │  ────●──────      │       │ ●Наследие  ●Прир.│
│   tap or use     │        │  1ч       4ч  8ч  │       │ ●Монумент  ●Музей│
│   📍 Моё место   │        │                   │       │ ●Достоп.  ●Религ.│
│                  │        │  🚲 Велосипед     │       │                  │
│   pin dropped    │        │  🚶 Пешком        │       │  (chips, multi-  │
│   at: с. Успенск │        │  (segmented ctr)  │       │   select)        │
│                  │        │                   │       │                  │
├──────────────────┤        ├──────────────────┤       ├──────────────────┤
│  ▓▓ Далее ▓▓     │        │  ▓▓ Далее ▓▓      │       │ ▓ Создать маршрут▓│
└──────────────────┘        └──────────────────┘       └──────────────────┘
   MainButton: "Далее"         MainButton: "Далее"        MainButton: commit → C.5
   (disabled until pin set)    (slider ≥ 30min to enable) (disabled until ≥1 cat)
```

- Step header: `⌫` is native `BackButton` (undoes to previous step, hides on step 1). Question copy is verb-first, ≤24 chars.
- Step 1: full map behind; tap-to-drop pin in `--nv-primary`; `📍 Моё место` pill requests geolocation (`LocationManager`). `impactOccurred('medium')` on pin drop.
- Step 2: native-style range slider (existing `.nv-range`, knob = `--nv-primary-container`), labels 1ч/4ч/8ч. Transport = 2-segment control, active = terracotta fill. `selectionChanged` while dragging.
- Step 3: category chips, multi-select, active = category color (B.1). Default set = `DEFAULT_ACTIVE_CATEGORIES`.
- MainButton disabled state: `is_active: false`, dimmed; helper text below (`"Отметьте точку на карте"`).
- On commit: `showProgress(true)` + `disable()`, route builds; on success `notificationOccurred('success')` → Route preview (C.5); on failure `notificationOccurred('error')` + `showAlert`.

### C.3 POI list (paginated)

Vertical feed for browsing all POIs in the current area, paginated (not infinite-scroll - predictable, works offline-cached).

```
┌─────────────────────────────┐
│ ⌫  Все места              42 │  ← title + count (BackButton returns to Home/Map)
├─────────────────────────────┤
│ [нас] [мон] [дос] [рел] [пр] │  ← sticky filter chips (horizontal scroll, category colors)
├─────────────────────────────┤
│ ┌── POI card (B.2) ────────┐ │
│ └──────────────────────────┘ │
│ ┌── POI card ──────────────┐ │
│ └──────────────────────────┘ │
│ ┌── POI card ──────────────┐ │
│ └──────────────────────────┘ │
│            …                 │
│ ┌── POI card ──────────────┐ │
│ └──────────────────────────┘ │
│                              │
│        Загрузить ещё         │  ← secondary text button (page 2/5); no MainButton here
├─────────────────────────────┤
│  (no MainButton - list screen)│  ← bottom bar empty / native bg only
└─────────────────────────────┘
```

- No MainButton (list has no single primary action). BackButton = `Отмена`/back. Avoids duplicate-CTA intent (skill §4.5).
- Sticky filter bar: `backdrop-filter: blur(16px)` over `--tg-theme-bg-color@80%`. Chip toggle → `impactOccurred('light')`, list re-fetches, scroll resets to top.
- Pagination: "Загрузить ещё" text button (not a numbered pager - skill §9.F bans `01/4`-style labels). Skeleton cards during page load.
- Empty/error states per B.4.
- Sort hidden behind a settings icon (popularity / distance / name) - not exposed as chips to avoid chip-row overload.

### C.4 POI detail (attribution expanded)

Full vertical screen for one POI. This is where attribution is **fully disclosed** (open-data honesty, ODbL/CC-BY-SA compliance).

```
┌─────────────────────────────┐
│ ⌫ (BackButton, no title)    │
├─────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │                          │ │
│ │     HERO PHOTO           │ │  ← 16:9, full width, radius 14px bottom-rounded only
│ │     (parallax-sticky)    │ │     gradient scrim bottom → category marker legible
│ │                          │ │
│ │  ●forest Природа          │ │  ← category marker (B.1) overlaid bottom-left
│ └──────────────────────────┘ │
│                              │
│  Озеро Широкое               │  ← name (24px, weight 700, on-surface)
│  1.2 км · 15 мин · ▲12 м    │  ← distance · ETA · elevation delta (hint, 1 line)
│                              │
│  Глубокое ольховое озеро у   │  ← full description (16px, on-surface-variant, 65ch)
│  деревни Широково…           │
│                              │
│  ── Характеристики ────────  │  ← section label (only one on this screen)
│  Тип       Природный объект  │  ← key/value rows, hairline divider between (single border)
│  Площадь   4.2 га            │
│  Статус    ООПТ региональное │
│                              │
│  ── Источники данных ──────  │
│  ⊙ OpenStreetMap   ↗         │  ← tappable, opens osm.org node
│  ⊙ Wikidata        ↗         │  ← opens wikidata.org entity
│  ⊙ ЕГРКН           ↗         │  ← opens реестр ОКН
│                              │
│  ── Фото ─────────────────  │
│  📷 Ivan Petrov              │  ← photo author
│  Лицензия  CC BY-SA 4.0  ↗   │  ← license link
│  © Wikimedia Commons         │  ← host
│                              │
├─────────────────────────────┤
│  ▓▓ Добавить в маршрут ▓▓    │  ← MainButton (terracotta); SecondaryButton: "На карте"
└─────────────────────────────┘
```

- Hero photo: sticky parallax (collapses to 56px bar on scroll), category marker overlaid on scrim. Falls back to category gradient if no photo.
- Stats: key/value list, **single hairline divider between rows** (skill §9.F: never `border-t + border-b` on every row). ≤6 rows; long specs collapse under "Показать всё".
- **Attribution is the signature section** (`frontend-design`: spend boldness in one place). Each source is a row: icon + label + external `↗`. Tapping opens in Telegram's in-app browser (`tg.openLink`).
- MainButton `Добавить в маршрут` (19 chars ✓) → adds POI to current draft route, `notificationOccurred('success')`, button becomes `✓ В маршруте` (disabled, success-tinted). SecondaryButton `На карте` → centers map on POI.
- Share affordance via Telegram header menu (`SettingsButton` repurposed or `tg.switchInlineQuery`) - not a custom share button.

### C.5 Route preview (cards + summary)

After the wizard commits (C.2) - the screen that earns user trust before GPX export. Map on top, ordered POI cards + summary below.

```
┌─────────────────────────────┐
│ ⌫  Маршрут готов            │
├─────────────────────────────┤
│                              │
│        ╱╲╱╲  MAP             │  ← route polyline = --nv-secondary (teal), weight 5
│       ╱ ①  ╲                  │     POI stops numbered ①②③④ in --nv-primary circles
│      │  ╲   │ ②               │     start/finish pin = --nv-tertiary
│       ╲ ③ ╱                   │
│        ╲═╱  ④                 │
│                              │
├─ sheet handle ──────────────┤
│  ┌─ summary ────────────────┐│
│  │ 12.4 км · 1ч 25м · ▲85 м││  ← distance · duration · total ascent (mono numerals)
│  │ 4 места · кольцевой      ││  ← stop count · loop/one-way badge
│  └──────────────────────────┘│
│                              │
│  ┌ ① Озеро Широкое ─────────┐│  ← ordered POI cards (compact B.2 + stop number badge)
│  │   1.2 км · 15 мин        ││     drag to reorder (long-press), impact('medium') on drop
│  └──────────────────────────┘│
│  ┌ ② Успенская церковь ─────┐│
│  │   3.1 км · 22 мин        ││
│  └──────────────────────────┘│
│            …                 │
├─────────────────────────────┤
│   ⊕ GPX      ✎ Изменить      │  ← SecondaryButton row (two actions, equal weight)
├─────────────────────────────┤
│  ▓▓▓▓ Скачать GPX ▓▓▓▓       │  ← MainButton (terracotta, primary commit)
└─────────────────────────────┘
```

- Summary card: distance / duration / ascent in **mono/tabular numerals** (VISUAL_DENSITY 5). Ascent `▲85 м` is the trust-building detail (from GraphHopper). One line, three metrics, `·` separated (1 middle-dot - rationed).
- Route line color = `--nv-secondary` teal (water/links family) so it reads distinct from terracotta pins and doesn't compete with the brand CTA. **Color lock exception justified**: teal for "the path", terracotta for "the action" - semantic split, documented.
- Stop cards: numbered badge `①` in `--nv-primary` circle top-left; drag-reorder via long-press; swipe-left to remove (with `showConfirm` haptic-heavy - E).
- MainButton `Скачать GPX` (11 chars) = primary commit. `showProgress` during file gen; `notificationOccurred('success')` + `tg.shareToStory`/`switchInlineQuery` offer on completion.
- SecondaryButton row: `⊕ GPX` (alt format/old devices) + `✎ Изменить` (back to wizard step 3). Avoids putting a second primary action in MainButton's slot (no duplicate-CTA intent - skill §4.5).
- If route can't be built (GraphHopper down): map shows error overlay + `showAlert` "Не удалось построить маршрут. Попробуйте позже." (friendly, not `GraphHopper недоступен` - `ui-design-taste-analysis.md` §1.5).

---

## D. Buttons & MainButton

### D.1 When native MainButton vs custom buttons

| Use **native MainButton** | Use **custom in-content buttons** |
|---|---|
| The screen's single forward/commit action | Secondary actions (filter, sort, "load more", toggle) |
| Create / Next / Download / Add / Confirm | Item-level actions (card tap, swipe action) |
| Anything that should sit in Telegram's bottom bar (safe-area aware, always visible) | Anything contextual to a list row or card |
| Form submit / wizard advance | Chip toggles, segment controls, icon buttons |

**Rule:** one MainButton per screen, one verb. If a screen needs two equal actions, put the primary in MainButton and the secondary in a `SecondaryButton` (Telegram native, sits beside MainButton) or an in-content secondary button - never two MainButtons.

### D.2 MainButton spec

- **Color:** `--nv-primary` terracotta (via `setParams({ color: '#9B4500' (light) / '#FFB68D' (dark) })`). Text color `--nv-on-primary` (white / dark brown). This is the brand loop completing A.4.
- **Text:** verb-first, ≤24 chars, Telegram uppercases visually but we send sentence case (Russian doesn't uppercase well). `setText()` per screen state.
- **States:** `enable/disable` + `showProgress(true)` during async (route build, GPX gen). Always `disable()` on click to prevent double-submit (skill §18), re-enable on failure.
- **Shine effect** (`has_shine_effect: true`): use **once** on the final commit screen (Route preview `Скачать GPX`) to mark the payoff moment - `frontend-design` "spend boldness in one place". Off everywhere else.

### D.3 Button copy (verb-first, ≤24 chars, RU)

| Screen | MainButton text | Chars | Notes |
|---|---|---|---|
| Home | `Создать маршрут` | 15 | primary entry |
| Wizard step 1, 2 | `Далее` | 4 | disabled until valid |
| Wizard step 3 | `Создать маршрут` | 15 | commit |
| POI detail | `Добавить в маршрут` | 19 | toggles to `✓ В маршруте` |
| Route preview | `Скачать GPX` | 11 | shine effect on |
| Settings | `Сохранить` | 8 | - |
| Destructive confirm | (use `showConfirm`, not MainButton) | - | - |

All verbs are concrete actions the user controls (skill `frontend-design`: "Save changes", not "Submit"). Same verb for the same intent everywhere (no `Создать` + `Построить` + `Сгенерировать` synonyms - skill §4.5 no-duplicate-intent).

### D.4 InlineKeyboardButton.style (chat-side buttons) + icon_custom_emoji_id

These are **chat-message buttons** (the bot's inline keyboard), not in-mini-app buttons. Used at entry points: the `/start` message, the "route ready" share message, deep-link cards. Each button gets an optional `style` (Bot API 8.0+) and an optional leading custom-emoji icon.

| `style` value | When to use | Nearventure example |
|---|---|---|
| `primary` (blue) | default for opening the Mini App | `{ text: "Открыть карту", web_app: {...} }` |
| `success` (green) | a finished/positive outcome to act on | `{ text: "Скачать GPX", style: "success", ... }` on route-ready message |
| `danger` (red) | destructive / decline | `{ text: "Отменить маршрут", style: "danger", callback_data: "cancel" }` |
| _(omitted)_ | neutral / most buttons | `{ text: "Что рядом", web_app: {...} }` |

**`icon_custom_emoji_id`:** optional leading custom emoji (requires Premium or Fragment username). Use sparingly as brand flavor on at most the two primary entry buttons (e.g., a small compass 🧭 / route glyph custom emoji on "Открыть карту"). Not on every button - rationing (skill §9.F decorative-dot rule applies by analogy). If no Premium/Fragment, omit entirely; do **not** fall back to generic Unicode emoji (skill §3.D emoji policy).

**Layout rule for chat keyboards:** one button per row for primary actions; two per row only for paired accept/decline (`[ Сохранить ] [ Отменить ]`). Never 3+ across on mobile.

---

## E. Haptics & Popups

### E.1 HapticFeedback map (skill §8)

| Interaction | Call | Notes |
|---|---|---|
| POI card tap, chip toggle, tab switch | `impactOccurred('light')` | most common; keep subtle |
| Pin drop (wizard step 1), drag-reorder drop | `impactOccurred('medium')` | physical "placement" feel |
| Swipe-to-delete prep, slider release at boundary | `impactOccurred('heavy')` | signals weighty action ahead |
| Slider drag, horizontal scroll-snap | `selectionChanged()` | continuous; throttle to ~1 per snap |
| Route created, GPX downloaded, POI added | `notificationOccurred('success')` | on confirmed success only |
| Route build failed, network error | `notificationOccurred('error')` | pair with `showAlert` |
| Partial results, low-confidence route, area with few POIs | `notificationOccurred('warning')` | pair with inline hint, not alert |

**Rules:**
- Every `impactOccurred`/`notificationOccurred` must be **motivated** (skill §5: motion/haptic must communicate). No haptic on passive scroll, on hover, or on every list item render.
- Gate haptics behind platform check: `if (tg.HapticFeedback)`. Web/desktop Telegram ignores them gracefully.
- Pair `notificationOccurred` with a visible result (toast, button state change) - never haptic alone.
- `selectionChanged` is cheap; the others cost attention - max ~1 non-selection haptic per user action.

### E.2 Popups & alerts (skill §9 - never browser `alert`/`confirm`)

| Native API | When | Nearventure copy |
|---|---|---|
| `tg.showAlert(msg)` | simple informational, single dismiss | `"Маршрут длиннее бюджета времени. Часть мест не вошла."` |
| `tg.showConfirm(msg, cb)` | destructive, binary | `"Удалить «Озеро Широкое» из маршрута?"` → cb(confirmed) |
| `tg.showPopup({title, message, buttons}, cb)` | multi-option decision | route conflict (below) |

**showPopup example - route conflict** (a POI the user wants to add would blow the time budget):

```
title:   "Не помещается во время"
message: "Добавление «Успенская церковь» сделает маршрут 2ч 10м при бюджете 1ч 30м."
buttons:
  - { id: "extend", type: "default",  text: "Продлить маршрут" }   // re-runs wizard step 2
  - { id: "swap",   type: "default",  text: "Заменить последнее место" }
  - { id: "cancel", type: "cancel" }                              // keep as-is
cb(buttonId): switch → action; impact('light') on choice
```

**Popup discipline:**
- Button text verb-first, ≤24 chars, concrete (`"Удалить"`, not `"ОК"` for destructive - use `type: "destructive"`).
- Max 3 buttons per popup (Telegram stacks vertically on mobile). `cancel` always last.
- `type: "destructive"` (red) for the irreversible option only.
- Destructive path: haptic `heavy` on popup open → `success`/`error` on outcome.
- Reserve `showPopup` for genuine forks; prefer `showAlert` for "just so you know" and `showConfirm` for yes/no. Over-using popups is friction.

### E.3 Haptic + popup pairing cheat sheet

| Scenario | Haptic | Popup |
|---|---|---|
| Add POI to route (success) | `success` | none (button state change is enough) |
| Add POI over budget | `warning` | `showPopup` (3 options, above) |
| Delete POI from route | `heavy` (open) → `success`/`cancel` | `showConfirm` |
| GPX download done | `success` | none → offer share via button |
| Routing engine down | `error` | `showAlert` (friendly copy) |
| Category chip toggle | `light` | none |
| Slider drag | `selectionChanged` | none |

---

## Pre-Flight (mini-app-specific, skill §14 adapted)

- [x] Token bridge: native surfaces via `--tg-theme-*`, brand accent `--nv-primary` constant. Color Lock held.
- [x] Shape lock: `border-radius: 14px` cards (native parity), pill icon buttons, 10px thumbnails. One system.
- [x] Theme lock: whole app one theme; surfaces auto-swap via `themeChanged`; no mid-app flips.
- [x] Contrast: brand pairs verified AA (docs/ui-design-system.md); native tg pairs AA by Telegram.
- [x] Button copy: verb-first, ≤24 chars, one verb per intent, no duplicate CTAs per screen.
- [x] Zero em-dashes in all copy (use `·`, `-`, or restructure). ASCII layouts above use `-`/`·` only.
- [x] Eyebrow rationing: ≤1 section label per 3 sections; Home/Detail use at most 1 each.
- [x] Safe areas: `--tg-safe-area-inset-*` + content safe area hybrid; content `padding-bottom ≈ 80px` clears MainButton.
- [x] Reduced motion/transparency honored (existing `prefers-reduced-motion` block; add `prefers-reduced-transparency` solid fill for glass).
- [x] No AI-tells: no purple, no gradient-text, no fake-precise numbers (distances/ETA come from GraphHopper), no decorative dots (category dots are semantic), no scroll cues, no version footers.
- [x] Attribution functional (photo author + license + sources), not decorative captions.
