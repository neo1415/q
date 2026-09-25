/**
 * The handful of fixed colour values that must exist outside CSS: the web
 * app manifest and the browser-chrome theme colour cannot read a custom
 * property. These are the sRGB renderings of the canonical `--cq-*` oklch
 * values in tokens.css and are the only raw hex values in the design system.
 */
export const THEME_COLORS = {
  light: {
    accent: "#2673df",
    canvas: "#fbfaf7",
  },
  dark: {
    accent: "#66a5ff",
    canvas: "#0b0d12",
  },
} as const;

/**
 * Motion timing in seconds, for the rare script-driven animation (Web
 * Animations API, a future Motion for React) that cannot read a custom
 * property. Mirrors `--cq-motion-*` and `--cq-ease*` in tokens.css exactly;
 * CSS transitions read the tokens directly and never these.
 */
export const MOTION = {
  instant: 0.09,
  fast: 0.14,
  base: 0.2,
  emphasis: 0.28,
  slow: 0.36,
} as const;
export const EASE_STANDARD = [0.22, 1, 0.36, 1] as const;
export const EASE_EXIT = [0.4, 0, 1, 1] as const;

/** Semantic z-layers; the CSS custom properties are the source of truth. */
export const Z_LAYERS = [
  "base",
  "sticky",
  "navigation",
  "presence",
  "popover",
  "sheet",
  "modal",
  "toast",
] as const;
export type ZLayer = (typeof Z_LAYERS)[number];

/** Q visual states (doc 18 §34). Presentation vocabulary only. */
export const Q_STATES = [
  "IDLE",
  "LISTENING",
  "WORKING",
  "NEEDS_INPUT",
  "NEEDS_APPROVAL",
  "COMPLETE",
  "ERROR",
] as const;
export type QState = (typeof Q_STATES)[number];

/**
 * The eight canonical visibility scopes (ADR-001 Decision 1), plus `unset`
 * for surfaces that have no authoritative context yet. Presentation only:
 * rendering a scope never asserts it.
 */
export const CONTEXT_SCOPES = [
  "personal_private",
  "organisation_private",
  "founder_private",
  "investor_private",
  "relationship_shared",
  "specifically_shared",
  "network_visible",
  "public_external",
  "unset",
] as const;
export type ContextScope = (typeof CONTEXT_SCOPES)[number];
