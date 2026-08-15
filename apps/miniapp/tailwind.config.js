/** @type {import('tailwindcss').Config} */
// Same Material 3 token system as the web frontend, so cards/chips read as one
// design language. Colors are RGB-channel triples driven by CSS variables in
// style.css (which the theme-bridge composable syncs from Telegram's theme).
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // shadcn-vue CSS-variable bridge — mapped to --nv-* in style.css.
        // Enables `bg-card text-foreground border-input` etc. to work alongside
        // the custom `nv-*` tokens so HomeView/PoiDetailView/NearbyView look
        // visually consistent with CatalogView/WizardView.
        border: 'rgb(var(--border) / <alpha-value>)',
        input: 'rgb(var(--input) / <alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          foreground: 'rgb(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'rgb(var(--secondary) / <alpha-value>)',
          foreground: 'rgb(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
          foreground: 'rgb(var(--destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          foreground: 'rgb(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          foreground: 'rgb(var(--accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'rgb(var(--popover) / <alpha-value>)',
          foreground: 'rgb(var(--popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'rgb(var(--card) / <alpha-value>)',
          foreground: 'rgb(var(--card-foreground) / <alpha-value>)',
        },
        nv: {
          bg: 'rgb(var(--nv-bg) / <alpha-value>)',
          surface: 'rgb(var(--nv-surface) / <alpha-value>)',
          'surface-low': 'rgb(var(--nv-surface-low) / <alpha-value>)',
          'surface-high': 'rgb(var(--nv-surface-high) / <alpha-value>)',
          'surface-lowest': 'rgb(var(--nv-surface-lowest) / <alpha-value>)',
          'surface-highest': 'rgb(var(--nv-surface-highest) / <alpha-value>)',
          'surface-variant': 'rgb(var(--nv-surface-variant) / <alpha-value>)',
          'on-bg': 'rgb(var(--nv-on-bg) / <alpha-value>)',
          'on-surface': 'rgb(var(--nv-on-surface) / <alpha-value>)',
          'on-surface-variant': 'rgb(var(--nv-on-surface-variant) / <alpha-value>)',
          outline: 'rgb(var(--nv-outline) / <alpha-value>)',
          'outline-variant': 'rgb(var(--nv-outline-variant) / <alpha-value>)',
          primary: 'rgb(var(--nv-primary) / <alpha-value>)',
          'on-primary': 'rgb(var(--nv-on-primary) / <alpha-value>)',
          'primary-container': 'rgb(var(--nv-primary-container) / <alpha-value>)',
          'on-primary-container': 'rgb(var(--nv-on-primary-container) / <alpha-value>)',
          secondary: 'rgb(var(--nv-secondary) / <alpha-value>)',
          'on-secondary': 'rgb(var(--nv-on-secondary) / <alpha-value>)',
          'secondary-container': 'rgb(var(--nv-secondary-container) / <alpha-value>)',
          'on-secondary-container': 'rgb(var(--nv-on-secondary-container) / <alpha-value>)',
          tertiary: 'rgb(var(--nv-tertiary) / <alpha-value>)',
          'on-tertiary': 'rgb(var(--nv-on-tertiary) / <alpha-value>)',
          'tertiary-container': 'rgb(var(--nv-tertiary-container) / <alpha-value>)',
          'on-tertiary-container': 'rgb(var(--nv-on-tertiary-container) / <alpha-value>)',
          error: 'rgb(var(--nv-error) / <alpha-value>)',
          'error-container': 'rgb(var(--nv-error-container) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Geologica', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Geologica', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '14px',
        xl: '18px',
        '2xl': '22px',
        // ── Nearventure shared radius scale ──
        panel: 'var(--nv-radius-panel)', // 20px
        card: 'var(--nv-radius-card)', // 16px
        control: 'var(--nv-radius-control)', // 12px
        chip: 'var(--nv-radius-chip)', // 10px
      },
      boxShadow: {
        surface: 'var(--nv-shadow-surface)',
        floating: 'var(--nv-shadow-floating)',
        overlay: 'var(--nv-shadow-overlay)',
        card: 'var(--nv-shadow-surface)',
        soft: '0 6px 20px -10px rgba(155, 69, 0, 0.20)',
      },
    },
  },
  plugins: [],
};
