import type { QFastNavigationResponse, QUiIntent } from "@capital-q/contracts";
import {
  asksToGo,
  pageRequestOf,
  takenBack,
} from "@capital-q/q-specialists/page-request";

import { destinationPath } from "@/features/voice/destinations";

import {
  noteAsked,
  movedEarlyRecently,
  moveEarly,
  prefetchPath,
  recordPagePath,
  settingsPath,
} from "../client-actions";
import { navigationInFlight } from "../ui-act-controller";

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
        : recordPagePath(intent.page, intent.id);
  }
}

/** Normalised words: the same sentence read twice is the same request. */
function keyOf(text: string): string {
  return text.trim().replace(/\s+/gu, " ").toLowerCase();
}

/** What the partials resolved to, by the words: reused when they end so. */
const resolved = new Map<
  string,
  { readonly at: number; readonly path: Promise<string | null> }
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

function resolve(text: string, final: boolean): Promise<string | null> {
  const here = readHere(text);
  if (here !== "ASK_SERVER") return Promise.resolve(here.path);
  const key = keyOf(text);
  const known = resolved.get(key);
  if (known !== undefined && Date.now() - known.at < RESOLVED_FRESH_MS) {
    return known.path;
  }
  const pending = transport({ text: text.trim(), final })
    .then((decided) =>
      decided.kind === "NAVIGATE" ? pathOfIntent(decided.intent) : null,
    )
    .catch(() => null);
  resolved.delete(key);
  resolved.set(key, { at: Date.now(), path: pending });
  while (resolved.size > RESOLVED_MAX) {
    const oldest = resolved.keys().next().value;
    if (oldest === undefined) break;
    resolved.delete(oldest);
  }
  return pending;
}

export type FastNavigationTiming = {
  readonly path: string;
  /** From the final words to the router push call, in the browser. */
  readonly ms: number;
  /** The push's own synchronous work (the router, not the reader). */
  readonly pushMs: number;
};

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
  const started = performance.now();
  // A page read here moves in this same task: no await, so nothing the
  // send queued (a React render, the run's request) goes first.
  const here = readHere(text);
  const path = here === "ASK_SERVER" ? await resolve(text, true) : here.path;
  if (path === null) return null;
  // The same request heard twice (GPT-Live: the utterance, then the
  // delegation reading the same words) is one move.
  // Only while the screen is there or still on its way: if they moved
  // on since, asking again moves again.
  if (
    movedEarlyRecently(path, SAME_MOVE_MS) &&
    (navigationInFlight() ||
      `${window.location.pathname}${window.location.search}` === path)
  ) {
    return { path, ms: Math.round(performance.now() - started), pushMs: 0 };
  }
  const pushing = performance.now();
  moveEarly(path);
  const timing = {
    path,
    ms: Math.round(pushing - started),
    pushMs: Math.round(performance.now() - pushing),
  };
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(FAST_NAVIGATION_EVENT, { detail: timing }),
    );
  }
  return timing;
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
      void resolve(text, false).then((path) => {
        if (path !== null) prefetchPath(path);
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
