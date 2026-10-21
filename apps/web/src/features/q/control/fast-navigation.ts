import type { QFastNavigationResponse, QUiIntent } from "@capital-q/contracts";
import {
  asksToGo,
  pageRequestOf,
  takenBack,
} from "@capital-q/q-specialists/page-request";

import {
  cardsIntentOf,
  cardsRequestOf,
} from "@capital-q/q-specialists/cards-request";
import { documentAskOf } from "@capital-q/q-specialists/instant-request";
import { tabAskOf } from "@capital-q/q-specialists/tab-request";

import { destinationPath } from "@/features/voice/destinations";

import {
  noteAsked,
  movedEarlyRecently,
  moveEarly,
  openDocumentEarly,
  prefetchPath,
  recordIntentPath,
  settingsPath,
  type EarlyDocument,
} from "../client-actions";
import { applyCardsIntent } from "../cards/card-visibility-store";
import { navigationInFlight } from "../ui-act-controller";
import { instantAct } from "./instant-acts";
import { performOnControl } from "./perform";
import { controlOf, type ControlEntry } from "./registry";

/**
 * RECOVERY-2026-10 (C, founder 2026-10-09: "stupid fast"): the screen moves
 * the moment the person's sentence ends, not when Q's answer lands.
 *
 * - Final words (typed on submit; a voice line's final transcript) go to
 *   the Q API's code-only reader (`/api/q-navigate`), beside Q's run. A
 *   confident page or record moves the screen at once; the answer about
 *   the same sentence does not move it again (client-actions.movedEarlyTo).
 * - Interim words (the voice line's partial transcript) are read too, but
 *   only to prefetch the target. Nothing moves until the words are final
 *   and still mean the same place: "open discover... no wait" never moves.
 * - Anything ambiguous or unknown is left to Q's answer, which asks.
 *
 * One entry for every line (typed, standard voice, duplex, GPT-Live):
 * `navigationHeard(text)` for final words, `navigationHearing(key, text)`
 * for partials.
 */
export const Q_NAVIGATE_ROUTE = "/api/q-navigate";
export const FAST_NAVIGATION_EVENT = "cq:fast-navigation";
const INTERIM_DEBOUNCE_MS = 150;

export type FastNavigationTransport = (body: {
  readonly text: string;
  readonly final: boolean;
  readonly companyId?: string | undefined;
}) => Promise<QFastNavigationResponse>;

export const fetchNavigation: FastNavigationTransport = async (body) => {
  const response = await fetch(Q_NAVIGATE_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!response.ok) return { kind: "LEAVE_TO_Q", ms: 0 };
  return (await response.json()) as QFastNavigationResponse;
};

let transport: FastNavigationTransport = fetchNavigation;
/** Tests replace the network; the page never does. */
export function setNavigationTransport(next: FastNavigationTransport): void {
  transport = next;
}

/** The in-app path an intent goes to, from the app's fixed route maps. */
export function pathOfIntent(
  intent: Extract<
    QUiIntent,
    { kind: "NAVIGATE" | "OPEN_SETTINGS" | "OPEN_RECORD_PAGE" }
  >,
): string | null {
  switch (intent.kind) {
    case "NAVIGATE":
      return destinationPath(intent.destination);
    case "OPEN_SETTINGS":
      return settingsPath(intent.section);
    case "OPEN_RECORD_PAGE":
      // A data-room document opens in the viewer, never as a move.
      return intent.page === "DATA_ROOM_DOCUMENT"
        ? null
        : recordIntentPath(intent);
  }
}

type NavigateIntent = Extract<
  QUiIntent,
  { kind: "NAVIGATE" | "OPEN_SETTINGS" | "OPEN_RECORD_PAGE" }
>;

/**
 * Where the fast path's answer goes: a path to move to, or (Lane 7) a
 * document to open in the viewer over the page they are on.
 */
type Target =
  | { readonly kind: "PATH"; readonly path: string }
  | { readonly kind: "DOCUMENT"; readonly document: EarlyDocument };

