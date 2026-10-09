import type {
  QClientActionIntent,
  QScreenActIntent,
  QRecordPage,
  QSetDiscoverFiltersIntent,
  QSubjectRef,
  QSettingsSection,
} from "@capital-q/contracts";

import { applyTheme, storeTheme } from "@/features/appearance/theme";
import { storeQMotion } from "@/features/q-aperture/q-motion";
import { storeVoicePreference } from "@/features/voice/voice-preference";

import { forgetActiveConversations } from "./active-conversation";
import { loadWire, wireNow, type WireContracts } from "./wire";
import { expectNavigation, performUiAct } from "./ui-act-controller";

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
  /**
   * R0: one data-room document, opened in the viewer where they are. The
   * viewer asks the API for a signed read as them; this only names it.
   */
  readonly openMaterial: (document: QMaterialDocumentRef) => void;
};

/** A data-room document Q opened on screen (R0). */
export type QMaterialDocumentRef = {
  readonly companyId: string;
  readonly documentId: string;
  readonly title: string | null;
};

/** The viewer listens for these; nothing else is carried on them. */
export const Q_MATERIAL_OPEN_EVENT = "cq:q-material-open";
export const Q_MATERIAL_CLOSE_EVENT = "cq:q-material-close";

/** Their own unfinished setup, from the fixed route map. */
export function setupPath(journey: "founder" | "investor"): string {
  return journey === "investor"
    ? "/onboarding/investor?from=home"
    : "/onboarding/founder?from=home";
}

/** R33: a record's own page, from its kind and a validated id only. */
export function recordPagePath(
  page: QRecordPage,
  id: string,
  companyId?: string,
): string {
  const safe = encodeURIComponent(id.toLowerCase());
  switch (page) {
    // As a link: the company's Data room tab, where it is listed. Q's own
    // move opens it in the viewer where they are (openMaterial, R0).
    case "DATA_ROOM_DOCUMENT":
      return companyId === undefined
        ? "/documents"
        : `/company/${encodeURIComponent(companyId.toLowerCase())}?tab=dataroom`;
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
    // The Documents page opens its viewer on this one: a deep link that
    // works from any page; the Q API authorises the read as the person.
    case "DOCUMENT":
      return `/documents?open=${safe}`;
    // Discover's "Your companies" tab, on that company's item.
    case "COMPANY_PITCH":
      return `/discover?tab=yours&company=${safe}`;
    // Q room R2: a company profile's own tabs.
    case "COMPANY_ELEVATOR":
      return `/company/${safe}?tab=elevator`;
    case "COMPANY_DATA_ROOM":
      return `/company/${safe}?tab=dataroom`;
    case "COMPANY_DECK":
      return `/company/${safe}?tab=deck`;
    case "COMPANY_TEAM":
      return `/company/${safe}?tab=team`;
    case "WORK_ITEM":
      return `/work/${safe}`;
    case "CAPITAL_ROUND":
      return `/capital?round=${safe}#round-${safe}`;
    case "GATEQ_APPLICATION":
      return `/gateq?item=${safe}`;
  }
}

/** Q room R2: a part of Settings, from the fixed route map. */
export function settingsPath(section: QSettingsSection): string {
  switch (section) {
    case "usage":
    case "memory":
    case "plan":
    case "billing":
    case "team":
      return `/settings/${section}`;
    case "account":
    case "appearance":
    case "q":
    case "speaking":
    case "notifications":
    case "connections":
    case "privacy":
      return `/settings#${section}`;
  }
}

/**
 * The page a card's subject opens on, or null when it has none (R0, live
 * 2026-10-06: a card's "Open profile" was never wired and went nowhere).
 * The page itself authorises the read as the person; this only maps.
 */
export function subjectPagePath(subject: QSubjectRef): string | null {
  switch (subject.kind) {
    case "COMPANY":
      return recordPagePath("COMPANY", subject.companyId);
    case "INVESTOR_ORGANISATION":
      return recordPagePath("INVESTOR", subject.investorOrganisationId);
    case "DOCUMENT":
      return recordPagePath("DOCUMENT", subject.documentId);
    // No page of their own a card can open by this id alone.
    case "RELATIONSHIP":
    case "CAPITAL_OBJECTIVE":
    case "USER":
    case "ORGANISATION":
      return null;
  }
}

