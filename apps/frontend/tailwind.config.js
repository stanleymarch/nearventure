/** @type {import('tailwindcss').Config} */
//
// Nearventure design system — warm Material 3 palette (light + dark).
// Colors are RGB-channel triples defined as CSS variables in style.css so the
// `.dark` class can override them. Usage: `bg-nv-primary`, `text-nv-on-surface`.
//
// The `--background`, `--primary`, `--border`, ... aliases are shadcn-vue
// semantic tokens — they point at the same Material 3 triples so every shadcn
// component (Button, Card, Sheet, Dialog, ...) inherits the warm brand palette.
//
import animate from 'tailwindcss-animate';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        // ── shadcn-vue semantic tokens (map onto the Material 3 triples) ──
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
        // Warm orange "brand" scale (static hex — keeps legacy .btn-primary cohesive).
        brand: {
          50: '#fdf3ec',
          100: '#fbe0cf',
          200: '#f6c19c',
          300: '#f1a063',
          400: '#ec823c',
          500: '#c95712',
          600: '#9b4500',
          700: '#7d3800',
          800: '#622e05',
          900: '#502708',
        },
        // Material 3 tokens (driven by CSS vars — see style.css).
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
          'primary-dim': 'rgb(var(--nv-primary-dim) / <alpha-value>)',
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
        // ── Typography system (design code) ──
        // Body / UI text uses Inter — an optimized screen face for dense small
        // labels & numbers. Headings/brand use Geologica (display) for character.
        // Do NOT apply Geologica to body text (illegible at small sizes).
        // Type scale: use Tailwind's default (xs/sm/base/lg/xl/2xl…) consistently.
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        display: ['Geologica', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        DEFAULT: '1rem',
        xl: '1.5rem',
        '2xl': '2rem',
        // ── Nearventure radius scale (design code) ──
        // Use these named tokens so radii are consistent and theme-driven.
        panel: 'var(--nv-radius-panel)', // 20px — drawers, workspace, sheets
        card: 'var(--nv-radius-card)', // 16px — POI cards, summary, shelf
        control: 'var(--nv-radius-control)', // 12px — buttons, toggles, inputs
        chip: 'var(--nv-radius-chip)', // 10px — interest chips, tags
      },
      boxShadow: {
        // ── Nearventure shadow scale (tinted, never pure-black on light) ──
        surface: 'var(--nv-shadow-surface)',
        floating: 'var(--nv-shadow-floating)',
        overlay: 'var(--nv-shadow-overlay)',
        // Legacy aliases (kept for existing class usage in components).
        soft: '0 10px 30px -12px rgba(155, 69, 0, 0.20)',
        float: 'var(--nv-shadow-floating)',
        card: 'var(--nv-shadow-surface)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--reka-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--reka-accordion-content-height)' },
          to: { height: '0' },
        },
        'collapsible-down': {
          from: { height: '0' },
          to: { height: 'var(--reka-collapsible-content-height)' },
        },
        'collapsible-up': {
          from: { height: 'var(--reka-collapsible-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'collapsible-down': 'collapsible-down 0.2s ease-out',
        'collapsible-up': 'collapsible-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
};