function targetOf(intent: NavigateIntent): Target | null {
  if (intent.kind === "OPEN_RECORD_PAGE") {
    if (intent.page === "DATA_ROOM_DOCUMENT") {
      return intent.companyId === undefined
        ? null
        : {
            kind: "DOCUMENT",
            document: {
              kind: "MATERIAL",
              companyId: intent.companyId,
              documentId: intent.id,
              title: intent.title ?? null,
            },
          };
    }
    if (intent.page === "DOCUMENT") {
      return {
        kind: "DOCUMENT",
        document: { kind: "ARTIFACT", artifactId: intent.id },
      };
    }
  }
  const path = pathOfIntent(intent);
  return path === null ? null : { kind: "PATH", path };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Lane 7: the company whose page is on screen, so "open the term sheet"
 * looks in its data room. Input for the Q API, never proof: the document
 * tool authorises the read as the person.
 */
function companyOnScreen(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const match = /^\/(?:company|relationships\/company)\/([^/?#]+)/u.exec(
    window.location.pathname,
  );
  const id = match?.[1] === undefined ? "" : decodeURIComponent(match[1]);
  return UUID.test(id) ? id.toLowerCase() : undefined;
}

/** Normalised words: the same sentence read twice is the same request. */
function keyOf(text: string): string {
  return text.trim().replace(/\s+/gu, " ").toLowerCase();
}

/** What the partials resolved to, by the words: reused when they end so. */
const resolved = new Map<
  string,
  { readonly at: number; readonly target: Promise<Target | null> }
>();
const RESOLVED_MAX = 16;
/** A reading older than this is read again (a relationship may change). */
const RESOLVED_FRESH_MS = 30_000;

/**
 * A page by its name needs no one's authority (each page authorises
 * itself) and no network: read here with the Q API's own reader, so it
 * moves in the same frame. Only a record by its name goes to the server.
 * Same order as the server: taken back, then a page, then a record.
 */
function readHere(text: string): { path: string | null } | "ASK_SERVER" {
  const said = text.trim();
  if (said.length === 0 || said.length > 300 || takenBack(said)) {
    return { path: null };
  }
  const page = pageRequestOf(said);
  if (page === null) return asksToGo(said) ? "ASK_SERVER" : { path: null };
  if (page.kind === "UNKNOWN") return { path: null };
  return {
    path:
      page.target.kind === "SETTINGS"
        ? settingsPath(page.target.section)
        : destinationPath(page.target.destination),
  };
}

function resolve(text: string, final: boolean): Promise<Target | null> {
  const here = readHere(text);
  if (here !== "ASK_SERVER") {
    return Promise.resolve(
      here.path === null ? null : { kind: "PATH", path: here.path },
    );
  }
  const companyId = companyOnScreen();
  const key = `${companyId ?? ""}|${keyOf(text)}`;
  const known = resolved.get(key);
  if (known !== undefined && Date.now() - known.at < RESOLVED_FRESH_MS) {
    return known.target;
  }
  const pending = transport({
    text: text.trim(),
    final,
    ...(companyId === undefined ? {} : { companyId }),
  })
    .then((decided) =>
      decided.kind === "NAVIGATE" ? targetOf(decided.intent) : null,
    )
    .catch(() => null);
  resolved.delete(key);
  resolved.set(key, { at: Date.now(), target: pending });
  while (resolved.size > RESOLVED_MAX) {
    const oldest = resolved.keys().next().value;
    if (oldest === undefined) break;
    resolved.delete(oldest);
  }
  return pending;
}

export type FastNavigationTiming = {
  /**
   * What was done: a move (its path), or (Lane 7) a page's own tab, an
   * act on the page or a document opened over it ("#tab.deck", "#close",
   * "#document"), for which no route receipt ever comes.
   */
  readonly path: string;
  /** False when nothing moved the route (a tab, an act, a document). */
  readonly route: boolean;
  /** From the final words to the router push call, in the browser. */
  readonly ms: number;
  /** The push's own synchronous work (the router, not the reader). */
  readonly pushMs: number;
};

/**
 * The page's own tab the words name ("open the data room", "now the pitch
 * deck"), when this page registered it; null otherwise. A tab of another
 * record ("Nixo's team tab") or a deck/profile section is left to Q.
 */
function tabHere(
  text: string,
): { readonly id: string; readonly entry: ControlEntry } | null {
  const said = text.trim();
  if (said.length === 0 || said.length > 160 || takenBack(said)) return null;
  const ask = tabAskOf(said);
  if (
    ask === null ||
    ask.name !== null ||
    ask.subTab !== null ||
    ask.section !== undefined
  ) {
    return null;
  }
  const id = `tab.${ask.tab}`;
  const entry = controlOf(id);
  return entry === undefined ? null : { id, entry };
}

/** Within this, a move to where the fast path just went is not repeated. */
const SAME_MOVE_MS = 10_000;

/**
 * Final words: move now when they plainly name one page or record. Never
 * throws; resolves to the move made, or null when Q's answer decides.
 */
export async function navigationHeard(
  text: string,
): Promise<FastNavigationTiming | null> {
  if (keyOf(text).length === 0) return null;
  // Every finished sentence (typed, any voice line) passes here first.
  noteAsked();
  const now = actedNow(text);
  if (now !== null) return now;
  // Founder P5: "Q, clear all cards" acts in this same task, by code, with
  // no server round trip. Presentation only; Q's answer says it too, and
  // the controller acts once for the same words.
  const cards = cardsRequestOf(text);
  if (cards !== null) {
    applyCardsIntent(cardsIntentOf(cards));
    return null;
  }
  const started = performance.now();
  // Owner 2026-10-17/20 ("open the data room", "now the pitch deck" took
  // 1.6-2 s, after a turn reading): a tab of the page on screen, named
  // with no record, is that page's own registered control, selected here
  // in this task. Presentation only -- the page already authorised itself;
  // Q's answer selects the same tab again, which changes nothing.
  const tab = tabHere(text);
  if (tab !== null) {
    void performOnControl(tab.entry, {
      kind: "UI_ACT",
      actId: `uia_fast_${Date.now().toString(36)}`,
      act: "SELECT_TAB",
      target: tab.id,
    }).catch(() => undefined);
    const timing = {
      path: `#${tab.id}`,
      route: false,
      ms: Math.round(performance.now() - started),
      pushMs: 0,
    };
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(FAST_NAVIGATION_EVENT, { detail: timing }),
      );
    }
    return timing;
  }
  // A page read here moves in this same task: no await, so nothing the
  // send queued (a React render, the run's request) goes first.
  const here = readHere(text);
  const target =
    here === "ASK_SERVER"
      ? await resolve(text, true)
      : here.path === null
        ? null
        : ({ kind: "PATH", path: here.path } as const);
  if (target === null) return null;
  // Lane 7: a document opens in the viewer over the page they are on; Q's
  // answer naming the same document does not open it again.
  if (target.kind === "DOCUMENT") {
    openDocumentEarly(target.document);
    return announce({
      path: "#document",
      route: false,
      ms: Math.round(performance.now() - started),
      pushMs: 0,
    });
  }
  const path = target.path;
  // The same request heard twice (GPT-Live: the utterance, then the
  // delegation reading the same words) is one move.
  // Only while the screen is there or still on its way: if they moved
  // on since, asking again moves again.
  if (
    movedEarlyRecently(path, SAME_MOVE_MS) &&
    (navigationInFlight() ||
      `${window.location.pathname}${window.location.search}` === path)
  ) {
    return {
      path,
      route: true,
      ms: Math.round(performance.now() - started),
      pushMs: 0,
    };
  }
  const pushing = performance.now();
  moveEarly(path);
  return announce({
    path,
    route: true,
    ms: Math.round(pushing - started),
    pushMs: Math.round(performance.now() - pushing),
  });
}

