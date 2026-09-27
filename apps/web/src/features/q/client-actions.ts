import {
  QClientActionIntentSchema,
  QWebsiteUrlSchema,
  type QClientActionIntent,
} from "@capital-q/contracts";

import { applyTheme, storeTheme } from "@/features/appearance/theme";

/**
 * What the browser does when Q's answer carries a client action (R20/R33;
 * founder live test 2026-09-27 #4). The server-side tool's authorize step
 * allowed it; this performs it through the same code the page's own
 * controls use — the theme control, the browser's reload, a new tab — and
 * checks the shape again, because an answer is data, never authority.
 */
export type ClientActionEffects = {
  readonly setTheme: (theme: "light" | "dark" | "system") => void;
  readonly reload: () => void;
  /** Opens a new tab; false when the browser blocked it. */
  readonly openTab: (url: string) => boolean;
};

export const BROWSER_EFFECTS: ClientActionEffects = {
  setTheme: (theme) => {
    applyTheme(theme);
    storeTheme(theme);
  },
  reload: () => {
    window.location.reload();
  },
  openTab: (url) =>
    // noopener: the site can never reach back into Capital Q's window.
    window.open(url, "_blank", "noopener,noreferrer") !== null,
};

/** Performs one client action; false when it was refused or blocked. */
export function performClientAction(
  raw: unknown,
  effects: ClientActionEffects = BROWSER_EFFECTS,
): boolean {
  const parsed = QClientActionIntentSchema.safeParse(raw);
  if (!parsed.success) return false;
  const action: QClientActionIntent = parsed.data;
  switch (action.kind) {
    case "SET_THEME":
      effects.setTheme(action.theme);
      return true;
    case "RELOAD_PAGE":
      effects.reload();
      return true;
    case "OPEN_WEBSITE": {
      const url = QWebsiteUrlSchema.safeParse(action.url);
      return url.success ? effects.openTab(url.data) : false;
    }
  }
}
