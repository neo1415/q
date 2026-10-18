import { THEME_COLORS } from "@capital-q/ui/tokens";

/**
 * Light, dark, or whatever the device says (doc 18: light mode is
 * first-class, and the choice is the person's; ADR 0017 F4: the choice is
 * easy to find).
 *
 * The tokens already carry all three states — bare `:root` is light,
 * `prefers-color-scheme: dark` applies unless the person chose light, and
 * `[data-theme]` wins over both. So a theme is one attribute on `<html>`,
 * the browser bar's colour, and somewhere to remember it.
 */

export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The order the control shows them in: sun · monitor · moon. */
export const THEME_DISPLAY_ORDER: readonly ThemeChoice[] = [
  "light",
  "system",
  "dark",
];

export const THEME_STORAGE_KEY = "cq.theme";

/**
 * The one `<meta name="theme-color">` a manual choice owns. Next renders two
 * media-qualified ones that follow the device; the first matching tag wins,
 * so a manual choice prepends its own and "system" removes it, handing the
 * decision back to the media queries.
 */
export const THEME_COLOR_META_ATTRIBUTE = "data-cq-theme-color";

/**
 * Set on `<html>` for the instant of a switch: every colour transition in
 * the app would otherwise run at once and the page would visibly wash from
 * one theme into the other (globals.css turns transitions off under it).
 */
export const THEME_SWITCHING_ATTRIBUTE = "data-theme-switching";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return (
    typeof value === "string" &&
    (THEME_CHOICES as readonly string[]).includes(value)
  );
}

/** The browser bar's colour for a manual choice; none for "system". */
export function themeColorFor(choice: ThemeChoice): string | null {
  if (choice === "light") return THEME_COLORS.light.canvas;
  if (choice === "dark") return THEME_COLORS.dark.canvas;
  return null;
}

function applyThemeColor(choice: ThemeChoice): void {
  const colour = themeColorFor(choice);
  const existing = document.head.querySelector(
    `meta[${THEME_COLOR_META_ATTRIBUTE}]`,
  );
  if (colour === null) {
    existing?.remove();
    return;
  }
  const meta = existing ?? document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute(THEME_COLOR_META_ATTRIBUTE, "");
  meta.setAttribute("content", colour);
  if (document.head.firstChild !== meta) {
    document.head.prepend(meta);
  }
}

/**
 * Applied before the first paint by the inline script below, and again by
 * the control. "system" removes the attribute rather than guessing, so the
 * media query decides and keeps deciding when the device changes.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  root.setAttribute(THEME_SWITCHING_ATTRIBUTE, "");
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
  applyThemeColor(choice);
  // Commit the new colours while transitions are off, then allow them
  // again. Reading a computed style forces the recalculation now; the
  // release waits two frames so the controls' own re-render (the pressed
  // segment) is also painted before transitions return, leaving them
  // nothing to animate. A hidden tab simply keeps them off until shown.
  void window.getComputedStyle(document.body).backgroundColor;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      root.removeAttribute(THEME_SWITCHING_ATTRIBUTE);
    });
  });
}

export function readStoredTheme(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    // Private windows and blocked site data: the device's choice stands.
    return "system";
  }
}

/**
 * Listeners for the choice, so the control can read it as an external
 * store instead of copying it into React state.
 *
 * Another tab writing the same key counts too: a person who switches to
 * dark in one window should not find this one still claiming light.
 */
const listeners = new Set<() => void>();

export function subscribeToTheme(onChange: () => void): () => void {
  listeners.add(onChange);
  const fromAnotherTab = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      applyTheme(readStoredTheme());
      onChange();
    }
  };
  window.addEventListener("storage", fromAnotherTab);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", fromAnotherTab);
  };
}

export function storeTheme(choice: ThemeChoice): void {
  try {
    if (choice === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // The choice still applies to this page; it just will not survive.
  }
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Runs before the first paint, so a person who chose dark never sees a
 * white flash on the way to it, nor a light browser bar above a dark page.
 * Inline and tiny on purpose: anything that waits for hydration is too late
 * to prevent the flash. It is static text (no per-request value), so a
 * future Content-Security-Policy can allow it by hash.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);var m=document.createElement("meta");m.setAttribute("name","theme-color");m.setAttribute(${JSON.stringify(
  THEME_COLOR_META_ATTRIBUTE,
)},"");m.setAttribute("content",t==="dark"?${JSON.stringify(
  THEME_COLORS.dark.canvas,
)}:${JSON.stringify(THEME_COLORS.light.canvas)});document.head.prepend(m)}}catch(e){}`;
