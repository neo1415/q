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
import {
  arrivedAt,
  beginNavigationTurn,
  lastNavigationTo,
} from "./control/navigation-lifecycle";
import { currentRoute } from "./control/route-state";
import { performUiAct, requestMove } from "./ui-act-controller";

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
    case "EXTERNAL_REHEARSAL":
      return `/rehearsals/person/${safe}`;
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

const COMPANY_PROFILE_TAB_NAMES: readonly string[] = [
  "overview",
  "elevator",
  "dataroom",
  "deck",
  "team",
];
const RELATIONSHIP_TAB_NAMES: readonly string[] = [
  "messages",
  "calls",
  "diligence",
];

/**
 * N2: an OPEN_RECORD_PAGE intent's path, with the tab, deck section and
 * viewer it carries. A tab the page does not have is ignored; the page
 * authorises what it shows as the person, as for a typed URL.
 */
export function recordIntentPath(
  intent: Extract<QClientActionIntent, { kind: "OPEN_RECORD_PAGE" }>,
): string {
  const base = recordPagePath(intent.page, intent.id, intent.companyId);
  if (intent.tab === undefined) return base;
  const safe = encodeURIComponent(intent.id.toLowerCase());
  switch (intent.page) {
    case "COMPANY":
    case "COMPANY_ELEVATOR":
    case "COMPANY_DATA_ROOM":
    case "COMPANY_DECK":
    case "COMPANY_TEAM": {
      // The server checked the tab against the page (the contract); the
      // browser still only follows its own fixed tabs.
      if (!COMPANY_PROFILE_TAB_NAMES.includes(intent.tab)) return base;
      const params = new URLSearchParams({ tab: intent.tab });
      if (intent.tab === "deck" && intent.subTab !== undefined) {
        params.set("sub", intent.subTab.toLowerCase());
      }
      if (intent.tab === "deck" && intent.viewer === "OPEN") {
        params.set("open", "1");
      }
      return `/company/${safe}?${params.toString()}`;
    }
    case "RELATIONSHIP_COMPANY":
    case "RELATIONSHIP_COMPANY_MESSAGES":
      return RELATIONSHIP_TAB_NAMES.includes(intent.tab)
        ? `/relationships/company/${safe}/${intent.tab}`
        : base;
    case "RELATIONSHIP_INVESTOR":
    case "RELATIONSHIP_INVESTOR_MESSAGES":
      return RELATIONSHIP_TAB_NAMES.includes(intent.tab)
        ? `/relationships/investor/${safe}/${intent.tab}`
        : base;
    default:
      return base;
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
 * K5 (C Part 5): the page a click on an answer card opens -- the record
 * move's own first choice for that record (named-record-request pagesFor):
 * a company's page; for an investor, the relationship with them, which is
 * their page on either side. Null when the card has no page of its own.
 */
export function cardPagePath(subject: QSubjectRef | null): string | null {
  if (subject === null) return null;
  if (subject.kind === "INVESTOR_ORGANISATION") {
    return recordPagePath(
      "RELATIONSHIP_INVESTOR",
      subject.investorOrganisationId,
    );
  }
  return subjectPagePath(subject);
}

/**
 * W4: "Rehearse with <name>" on a person's identity card: a move of their
 * own to that entity's rehearsal lobby, through the one navigation
 * lifecycle (the same path as a card's Open button).
 */
export function openExternalRehearsal(externalPersonId: string): void {
  beginNavigationTurn();
  requestMove({
    path: recordPagePath("EXTERNAL_REHEARSAL", externalPersonId),
  });
}

/**
 * The person opened a card: a move of their own, through the one
 * lifecycle. A click is a new turn, so a page this sentence already
 * VERIFIED (and they have left since) is opened again, not "already done".
 */
export function openCardPage(subject: QSubjectRef | null): boolean {
  const path = cardPagePath(subject);
  if (path === null) return false;
  beginNavigationTurn();
  requestMove({ path });
  return true;
}

// The client routers Q's moves go through live in control/router-registry
// (the navigation lifecycle executes through them); re-exported for the
// surfaces that register them.
export {
  prefetchPath,
  registerClientPrefetch,
  registerClientRouter,
  registerShellRouter,
  setHardLoad,
} from "./control/router-registry";

/**
 * Every move of Q's: validated, pushed through the client router and
 * verified by the one navigation lifecycle (control/navigation-lifecycle).
 * With no router registered the move waits (briefly) for one; a full page
 * load is the last resort and is never used while a voice call holds the
 * audio (the receipt then says FAILED: NO_ROUTER).
 */
export function pushRoute(path: string): void {
  requestMove({ path });
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

/**
 * RECOVERY-2026-10 (C, G-D16): when the person last asked Q something in
 * this tab. A conversation that reloads while the answer lands (the Q page
 * names a new conversation in its URL) must not count that answer as
 * "already there" and swallow its move.
 */
let lastAskedAt: number | null = null;
const ASKED_FRESH_MS = 120_000;

export function noteAsked(): void {
  lastAskedAt = Date.now();
  // G2-D2: this sentence's moves (fast path, Q's answer, the voice board)
  // are one move; the next sentence's are new ones.
  beginNavigationTurn();
}

/** Since when answers are the person's fresh ones; null when none is. */
export function askedSince(): number | null {
  return lastAskedAt !== null && Date.now() - lastAskedAt <= ASKED_FRESH_MS
    ? lastAskedAt
    : null;
}

/**
 * The fast path moved here moments ago (not consumed): the same request
 * heard again -- a voice line's utterance and then its delegation -- is
 * the same move, never a second push.
 */
export function movedEarlyRecently(path: string, withinMs: number): boolean {
  return (
    earlyMove !== null &&
    earlyMove.path === path &&
    Date.now() - earlyMove.at <= withinMs
  );
}

/**
 * Q's answer moving to `path` (typed or spoken). The fast path may already
 * have made this move for the same sentence: then the answer joins it (on
 * its way) or gets its receipt at once (still there), never a second push
 * -- and if the person has moved on since, they are not pulled back. A
 * fast move that FAILED is tried again by the answer.
 */
export function answerMove(path: string): boolean {
  const early = movedEarlyTo(path);
  const last = lastNavigationTo(path);
  if (early && last !== null && last.phase === "VERIFIED") {
    const now = currentRoute();
    if (now !== null && !arrivedAt(path, now)) return false;
  }
  requestMove({ path });
  return true;
}

/** The fast path's move: at once, verified by the one lifecycle. */
export function moveEarly(path: string): void {
  earlyMove = { path, at: Date.now() };
  requestMove({ path });
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
    // The fast path already went there for this sentence: one move, one
    // receipt -- unless that move FAILED, when Q's answer tries it again.
    // R3: the move is executed and verified by the one lifecycle (a move
    // already on its way to this path joins it; to where they already are
    // is VERIFIED at once); a UI act queued after it waits for the page.
    answerMove(path);
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
      effects.goTo(recordIntentPath(action));
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
