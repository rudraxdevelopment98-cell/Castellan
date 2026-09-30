import type { Config } from "tailwindcss";

/**
 * Design tokens are declared here AND mirrored as CSS variables in globals.css.
 * The palette, radii and type scale come straight from the Castellan build spec
 * (ui_ux.tokens). Deliberately restrained: borders not shadows, one accent,
 * status carried by both colour and shape (see ui_ux.anti_patterns / a11y).
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        rule: "var(--rule)",
        brand: "var(--brand)",
        "brand-weak": "var(--brand-weak)",
        accent: "var(--accent)",
        overdue: "var(--status-overdue)",
        "due-soon": "var(--status-due-soon)",
        ok: "var(--status-ok)",
        missing: "var(--status-missing)",
        na: "var(--status-na)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      fontSize: {
        meta: ["13px", "18px"],
        table: ["14px", "20px"],
        body: ["15px", "22px"],
        section: ["18px", "26px"],
        title: ["24px", "30px"],
      },
      borderRadius: {
        sq: "2px",
        ctl: "6px",
        panel: "8px",
      },
      spacing: {
        row: "40px",
        "row-compact": "32px",
      },
      boxShadow: {
        // The single permitted shadow, for menus and dialogs only.
        menu: "0 8px 28px -12px rgba(30, 39, 36, 0.28)",
      },
    },
  },
  plugins: [],
};

export default config;