/** Opens a card subject's page through the app's router; false if none. */
export function openSubjectPage(
  subject: QSubjectRef,
  goTo: (path: string) => void = (path) => BROWSER_EFFECTS.goTo(path),
): boolean {
  const path = subjectPagePath(subject);
  if (path === null) return false;
  goTo(path);
  return true;
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

/** The app router's prefetch, for a target read while they still speak. */
let clientRouterPrefetch: ((path: string) => void) | null = null;
export function registerClientPrefetch(
  prefetch: ((path: string) => void) | null,
): void {
  clientRouterPrefetch = prefetch;
}
export function prefetchPath(path: string): void {
  clientRouterPrefetch?.(path);
}

/**
 * RECOVERY-2026-10 (C, "stupid fast"): the move the fast path made at the
 * end of the sentence. Q's answer about the same sentence arrives seconds
 * later carrying the same target; it must not move the person a second
 * time (a duplicate history entry, or a pull back from where they went
 * since). One sentence makes one move.
 */
const EARLY_MOVE_MS = 60_000;
let earlyMove: { readonly path: string; readonly at: number } | null = null;

/** Whether the fast path already made this move for the latest sentence. */
export function movedEarlyTo(path: string): boolean {
  if (earlyMove === null || Date.now() - earlyMove.at > EARLY_MOVE_MS) {
    return false;
  }
  // Consumed: the answer's own move is skipped once, then Q may move again.
  if (earlyMove.path !== path) return false;
  earlyMove = null;
  return true;
}

/** The fast path's move: at once, confirmed by the settled route. */
export function moveEarly(path: string): void {
  earlyMove = { path, at: Date.now() };
  if (path !== `${window.location.pathname}${window.location.search}`) {
    expectNavigation(path);
  }
  if (clientRouterPush !== null) clientRouterPush(path);
  else window.location.assign(path);
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
    // The fast path already went there for this sentence: one move.
    if (movedEarlyTo(path)) return;
    // RECOVERY-2026-10 (C2): a UI act queued after this move waits for the
    // new page instead of acting on the one being left.
    if (path !== `${window.location.pathname}${window.location.search}`) {
      expectNavigation(path);
    }
    if (clientRouterPush !== null) clientRouterPush(path);
    else window.location.assign(path);
  },
  screen: screenAct,
  openMaterial: (document) => {
    window.dispatchEvent(
      new CustomEvent<QMaterialDocumentRef>(Q_MATERIAL_OPEN_EVENT, {
        detail: document,
      }),
    );
  },
  setDiscoverFilters: (intent) => {
    // W7: the filters' code loads with the first such action, not the page.
    void import("@/features/discover/filters/discover-filters").then(
      ({ queueDiscoverFiltersIntent }) => {
        queueDiscoverFiltersIntent(intent);
        // Elsewhere, Discover takes the queued intent when it opens.
        if (window.location.pathname !== DISCOVER_PATH) {
          BROWSER_EFFECTS.goTo(DISCOVER_PATH);
        }
      },
    );
  },
  signOut: () => {
    forgetActiveConversations();
    void import("@/auth/actions").then(({ signOutAction }) => signOutAction());
  },
};

/**
 * Performs one client action; false when it was refused or blocked.
 *
 * W7: the shape is checked against the wire's contracts, which load just
 * after the first paint. An action that arrives before they are in is
 * checked and performed the moment they are (true: taken, not refused);
 * nothing is performed unchecked.
 */
export function performClientAction(
  raw: unknown,
  effects: ClientActionEffects = BROWSER_EFFECTS,
): boolean {
  const wire = wireNow();
  if (wire === null) {
    void loadWire().then(
      (loaded) => performChecked(loaded, raw, effects),
      () => undefined,
    );
    return true;
  }
  return performChecked(wire, raw, effects);
}

function performChecked(
  wire: WireContracts,
  raw: unknown,
  effects: ClientActionEffects,
): boolean {
  const parsed = wire.QClientActionIntentSchema.safeParse(raw);
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
      const url = wire.QWebsiteUrlSchema.safeParse(action.url);
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
      if (action.page === "DATA_ROOM_DOCUMENT") {
        if (action.companyId === undefined) return false;
        effects.openMaterial({
          companyId: action.companyId,
          documentId: action.id,
          title: action.title ?? null,
        });
        return true;
      }
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
    case "OPEN_SETTINGS":
      effects.goTo(settingsPath(action.section));
      return true;
    // Q room R4: the Q page's stage shows the card from the answer itself
    // (it is part of the conversation); nothing moves the person.
    case "SHOW_IN_Q_ROOM":
      return true;
    // Q room R5: the answer carries the connect card itself; the person
    // starts the connect flow from it, never the answer on its own.
    case "SHOW_CALENDAR_CONNECT":
      return true;
    // Q room W3: the open document's viewer reads its acts from the answer
    // itself (each answer once), so a voice and a typed turn page alike.
    case "DOCUMENT_ACT":
      return true;
    // RECOVERY-2026-10: a registered control on the page, with a receipt.
    case "UI_ACT":
      void performUiAct(action);
      return true;
  }
}
