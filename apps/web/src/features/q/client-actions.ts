import {
  QClientActionIntentSchema,
  QWebsiteUrlSchema,
  type QClientActionIntent,
  type QScreenActIntent,
  type QRecordPage,
  type QSetDiscoverFiltersIntent,
} from "@capital-q/contracts";

import { applyTheme, storeTheme } from "@/features/appearance/theme";
import { queueDiscoverFiltersIntent } from "@/features/discover/filters/discover-filters";
import { storeQMotion } from "@/features/q-aperture/q-motion";
import { storeVoicePreference } from "@/features/voice/voice-preference";

import { forgetActiveConversations } from "./active-conversation";

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
  readonly setQMotion: (motion: "full" | "calm" | "off") => void;
  readonly setVoice: (voice: "FEMALE" | "MALE") => void;
  readonly signOut: () => void;
  /** Goes to an in-app path built below from the fixed route map. */
  readonly goTo: (path: string) => void;
  /**
   * Sets the reader's Discover filters, as the filter sheet does, and
   * brings Discover up when they are elsewhere (ux/discover-filters).
   */
  readonly setDiscoverFilters: (intent: QSetDiscoverFiltersIntent) => void;
  /** Works the page on screen: scroll, back, a section, a dialog. */
  readonly screen: (intent: QScreenActIntent) => void;
};

/** Their own unfinished setup, from the fixed route map. */
export function setupPath(journey: "founder" | "investor"): string {
  return journey === "investor"
    ? "/onboarding/investor?from=home"
    : "/onboarding/founder?from=home";
}

/** R33: a record's own page, from its kind and a validated id only. */
export function recordPagePath(page: QRecordPage, id: string): string {
  const safe = encodeURIComponent(id.toLowerCase());
  switch (page) {
    case "COMPANY":
      return `/company/${safe}`;
    case "RELATIONSHIP_COMPANY":
      return `/relationships/company/${safe}`;
    case "RELATIONSHIP_INVESTOR":
      return `/relationships/investor/${safe}`;
    case "RELATIONSHIP_COMPANY_MESSAGES":
      return `/relationships/company/${safe}/messages`;
    case "RELATIONSHIP_INVESTOR_MESSAGES":
      return `/relationships/investor/${safe}/messages`;
    case "INVESTOR":
      return `/investors/${safe}`;
    case "INVESTOR_REHEARSAL":
      return `/rehearsals/investor/${safe}`;
    case "COMPANY_REHEARSAL":
      return `/rehearsals/company/${safe}`;
  }
}

/**
 * The app's own client router, registered by the Q session. Moving through
 * it keeps the page's JavaScript -- and Q's open voice line -- alive; a full
 * page load (the fallback before it registers) drops both and is slow
 * (founder report 2026-09-30: "3 to 5 seconds... it stops listening").
 */
let clientRouterPush: ((path: string) => void) | null = null;
export function registerClientRouter(
  push: ((path: string) => void) | null,
): void {
  clientRouterPush = push;
}

/** Q's moves on Discover's feed, heard by the feed itself. */
export const Q_FEED_EVENT = "cq:q-feed";

/** The element that scrolls: the shell's main area, else the document. */
function scroller(): Element {
  const main = document.getElementById("main");
  if (main !== null && main.scrollHeight > main.clientHeight + 1) return main;
  return document.scrollingElement ?? document.documentElement;
}

function screenAct(intent: QScreenActIntent): void {
  const area = scroller();
  switch (intent.act) {
    case "SCROLL_TOP":
      area.scrollTo({ top: 0, behavior: "smooth" });
      return;
    case "SCROLL_BOTTOM":
      area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
      return;
    case "PAGE_DOWN":
      area.scrollBy({ top: area.clientHeight * 0.85, behavior: "smooth" });
      return;
    case "PAGE_UP":
      area.scrollBy({ top: -area.clientHeight * 0.85, behavior: "smooth" });
      return;
    case "GO_BACK":
      window.history.back();
      return;
    case "SHOW_SECTION":
      if (intent.section !== undefined) {
        document
          .getElementById(intent.section)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    // The relationship page's own dialogs open from their hash.
    case "OPEN_BOOK_CALL":
      window.location.hash = "calls";
      return;
    case "OPEN_REMINDER":
      window.location.hash = "reminders";
      return;
    // Discover's feed takes these through its own controls.
    case "NEXT_ITEM":
    case "PREVIOUS_ITEM":
    case "PASS_CURRENT":
    case "SAVE_CURRENT":
      window.dispatchEvent(
        new CustomEvent(Q_FEED_EVENT, { detail: intent.act }),
      );
      return;
  }
}

const DISCOVER_PATH: string = "/discover";

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
  // The Settings controls' own stores; their listeners update the page.
  setQMotion: (motion) => {
    storeQMotion(motion);
  },
  setVoice: (voice) => {
    storeVoicePreference(voice);
  },
  // The Sign out button's own steps: forget which chats were open on this
  // tab, then the server action that ends the session and redirects.
  goTo: (path) => {
    if (clientRouterPush !== null) clientRouterPush(path);
    else window.location.assign(path);
  },
  screen: screenAct,
  setDiscoverFilters: (intent) => {
    queueDiscoverFiltersIntent(intent);
    // Elsewhere, Discover takes the queued intent when it opens.
    if (window.location.pathname !== DISCOVER_PATH) {
      BROWSER_EFFECTS.goTo(DISCOVER_PATH);
    }
  },
  signOut: () => {
    forgetActiveConversations();
    void import("@/auth/actions").then(({ signOutAction }) => signOutAction());
  },
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
    case "SET_Q_MOTION":
      effects.setQMotion(action.motion);
      return true;
    case "SET_VOICE":
      effects.setVoice(action.voice);
      return true;
    case "SIGN_OUT":
      effects.signOut();
      return true;
    case "OPEN_RECORD_PAGE":
      effects.goTo(recordPagePath(action.page, action.id));
      return true;
    case "OPEN_SETUP":
      effects.goTo(setupPath(action.journey));
      return true;
    case "SET_DISCOVER_FILTERS":
      effects.setDiscoverFilters(action);
      return true;
    case "SCREEN_ACT":
      effects.screen(action);
      return true;
  }
}
