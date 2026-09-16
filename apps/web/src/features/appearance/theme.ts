/**
 * Light, dark, or whatever the device says (doc 18: light mode is
 * first-class, and the choice is the person's).
 *
 * The tokens already carry all three states — bare `:root` is light,
 * `prefers-color-scheme: dark` applies unless the person chose light, and
 * `[data-theme]` wins over both. So a theme is one attribute on `<html>`
 * plus somewhere to remember it. Nothing else in the app reads a theme.
 */

export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const THEME_STORAGE_KEY = "cq.theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return (
    typeof value === "string" &&
    (THEME_CHOICES as readonly string[]).includes(value)
  );
}

/**
 * Applied before the first paint by the inline script below, and again by
 * the toggle. "system" removes the attribute rather than guessing, so the
 * media query decides and keeps deciding when the device changes.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
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
 * white flash on the way to it. Inline and tiny on purpose: anything that
 * waits for hydration is too late to prevent the flash.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;