function announce(timing: FastNavigationTiming): FastNavigationTiming {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(FAST_NAVIGATION_EVENT, { detail: timing }),
    );
  }
  return timing;
}

/**
 * Lane 7: close, back, scroll or a control by its name, done now in this
 * task with no server and no model; null when the words make no such
 * request or the screen cannot plainly do it (Q's answer decides).
 */
function actedNow(text: string): FastNavigationTiming | null {
  const started = performance.now();
  const done = instantAct(text);
  if (done === null) return null;
  return announce({
    path: `#${done.what.toLowerCase()}`,
    route: false,
    ms: Math.round(performance.now() - started),
    pushMs: 0,
  });
}

/**
 * Lane 7: the words ask for a document by its name, which the Q API finds
 * among those the person may open (the typed line waits for it, briefly).
 */
export function documentAsked(text: string): boolean {
  return documentAskOf(text) !== null;
}

/**
 * Lane 7, the typed line: a request the screen did by itself, here and
 * now (close, back, scroll, a control by its name). True: done, and the
 * sentence needs no turn of Q's -- the screen is the confirmation.
 */
export function actedHere(text: string): boolean {
  if (keyOf(text).length === 0) return false;
  const done = actedNow(text);
  if (done === null) return false;
  noteAsked();
  return true;
}

const hearing = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Interim words, per utterance key: read (debounced) and the target
 * prefetched, so the move at the end costs nothing. Never moves.
 */
export function navigationHearing(key: string, text: string): void {
  const waiting = hearing.get(key);
  if (waiting !== undefined) clearTimeout(waiting);
  if (keyOf(text).length < 4) return;
  hearing.set(
    key,
    setTimeout(() => {
      hearing.delete(key);
      void resolve(text, false).then((target) => {
        if (target?.kind === "PATH") prefetchPath(target.path);
      });
    }, INTERIM_DEBOUNCE_MS),
  );
}

/**
 * Latency (typed send->VERIFIED): the words in the typed composer, as they
 * change. A record by its name is resolved (the server's prepared reading
 * context warmed: ~2 s cold when hosted) and its page prefetched while
 * they type, so Send moves at once. Never moves; only a request to go
 * somewhere is read at all.
 */
export function navigationTyping(text: string): void {
  navigationHearing(TYPED_KEY, text);
}
const TYPED_KEY = "typed-composer";

/** A composer's `input` event (bubbled to its wrapper): its words, read. */
export function readTypedDraft(event: {
  readonly target: EventTarget | null;
}): void {
  const field = event.target;
  if (
    typeof HTMLTextAreaElement !== "undefined" &&
    field instanceof HTMLTextAreaElement &&
    field.hasAttribute("data-q-composer-input")
  ) {
    navigationTyping(field.value);
  }
}

/** Partial words so far, per utterance (a line that streams deltas). */
const partials = new Map<string, string>();
const PARTIALS_MAX = 8;

/**
 * A partial transcript's next piece (the duplex line's
 * `input_audio_transcription.delta`, GPT-Live's `input_transcript.delta`):
 * appended to the utterance so far, then read as `navigationHearing`.
 */
export function navigationHearingDelta(key: string, delta: string): void {
  const so = `${partials.get(key) ?? ""}${delta}`.slice(-300);
  partials.delete(key);
  partials.set(key, so);
  while (partials.size > PARTIALS_MAX) {
    const oldest = partials.keys().next().value;
    if (oldest === undefined) break;
    partials.delete(oldest);
  }
  navigationHearing(key, so);
}

/**
 * A request cut off after its verb ("open..." then, after a pause, "Halyard
 * Security"): a voice line that ends an utterance on a quiet gap splits it
 * in two, and neither half names anything.
 */
const DANGLING_VERB =
  /\b(?:open(?:\s+up)?|take\s+me(?:\s+back)?(?:\s+to)?|go\s+(?:back\s+)?to|pull\s+up|bring\s+up|show\s+me|navigate\s+to|switch\s+to|jump\s+to|head\s+to)[\s,.\-\u2014\u2026]*$/iu;
/** How long a cut-off verb waits for the rest of its request. */
const DANGLING_MS = 5_000;
let dangling: { readonly text: string; readonly at: number } | null = null;

/** Final words of an utterance whose partials were streamed: read, then forgotten. */
export function navigationHeardFor(
  key: string,
  text: string,
): Promise<FastNavigationTiming | null> {
  partials.delete(key);
  const waiting = hearing.get(key);
  if (waiting !== undefined) clearTimeout(waiting);
  hearing.delete(key);
  const carried =
    dangling !== null && Date.now() - dangling.at <= DANGLING_MS
      ? `${dangling.text} ${text.trim()}`
      : text.trim();
  dangling = null;
  if (DANGLING_VERB.test(carried)) {
    dangling = {
      text: carried.replace(/[\s,.\-\u2014\u2026]+$/u, ""),
      at: Date.now(),
    };
    return Promise.resolve(null);
  }
  return navigationHeard(carried);
}

/** Clears what partials resolved (tests). */
export function resetFastNavigation(): void {
  resolved.clear();
  partials.clear();
  dangling = null;
  for (const timer of hearing.values()) clearTimeout(timer);
  hearing.clear();
  transport = fetchNavigation;
}
