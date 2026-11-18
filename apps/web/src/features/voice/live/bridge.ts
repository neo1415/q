import type { LiveMove } from "./move";

/**
 * The GPT-Live client delegation bridge (workstream V).
 *
 * GPT-Live is the voice; Q Brain is the authority. When the voice decides
 * a turn needs the backend it emits `session.delegation.created`, which
 * carries an id and nothing else (OpenAI live-delegation guide). This
 * bridge rebuilds the request from the transcript it has kept, asks Q
 * Brain once per delegation id, and hands back only what Q verified.
 *
 * Owner 14 Nov 2026 ("the voice is doing its own thing and Q is doing its
 * own thing"): with `routing`, code -- not the voice model -- decides who
 * answers a finished utterance, as the duplex line does
 * (duplex/routing.ts): everything but closed-set small talk goes to Q,
 * whether or not the voice delegates it. Q's words are said verbatim, and
 * while Q works the voice says at most one code-chosen holding line.
 *
 * Rules:
 *
 * - one delegation id → one Q run, whatever the provider repeats;
 * - an interruption never starts or cancels a run (the voice yielding the
 *   floor is not "cancel"); cancelling is explicit and confirmed first;
 * - a newer delegation supersedes an older one: the older result is kept
 *   as quiet context (`session.thinking.append`) so "the second one" keeps
 *   its referent, but it is never spoken over the newer question;
 * - progress is said at most once, quietly, never as filler: one
 *   code-chosen holding line per utterance, only while a run is still
 *   going after `progressAfterMs`, never stacked (audit 15 Nov RC1);
 * - "say that again" replays Q's last words exactly, by code;
 * - one sentence a pause split ("Thank you. Um. So, which problems…") is
 *   one request: the rest joins it and replaces the run on its first half;
 * - what the voice said is checked against the words it was handed.
 *
 * Dependency-free (no React, no DOM, no Zod) so the browser preview and
 * the recording harness (Node type stripping) run the same code.
 */

export type LiveServerEvent = {
  readonly type: string;
  readonly [key: string]: unknown;
};

export type LiveClientEvent = {
  readonly type:
    | "session.commentary.append"
    | "session.thinking.append"
    | "session.instructions.append";
  readonly event_id: string;
  readonly delegation_id: string | null;
  readonly content: string;
};

/** What Q Brain answered for one delegation. */
export type DelegationOutcome = {
  /** Verified facts or Q's own words, for the voice to say in its words. */
  readonly commentary: string | null;
  /** The server already knows a newer delegation replaced this one. */
  readonly stale?: boolean | undefined;
  /** Q prepared something that waits for the person's approval on screen. */
  readonly approvalPending?: boolean | undefined;
  /** Q could not answer; `commentary` then says so truthfully. */
  readonly failed?: boolean | undefined;
  /** Q's run moved the screen (followed before it is spoken). */
  readonly move?: LiveMove | undefined;
  /**
   * Only the start of the answer, for the voice to say now; the same
   * delegation asked again (without `early`) returns the rest.
   */
  readonly partial?: boolean | undefined;
  /**
   * With `partial`: the line's one holding line, chosen by the Q API for a
   * wait that is real (owner 18 Nov 2026), not the answer's start. Said,
   * then the same delegation is asked again, early, for the first words.
   */
  readonly holding?: true | undefined;
  /**
   * Q's exact words inside `commentary` (RC5). Present: the bridge says
   * them itself (so a move's receipt can edit them by code), replays them
   * for "say that again", and checks what the voice said against them.
   */
  readonly said?: string | null | undefined;
  /** The Q run the words come from (RC5). */
  readonly runId?: string | undefined;
};

/** What a screen move's receipt said, for the words that follow it. */
export type MoveReceipt = "DONE" | "FAILED" | "PENDING";

/** One line of exact words handed to the voice (RC5 telemetry). */
export type HandedLine = {
  readonly words: string;
  readonly kind: "ANSWER" | "HOLDING" | "REPEAT";
  readonly runId?: string | undefined;
  readonly delegationId: string | null;
  readonly at: number;
};

/**
 * Code routes the person's turns (owner 14 Nov 2026). Absent: the voice
 * holds the call itself (the onboarding interview, a rehearsal persona).
 */
export type LiveRouting = {
  /** The one small-talk classifier (contracts: isQVoiceSmallTalk). */
  readonly isSmallTalk: (text: string) => boolean;
  /** Q leads this call (the guided welcome): small talk is Q's too. */
  readonly guided?: boolean | undefined;
};

export type DelegationRequest = {
  readonly delegationId: string;
  /** The person's words since the previous delegation. */
  readonly request: string;
  /** The recent exchange, oldest first, so references resolve. */
  readonly context: readonly {
    readonly role: "user" | "q";
    readonly text: string;
  }[];
  /** Ask for the start of the answer as soon as Q has verified some. */
  readonly early?: boolean | undefined;
  /** The voice's playback of Q's last line stopped before its end. */
  readonly lastLineCut?: boolean | undefined;
  /** The earlier delegation this one's words complete (a split utterance). */
  readonly replaces?: string | undefined;
};

export type Timers = {
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

export type LiveBridgeDependencies = {
  /** Sends one client event to the provider (data channel or socket). */
  readonly send: (event: LiveClientEvent) => void;
  /** Q Brain, once per delegation id. */
  readonly delegate: (request: DelegationRequest) => Promise<DelegationOutcome>;
  /** Asks the server to stop a run; true only once it confirmed. */
  readonly cancel?: ((delegationId: string) => Promise<boolean>) | undefined;
  readonly newEventId: () => string;
  readonly now: () => number;
  readonly timers?: Timers | undefined;
  /** How long the transcript may settle before the request is read. */
  readonly settleMs?: number | undefined;
  /**
   * The call opening (founder 2026-10-09): a warm hello at once, then the
   * lowdown when Q Brain's briefing lands. GPT-Live does not speak first on
   * its own (recorded 2026-10-09), so the app starts both: the greeting as
   * session instructions, the briefing as its own Q run, spoken through
   * commentary when it arrives. A question of theirs asked before it lands
   * supersedes it (kept as quiet context, never spoken over them).
   */
  readonly opening?:
    | {
        readonly greeting: string;
        /** A Q run for the briefing, spoken when it lands. */
        readonly request?: string | undefined;
        /**
         * Or Q's opening already in hand (the surface's first message, Q's
         * own verified words): said in the voice's own words at once.
         */
        readonly content?: string | undefined;
      }
    | undefined;
  /**
   * When a still-running delegation gets its one progress line (founder
   * 2026-10-09: silence while a 25 s answer worked read as "can you do it
   * or not"). Spoken once, in the voice's own words; never repeated.
   */
  readonly progressAfterMs?: number | undefined;
  readonly onChange?: ((state: LiveBridgeState) => void) | undefined;
  /**
   * Runs before a result is spoken. Returns what the voice must know about
   * the screen (the move's receipt), or null. A run that moved the screen
   * is followed and its receipt awaited here, so the voice never says a
   * page is open before it is (founder live 2026-10-09).
   */
  readonly beforeSpeak?:
    ((outcome: DelegationOutcome) => Promise<string | null>) | undefined;
  /**
   * Follows a run's screen move and returns its receipt (null: nothing to
   * follow). Used instead of `beforeSpeak` when Q's exact words came back:
   * code then drops a claim that a page is open unless the receipt is
   * DONE, and never says it is "coming up" (audit 15 Nov RC1).
   */
  readonly followMove?:
    ((outcome: DelegationOutcome) => Promise<MoveReceipt | null>) | undefined;
  /**
   * Who answers a finished utterance, read when it finishes (the line's
   * mode is known only once it opened). Null or absent: the voice decides.
   */
  readonly routing?: (() => LiveRouting | null) | undefined;
  /**
   * How long their words must be quiet before code reads the utterance as
   * finished and routes it, if the voice has not delegated it by then.
   */
  readonly routeAfterMs?: number | undefined;
  /**
   * How much longer code waits when their words so far end unfinished
   * (a filler, "so", "and", a comma): a pause mid-sentence is not the end.
   */
  readonly continueAfterMs?: number | undefined;
  /**
   * How long after a run started on part of an utterance the rest may
   * still join it (replacing that run), while it has said nothing yet.
   */
  readonly mergeWithinMs?: number | undefined;
};

export type DelegationStatus =
  | "WAITING_FOR_WORDS"
  /** Nothing usable was heard: no Q run; the voice checks with them. */
  | "UNHEARD"
  | "RUNNING"
  | "SPOKEN"
  | "SUPERSEDED"
  | "FAILED"
  | "CANCELLED";

export type DelegationRecord = {
  readonly id: string;
  /**
   * The provider's delegation id; null for the app's own (the opening, a
   * typed or code-routed turn) until the voice delegates the same words.
   */
  providerId: string | null;
  request: string;
  status: DelegationStatus;
  readonly createdAt: number;
  answeredAt?: number | undefined;
  commentary?: string | null | undefined;
  approvalPending?: boolean | undefined;
  /** The exchange sent with the request (read before the window moves). */
  context?: DelegationRequest["context"] | undefined;
  /** Q's exact words the voice was handed for this run, in order. */
  said?: string | undefined;
  /** Something of this run has been handed to the voice. */
  voiced?: boolean | undefined;
};

export type LiveBridgeState = {
  readonly delegations: readonly DelegationRecord[];
  readonly transcript: readonly {
    readonly role: "user" | "q";
    readonly text: string;
  }[];
  /** Client events the provider acknowledged, and ones it refused. */
  readonly acked: number;
  readonly refused: readonly {
    readonly eventId: string;
    readonly message: string;
  }[];
};

export type LiveBridge = {
  /** Feed every provider event here, in order. */
  readonly handle: (event: LiveServerEvent) => void;
  /** Explicit cancel; true only when the server confirmed it. */
  readonly cancel: (delegationId: string) => Promise<boolean>;
  /**
   * Typed words while the call is open: straight to Q Brain (the provider
   * does not hear them), the verified answer spoken like any other.
   */
  readonly typed: (text: string) => void;
  /**
   * Q Pitch narration: one approved, pre-written line for Q to say aloud,
   * verbatim, on this same call (owner 15 Oct: the tour speaks in Q's live
   * voice). Commentary, so it is spoken now; never a delegation, so it is
   * not a request and Q Brain does not answer it.
   */
  readonly narrate: (text: string) => void;
  /** Standing instructions for the rest of the call (a Q Pitch tour brief). */
  readonly brief: (text: string) => void;
  readonly state: () => LiveBridgeState;
  /**
   * The exact lines handed to the voice since the last call, oldest first
   * (RC5): what a reply that just finished was told to say.
   */
  readonly takeHanded: () => readonly HandedLine[];
};

/** OpenAI caps each append at 500 tokens; characters are a safe bound. */
export const LIVE_APPEND_MAX_CHARS = 1_800;
/** The delegation contract's bound on context turns. */
const CONTEXT_MAX = 12;
const SETTLE_MAX_MS = 1_500;
/**
 * When the words read so far are only a transcriber marker or filler, how
 * much longer the bridge waits for the transcript to complete.
 */
export const UNHEARD_WAIT_MS = 700;

/*
 * V (production 2026-10-09 15:57 UTC): GPT-Live's input transcript for the
 * founder's fintech request came through as "(inaudible)" three times; each
 * became a Q run with nothing to answer, and then only the fragment
 * "especially across FinTech" reached Q Brain. A marker, empty text or
 * filler alone is never a request (q-api checks the same: heard.ts).
 */
const MARKER =
  /[([]\s*(?:inaudible|unintelligible|indistinct|crosstalk|silence|noise|music|laughter|laughs|applause|blank[_ ]audio|no speech|unclear)[^)\]]{0,40}[)\]]/giu;
/** Hesitations only; "yes", "okay", "mhm" and "uh-huh" can answer Q. */
const FILLER = new Set([
  "um",
  "umm",
  "uh",
  "uhh",
  "er",
  "erm",
  "hmm",
  "hm",
  "ah",
  "eh",
]);

/** The words, without the transcriber's markers. */
export function spokenWords(text: string): string {
  return text.replace(MARKER, " ").replace(/\s+/gu, " ").trim();
}

/** Whether there is anything to ask Q: some word that is not filler. */
export function heardRequest(text: string): boolean {
  return spokenWords(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}'-]+/u)
    .some((word) => word.length > 0 && !FILLER.has(word));
}

/** What the voice is told when nothing usable was heard. */
export const UNHEARD_COMMENTARY =
  "Their words did not reach the backend clearly, so nothing was asked. If you understood them, say back in a few words what you think they want and ask them to confirm; if you did not, ask them naturally to say it again. Do not say anything failed or went wrong.";

/**
 * Q's words, for the voice to say exactly (owner 14 Nov 2026: "say exactly
 * this, add nothing"). GPT-Live has no exact-text speech call: commentary
 * with this instruction is the strongest it offers (the Q Pitch narration
 * uses the same). q-api's live broker sends the same for Q's answers.
 */
export function sayExactly(words: string): string {
  return `Say exactly the following words aloud, as yourself, in their order, and nothing else: no lead-in, no summary, no opinion, no question or offer of your own, nothing before or after them. Words: ${words}`;
}

/**
 * The one holding line while a real Q run works (owner 14 Nov 2026): code
 * chooses it, it claims nothing about the result, and it asks nothing.
 */
export const HOLDING_LINE = "Working on it.";
/** The fallback's other words, so the same line is never said twice in a row. */
export const HOLDING_LINE_ALTERNATE = "On it.";
export function holdingContentFor(line: string): string {
  return `Say only this short line aloud, once, in the language you are speaking with them, and nothing else: "${line}" Ask nothing, and say nothing about what the answer will be.`;
}
export const HOLDING_CONTENT = holdingContentFor(HOLDING_LINE);
/**
 * The client's own holding line is a fallback for a very long silence only
 * (owner 18 Nov 2026): the Q API chooses the line for a wait that is real
 * (`holding` results) and never for a turn answered at once.
 */
export const PROGRESS_AFTER_MS = 12_000;

/** What the voice says when Q's run did not come back. */
export const NOT_FINISHED_LINE =
  "I couldn't get that done just now. Want me to try it again?";

/**
 * Sent when code hands their words to Q: the voice neither answers them
 * nor fills the wait with questions of its own.
 */
export const ROUTED_NOTE =
  "Capital Q has handed their last words to Q's backend. Do not answer them yourself and do not ask them anything; say nothing until you are told what to say.";

/** Quiet this long after their words: an utterance the voice did not delegate is routed by code. */
export const ROUTE_AFTER_MS = 1_500;
/** The extra wait when their words end unfinished ("…Um. So"). */
export const CONTINUE_AFTER_MS = 1_800;
/** The rest of a split utterance joins the run on its first part this soon. */
export const MERGE_WITHIN_MS = 8_000;

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter((word) => word.length > 0);

/** Words that leave a sentence open when it stops on them. */
const OPEN_ENDINGS = new Set([
  ...FILLER,
  "so",
  "and",
  "but",
  "or",
  "because",
  "like",
  "then",
  "the",
  "a",
  "an",
  "to",
  "of",
  "with",
  "which",
  "that",
  "if",
  "for",
  "about",
  "my",
  "your",
  "is",
  "are",
  "was",
  "what",
  "how",
  "when",
  "where",
  "who",
  "whether",
  "also",
  "plus",
]);

/**
 * Whether their words so far stop mid-sentence: on a filler or a word that
 * leaves the sentence open, a comma, a dash or an ellipsis (founder audit
 * 15 Nov F7-03: "Thank you. Um. So" was routed alone).
 */
export function endsUnfinished(text: string): boolean {
  const said = spokenWords(text).trim();
  if (said.length === 0) return false;
  if (/(?:,|;|:|…|\.\.\.|-|–|—)$/u.test(said)) return true;
  const last = wordsOf(said).at(-1);
  return last !== undefined && OPEN_ENDINGS.has(last);
}

const REQUEST_OPENERS = new Set([
  "can",
  "could",
  "would",
  "will",
  "should",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "why",
  "how",
  "is",
  "are",
  "do",
  "does",
  "did",
  "show",
  "open",
  "tell",
  "give",
  "find",
  "compare",
  "send",
  "draft",
  "take",
  "go",
  "list",
  "explain",
  "summarise",
  "summarize",
  "help",
  "please",
  "let's",
  "check",
  "book",
  "schedule",
  "prepare",
  "write",
  "remind",
  "read",
  "approve",
  "decline",
  "cancel",
  "stop",
  "start",
  "what's",
  "who's",
  "how's",
  "where's",
  "rank",
  "sort",
  "search",
  "pull",
  "bring",
  "run",
  "rerun",
  "exclude",
  "leave",
  "remove",
  "add",
  "update",
  "change",
  "set",
]);

/** Words that carry a sentence on from the words before them. */
const CONTINUING = new Set([
  "just",
  "and",
  "but",
  "so",
  "which",
  "because",
  "or",
  "also",
  "then",
  "like",
  "plus",
  "sorry",
  "actually",
  "rather",
  "especially",
  "than",
  "to",
  "of",
  "for",
  "with",
]);

/**
 * Whether the next words carry on the sentence before them rather than
 * start a request of their own: they open on a carrying word ("Just
 * confirm…", "and which…", ", which problems…") and are not a whole
 * question by themselves. "I'm waiting" and "wait, what about the second
 * one?" are new turns, never merged.
 */
export function continuesSentence(text: string): boolean {
  const said = spokenWords(text).trim();
  if (said.length === 0) return false;
  if (/\?["'”’)]*$/u.test(said) && !/^[,;:–—-]/u.test(said)) return false;
  if (/^[,;:–—-]/u.test(said)) return true;
  const first = wordsOf(said).find((word) => !FILLER.has(word));
  if (first === "i") return /^i mean\b/iu.test(said);
  return first !== undefined && CONTINUING.has(first);
}

/**
 * Whether a piece of an utterance already makes a whole request: a
 * question, or a sentence that opens as one ("show me…", "what is…") and
 * does not stop mid-sentence. "I thought Zino Aviation was the first."
 * is not (founder F7-22: its "Just confirm…" came as a second run).
 */
export function completeRequest(text: string): boolean {
  const said = spokenWords(text).trim();
  if (said.length === 0 || endsUnfinished(said)) return false;
  if (/\?["'”’)]*$/u.test(said)) return true;
  const sentences = said
    .split(/(?<=[.!?])\s+/u)
    .filter((part) => part.length > 0);
  const lastSentence = sentences.at(-1) ?? said;
  const words = wordsOf(lastSentence).filter((word) => !FILLER.has(word));
  const first =
    words[0] === "i" &&
    (words[1] === "want" || words[1] === "need" || words[1] === "'d")
      ? "please"
      : words[0];
  return first !== undefined && REQUEST_OPENERS.has(first) && words.length >= 2;
}

/** Words that may surround a request to hear the last line again. */
const REPEAT_FRAME = new Set([
  "no",
  "sorry",
  "i",
  "meant",
  "mean",
  "just",
  "please",
  "can",
  "could",
  "would",
  "will",
  "you",
  "that",
  "it",
  "this",
  "the",
  "last",
  "answer",
  "thing",
  "part",
  "bit",
  "line",
  "one",
  "explanation",
  "again",
  "gave",
  "said",
  "your",
  "what",
  "me",
  "for",
  "once",
  "more",
]);

/**
 * "Repeat that", "say that again", "can you repeat that last answer you
 * just gave", "no, I meant just repeat the explanation", "come again",
 * "pardon": a closed set, read by code, never a meaning guess. Founder
 * audit 15 Nov F7-15/F7-16: the voice answered these itself, in its own
 * words, with claims Q never made.
 */
export function asksToRepeat(text: string): boolean {
  const words = wordsOf(spokenWords(text)).filter((word) => !FILLER.has(word));
  if (words.length === 0 || words.length > 14) return false;
  const joined = words.join(" ");
  if (/^(?:pardon|come again)(?: please)?$/u.test(joined)) return true;
  if (/^(?:sorry )?what did you (?:just )?say$/u.test(joined)) return true;
  const verb = words.findIndex(
    (word, index) =>
      word === "repeat" ||
      (word === "say" && words.slice(index + 1).includes("again")),
  );
  if (verb < 0) return false;
  return words.every(
    (word, index) =>
      index === verb ||
      word === "say" ||
      word === "repeat" ||
      REPEAT_FRAME.has(word),
  );
}

/**
 * A sentence of Q's that says a page is open or on its way, written before
 * their screen moved (R3): dropped by code unless the receipt was DONE.
 */
const ARRIVAL_SENTENCE =
  /^(?:(?:okay|ok|right|sure|done)[,.]?\s+)?(?:i(?:'ve| have)\s+(?:now\s+)?(?:opened|brought up|pulled up|put up)|opening\b|up now\b|here(?:'s| is)\b[^.]*\b(?:page|screen|open)|(?:it|the page|[^.]{0,60}\bpage)\s+(?:is|'s)\s+(?:now\s+)?(?:open|up|coming up|loading|ready)|[^.]{0,80}\b(?:is|are)\s+(?:now\s+)?(?:open|up) (?:on|in front of) (?:your|their) screen)/iu;

/** Q's words without its claims about a page (receipt not DONE). */
export function withoutArrival(words: string): string {
  return words
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => !ARRIVAL_SENTENCE.test(sentence.trim()))
    .join(" ")
    .trim();
}

/** How long their quiet must last before an answer is handed over them. */
export const QUIET_BEFORE_SPEAK_MS = 700;

/**
 * A nudge about work already asked for ("still waiting", "are you there",
 * "can you do it or not"): a closed set, read by code. It never makes an
 * earlier answer past (the founder's 25 s answer, live 2026-10-09).
 */
export function isNudge(text: string): boolean {
  const words = wordsOf(spokenWords(text)).filter((word) => !FILLER.has(word));
  if (words.length === 0 || words.length > 10) return false;
  return /^(?:(?:hello|hey|so|okay|ok|well|q)\s+)*(?:i'?m\s+(?:still\s+)?waiting|still\s+waiting|are\s+you\s+(?:still\s+)?(?:there|with\s+me|working(?:\s+on\s+it)?|done)|you\s+there|hello|can\s+you\s+(?:do\s+it|hear\s+me)|any\s+(?:news|update)|is\s+it\s+(?:coming|done|ready)|how\s+far|what'?s\s+taking\s+(?:so\s+)?long)\b/u.test(
    words.join(" "),
  );
}

/** Said by code when a run's page move did not open. */
export const MOVE_FAILED_LINE = "That page didn't open on your screen.";

const normalised = (text: string): string[] =>
  wordsOf(text.replace(/[-–—]/gu, " "));

/**
 * What the voice said against the words it was handed (RC5): `diverged`
 * when it added, dropped or changed any word; `cut` when it stopped before
 * the end of them.
 */
export function compareSpoken(
  handed: string,
  heard: string,
): { readonly diverged: boolean; readonly cut: boolean } {
  const expected = normalised(handed);
  const got = normalised(heard);
  const diverged = expected.join(" ") !== got.join(" ");
  if (expected.length === 0) return { diverged, cut: false };
  // Cut: the end of what it was handed never came (its last words).
  const tail = expected.slice(-Math.min(3, expected.length)).join(" ");
  const cut = !` ${got.join(" ")} `.includes(` ${tail} `);
  return { diverged, cut };
}
/** A voice delegation this soon after code routed the same words joins that run. */
const JOIN_WITHIN_MS = 15_000;
/** The id of a turn code routed to Q (its own record, like typed_N). */
const ROUTED_PREFIX = "heard_";
const OPENING_ID = "opening";
const TRANSCRIPT_KEPT = 60;

export function boundedContent(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= LIVE_APPEND_MAX_CHARS
    ? clean
    : `${clean.slice(0, LIVE_APPEND_MAX_CHARS - 1)}…`;
}

const defaultTimers: Timers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function createLiveBridge(deps: LiveBridgeDependencies): LiveBridge {
  const timers = deps.timers ?? defaultTimers;
  const settleMs = deps.settleMs ?? 400;
  const progressAfterMs = deps.progressAfterMs ?? PROGRESS_AFTER_MS;
  const routeAfterMs = deps.routeAfterMs ?? ROUTE_AFTER_MS;
  const continueAfterMs = deps.continueAfterMs ?? CONTINUE_AFTER_MS;
  const mergeWithinMs = deps.mergeWithinMs ?? MERGE_WITHIN_MS;
  let routeTimer: unknown = null;
  let routeExtended = false;
  let routedCount = 0;
  // RC1: one holding line per utterance of theirs, never stacked.
  let heldSinceTheySpoke = false;
  // The last holding words said, so the next is never the same.
  let lastHoldWords: string | null = null;
  // RC5: the exact lines handed to the voice, until live-call takes them.
  const handedLog: HandedLine[] = [];
  // The last answer line handed, and what the voice has said of it, to
  // tell whether its playback was cut before the end.
  let check: { words: string; heard: string } | null = null;
  let lastLineCut = false;
  // The transcript as the provider streamed it, both sides, in turns. A
  // turn changes side when the other side's delta arrives.
  const transcript: { role: "user" | "q"; text: string }[] = [];
  // The index of the first transcript turn not yet asked about.
  let askedUpTo = 0;
  // Words after a delegation read its request start a turn of their own,
  // even mid-utterance: they belong to the next request, not that one.
  let boundary = false;
  let lastInputAt = 0;
  const delegations = new Map<string, DelegationRecord>();
  const order: string[] = [];
  let acked = 0;
  const refused: { eventId: string; message: string }[] = [];
  const pendingEvents = new Set<string>();
  let openingStarted = false;
  let typedCount = 0;

  const changed = () => deps.onChange?.(snapshot());
  const snapshot = (): LiveBridgeState => ({
    delegations: order.flatMap((id) => {
      const record = delegations.get(id);
      return record === undefined ? [] : [{ ...record }];
    }),
    transcript: transcript.map((turn) => ({ ...turn })),
    acked,
    refused: [...refused],
  });

  const append = (role: "user" | "q", delta: string) => {
    if (delta.length === 0) return;
    const last = transcript[transcript.length - 1];
    if (last !== undefined && last.role === role && !boundary) {
      last.text += delta;
    } else transcript.push({ role, text: delta });
    boundary = false;
    if (transcript.length > TRANSCRIPT_KEPT) {
      const drop = transcript.length - TRANSCRIPT_KEPT;
      transcript.splice(0, drop);
      askedUpTo = Math.max(0, askedUpTo - drop);
    }
  };

  const send = (
    type: LiveClientEvent["type"],
    delegationId: string | null,
    content: string,
  ) => {
    const eventId = deps.newEventId();
    pendingEvents.add(eventId);
    deps.send({
      type,
      event_id: eventId,
      delegation_id: delegationId,
      content: boundedContent(content),
    });
  };

  /**
   * The person's whole utterance window since the last delegation, every
   * piece of it, without transcriber markers. Only when they said nothing
   * new at all does it fall back to their last words; a window of
   * "(inaudible)" is empty, never an older request asked again.
   */
  const readRequest = (): string => {
    const window = transcript
      .slice(askedUpTo)
      .filter((turn) => turn.role === "user");
    const words = window
      .map((turn) => spokenWords(turn.text))
      .filter((text) => text.length > 0);
    if (words.length > 0 || window.length > 0) return words.join(" ");
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const turn = transcript[i];
      if (turn?.role === "user" && heardRequest(turn.text))
        return spokenWords(turn.text);
    }
    return "";
  };

  /**
   * The exchange since the previous delegation, both sides, oldest first
   * (a clarifying question and its answer, the voice saying back what it
   * understood): Q Brain already holds everything before it, and its
   * reader binds a fragment to what it answers.
   */
  const contextBefore = () =>
    transcript
      .slice(askedUpTo)
      .slice(-CONTEXT_MAX)
      .map((turn) => ({ role: turn.role, text: spokenWords(turn.text) }))
      .filter((turn) => turn.text.length > 0);

  /** Exact words handed to the voice, logged for RC5. */
  const handWords = (
    record: DelegationRecord | null,
    words: string,
    kind: HandedLine["kind"],
    runId?: string,
  ) => {
    handedLog.push({
      words,
      kind,
      ...(runId === undefined ? {} : { runId }),
      delegationId: record?.id ?? null,
      at: deps.now(),
    });
    while (handedLog.length > 24) handedLog.shift();
    if (record !== null) record.voiced = true;
    if (kind !== "HOLDING") check = { words, heard: "" };
  };

  /** Q's last answer, exactly as the voice was handed it, or null. */
  const lastAnswer = (): string | null => {
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const record = delegations.get(order[i] ?? "");
      if (
        record !== undefined &&
        (record.status === "SPOKEN" || record.status === "RUNNING") &&
        record.said !== undefined &&
        record.said.length > 0
      )
        return record.said;
    }
    return null;
  };

  /**
   * The run this utterance's earlier part started, when these words are
   * its rest (RC1): still running, nothing of it said, started within
   * `mergeWithinMs`, and its words were not a whole request by themselves.
   */
  const mergeTarget = (record: DelegationRecord, rest: string) => {
    const index = order.indexOf(record.id);
    const earlier =
      index > 0 ? delegations.get(order[index - 1] ?? "") : undefined;
    if (
      earlier === undefined ||
      earlier.status !== "RUNNING" ||
      earlier.voiced === true ||
      earlier.id === OPENING_ID ||
      earlier.id.startsWith("typed_") ||
      deps.now() - earlier.createdAt > mergeWithinMs ||
      completeRequest(earlier.request) ||
      !(endsUnfinished(earlier.request) || continuesSentence(rest))
    )
      return undefined;
    return earlier;
  };

  const run = (record: DelegationRecord, fixed?: string) => {
    let replaces: DelegationRecord | undefined;
    if (fixed === undefined) {
      const request = readRequest();
      if (!heardRequest(request)) {
        // No Q run on nothing: the voice heard the audio itself, so it
        // checks with the person. Their next words join this window.
        record.request = request;
        record.status = "UNHEARD";
        send(
          "session.commentary.append",
          record.providerId,
          UNHEARD_COMMENTARY,
        );
        changed();
        return;
      }
      // "Say that again": Q's last words, verbatim, by code (RC1; founder
      // F7-15/F7-16). No run, and never the voice's own paraphrase.
      const again = asksToRepeat(request) ? lastAnswer() : null;
      if (again !== null) {
        record.request = request;
        askedUpTo = transcript.length;
        boundary = true;
        record.status = "SPOKEN";
        record.said = again;
        send("session.commentary.append", record.providerId, sayExactly(again));
        handWords(record, again, "REPEAT");
        changed();
        return;
      }
      record.context = contextBefore();
      record.request = request;
      askedUpTo = transcript.length;
      boundary = true;
      // The rest of a sentence a pause split: one request, one run.
      replaces = mergeTarget(record, request);
      if (replaces !== undefined) {
        replaces.status = "CANCELLED";
        record.request = `${replaces.request} ${request}`;
        record.context = replaces.context ?? record.context;
        record.providerId ??= replaces.providerId;
      }
    } else {
      record.request = fixed;
    }
    record.status = "RUNNING";
    changed();
    let progressed = false;
    const progress = timers.setTimeout(() => {
      if (record.status !== "RUNNING" || progressed) return;
      progressed = true;
      // D6 (audit 14 Nov): "keep the conversation going" made the voice
      // ad-lib questions on nearly every turn. RC1 (15 Nov): one
      // code-chosen line per utterance of theirs, only while a run is
      // still going after the threshold and nothing of it was said yet;
      // never the result or a question, never on top of another.
      if (record.voiced === true || heldSinceTheySpoke) return;
      const words =
        lastHoldWords === HOLDING_LINE ? HOLDING_LINE_ALTERNATE : HOLDING_LINE;
      heldSinceTheySpoke = true;
      lastHoldWords = words;
      send(
        "session.commentary.append",
        record.providerId,
        holdingContentFor(words),
      );
      handWords(null, words, "HOLDING");
    }, progressAfterMs);
    const finish = async (outcome: DelegationOutcome) => {
      timers.clearTimeout(progress);
      const said = outcome.said;
      if (typeof said === "string" && deps.followMove !== undefined) {
        const receipt =
          outcome.move === undefined
            ? null
            : await deps.followMove(outcome).catch(() => null);
        settle(record, afterMove(outcome, said, receipt));
        return;
      }
      const note =
        deps.beforeSpeak === undefined
          ? null
          : await deps.beforeSpeak(outcome).catch(() => null);
      settle(
        record,
        note === null || outcome.commentary === null
          ? outcome
          : { ...outcome, commentary: `${note} ${outcome.commentary}` },
      );
    };
    const failed = () => {
      timers.clearTimeout(progress);
      settle(record, {
        commentary: sayExactly(NOT_FINISHED_LINE),
        failed: true,
      });
    };
    const cut = lastLineCut;
    lastLineCut = false;
    const base = {
      delegationId: record.id,
      request: record.request,
      context: record.context ?? contextBefore(),
      ...(cut ? { lastLineCut: true } : {}),
      ...(replaces === undefined ? {} : { replaces: replaces.id }),
    };
    const askEarly = (): Promise<void> =>
      deps.delegate({ ...base, early: true }).then(async (outcome) => {
        if (outcome.partial !== true) {
          await finish(outcome);
          return;
        }
        timers.clearTimeout(progress);
        progressed = true;
        if (outcome.holding === true) {
          // The Q API judged the wait real: its one holding line now,
          // then the first words, still early, under the same id.
          sayHolding(record, outcome);
          await askEarly();
          return;
        }
        // Q has verified the start of its answer: the voice says it now,
        // and the rest is asked for under the same id.
        speakStart(record, outcome);
        await deps.delegate(base).then(finish, failed);
      });
    void askEarly().catch(failed);
  };

  /**
   * The Q API's holding line for this request: said once per utterance of
   * theirs, never over Q's words or a newer request, never twice the same.
   */
  const sayHolding = (record: DelegationRecord, outcome: DelegationOutcome) => {
    const words = typeof outcome.said === "string" ? outcome.said : null;
    if (
      words === null ||
      outcome.commentary === null ||
      record.status !== "RUNNING" ||
      record.voiced === true ||
      heldSinceTheySpoke ||
      words === lastHoldWords ||
      newerRequests(record).length > 0
    )
      return;
    heldSinceTheySpoke = true;
    lastHoldWords = words;
    send("session.commentary.append", record.providerId, outcome.commentary);
    handWords(null, words, "HOLDING");
  };

  /**
   * Their words are still arriving and none of them has been asked yet
   * ("Um", a breath before the rest): an answer handed now is spoken over
   * them and the voice yields it (audit 15 Nov RC9, investor bdd2ef8f).
   */
  const theySpeak = () =>
    deps.now() - lastInputAt < QUIET_BEFORE_SPEAK_MS &&
    unaskedWords().length > 0;

  /** Newer requests of their own, nudges ("still waiting") aside. */
  const newerRequests = (record: DelegationRecord) =>
    order.slice(order.indexOf(record.id) + 1).flatMap((id) => {
      const newer = delegations.get(id);
      return newer === undefined ||
        newer.status === "UNHEARD" ||
        newer.status === "CANCELLED" ||
        isNudge(newer.request)
        ? []
        : [newer];
    });
  const working = (record: DelegationRecord) =>
    record.status === "RUNNING" || record.status === "WAITING_FOR_WORDS";

  /** Answers held while a newer request of theirs still works (by id). */
  const held = new Map<string, DelegationOutcome>();

  /** Q's words to the voice now, logged for RC5. */
  const voice = (record: DelegationRecord, outcome: DelegationOutcome) => {
    send(
      "session.commentary.append",
      record.providerId,
      outcome.commentary ?? "",
    );
    if (typeof outcome.said === "string" && outcome.said.length > 0) {
      record.said =
        record.said === undefined || record.status !== "RUNNING"
          ? outcome.said
          : `${record.said} ${outcome.said}`;
      handWords(record, outcome.said, "ANSWER", outcome.runId);
    } else record.voiced = true;
  };

  /**
   * Once a request's answer is spoken, every older request of theirs is
   * past (audit 15 Nov RC9): a run still going is stopped, and an answer
   * held for it is dropped -- never left as "thinking" for the voice to
   * bring up later. A nudge ("still waiting") supersedes nothing.
   */
  const supersedeOlder = (record: DelegationRecord) => {
    if (isNudge(record.request)) return;
    for (const id of order.slice(0, order.indexOf(record.id))) {
      const older = delegations.get(id);
      if (older === undefined) continue;
      if (held.delete(id)) older.status = "SUPERSEDED";
      if (!working(older)) continue;
      older.status = "CANCELLED";
      if (deps.cancel !== undefined) void deps.cancel(id).catch(() => false);
    }
  };

  /**
   * The start of an answer while the run goes on: spoken unless a newer
   * request of theirs exists (then the whole answer waits, see settle);
   * the status stays RUNNING until the rest arrives.
   */
  const speakStart = (record: DelegationRecord, outcome: DelegationOutcome) => {
    if (record.status === "CANCELLED") return;
    if (outcome.commentary === null || outcome.commentary.length === 0) return;
    if (newerRequests(record).length > 0) return;
    if (theySpeak()) {
      timers.setTimeout(() => {
        speakStart(record, outcome);
      }, QUIET_BEFORE_SPEAK_MS);
      return;
    }
    voice(record, outcome);
  };

  const settle = (record: DelegationRecord, outcome: DelegationOutcome) => {
    if (record.status === "CANCELLED" || record.status === "SUPERSEDED") return;
    const index = order.indexOf(record.id);
    // Recorded live (2026-10-09): a nudge ("still waiting, can you do it or
    // not") was delegated too; its empty answer came back first and was
    // spoken ("I can't confirm…") while the real answer was still working.
    // A failed answer is never spoken while an earlier request works on.
    const earlierWorking = order.slice(0, index).some((id) => {
      const earlier = delegations.get(id);
      return earlier !== undefined && working(earlier);
    });
    if (outcome.failed === true && earlierWorking) {
      record.answeredAt = deps.now();
      record.status = "FAILED";
      send(
        "session.thinking.append",
        record.providerId,
        `Nothing came back for "${record.request}". Their earlier request is still being worked on: say nothing about this one.`,
      );
      changed();
      return;
    }
    // Their words are still coming: the answer waits for the pause.
    if (theySpeak()) {
      timers.setTimeout(() => {
        settle(record, outcome);
      }, QUIET_BEFORE_SPEAK_MS);
      return;
    }
    record.answeredAt = deps.now();
    record.commentary = outcome.commentary;
    record.approvalPending = outcome.approvalPending;
    const newer = newerRequests(record);
    const empty =
      outcome.commentary === null || outcome.commentary.length === 0;
    // Audit 15 Nov RC9: one spoken answer per request of theirs, the
    // latest valid one. A newer request already answered: this one is
    // past and is dropped (no "thinking" for the voice to bring up).
    if (newer.some((one) => one.status === "SPOKEN")) {
      record.status = "SUPERSEDED";
      changed();
      return;
    }
    // A newer request still works: this answer waits for it, and is
    // spoken only if that one comes back with nothing (the founder's
    // nudges never cost them the answer they waited for: a nudge is not
    // a newer request).
    if (!empty && outcome.failed !== true && newer.some(working)) {
      record.status = "SUPERSEDED";
      held.set(record.id, outcome);
      changed();
      return;
    }
    if (empty || outcome.failed === true) {
      // Nothing (or nothing verified) for this one: the newest answer
      // held for an earlier request of theirs is said instead.
      const fallback = order
        .slice(0, index)
        .reverse()
        .find((id) => held.has(id));
      if (fallback !== undefined) {
        const earlier = delegations.get(fallback);
        const kept = held.get(fallback);
        held.delete(fallback);
        record.status = outcome.failed === true ? "FAILED" : "SPOKEN";
        if (earlier !== undefined && kept !== undefined) {
          earlier.status = "SPOKEN";
          voice(earlier, kept);
          supersedeOlder(earlier);
        }
        changed();
        return;
      }
    }
    if (empty) {
      record.status = "SPOKEN";
      supersedeOlder(record);
      changed();
      return;
    }
    // Q's words as Q gave them: a wrapper of the voice's own would be
    // words Q never said.
    voice(record, outcome);
    record.status = outcome.failed === true ? "FAILED" : "SPOKEN";
    if (outcome.failed !== true) supersedeOlder(record);
    changed();
  };

  /** Provider ids answered by a code-routed run (see joinRouted). */
  const joined = new Set<string>();
  const unaskedWords = () =>
    transcript
      .slice(askedUpTo)
      .filter((turn) => turn.role === "user")
      .map((turn) => spokenWords(turn.text))
      .join(" ")
      .trim();

  const joinRouted = (providerId: string): boolean => {
    if (heardRequest(unaskedWords())) return false;
    const last = order[order.length - 1];
    const record = last === undefined ? undefined : delegations.get(last);
    if (
      record === undefined ||
      !record.id.startsWith(ROUTED_PREFIX) ||
      record.providerId !== null ||
      deps.now() - record.createdAt > JOIN_WITHIN_MS
    )
      return false;
    joined.add(providerId);
    if (record.status === "RUNNING" || record.status === "WAITING_FOR_WORDS") {
      record.providerId = providerId;
    } else {
      // Already said: the provider's delegation is closed quietly.
      send(
        "session.thinking.append",
        providerId,
        "Q's backend already answered this and you have said its answer. Say nothing more about it.",
      );
    }
    changed();
    return true;
  };

  /**
   * Owner 14 Nov 2026: who answers a finished utterance is code's choice
   * (duplex/routing.ts), not the voice's. Small talk stays with the voice;
   * every other utterance ("go ahead", "I'm waiting", "still there?"
   * included) becomes a Q run, whether or not the voice delegates it.
   */
  const routeHeard = () => {
    routeTimer = null;
    const routing = deps.routing?.() ?? null;
    if (routing === null) return;
    // The voice delegated and its words are being read: that run has them.
    for (const record of delegations.values()) {
      if (record.status === "WAITING_FOR_WORDS") return;
    }
    const words = unaskedWords();
    if (!heardRequest(words)) return;
    // Their words stop mid-sentence ("Thank you. Um. So"): a pause, not
    // the end. Waited for once more before they are routed (RC1).
    if (!routeExtended && endsUnfinished(words)) {
      routeExtended = true;
      routeTimer = timers.setTimeout(routeHeard, continueAfterMs);
      return;
    }
    const firstUser = transcript.findIndex(
      (turn, index) => index >= askedUpTo && turn.role === "user",
    );
    const qBefore = transcript
      .slice(0, firstUser < 0 ? transcript.length : firstUser)
      .findLast((turn) => turn.role === "q");
    // Q's last words asked them something ("want me to re-run it?"): a
    // bare "yes" answers Q, never the voice alone (duplex: answeringQ).
    const answeringQ =
      qBefore !== undefined && /\?["'”’)]*$/u.test(qBefore.text.trim());
    const newestSpoken = order
      .map((id) => delegations.get(id))
      .findLast((record) => record?.status === "SPOKEN");
    const awaitingApproval = newestSpoken?.approvalPending === true;
    if (
      routing.guided !== true &&
      !answeringQ &&
      !awaitingApproval &&
      !asksToRepeat(words) &&
      routing.isSmallTalk(words)
    )
      return;
    routedCount += 1;
    const id = `${ROUTED_PREFIX}${String(routedCount)}`;
    const record: DelegationRecord = {
      id,
      providerId: null,
      request: "",
      status: "WAITING_FOR_WORDS",
      createdAt: deps.now(),
    };
    delegations.set(id, record);
    order.push(id);
    send("session.thinking.append", null, ROUTED_NOTE);
    run(record);
  };

  const onDelegation = (event: LiveServerEvent) => {
    const delegation = event["delegation"] as
      { id?: unknown; target?: unknown } | undefined;
    const id = typeof delegation?.id === "string" ? delegation.id : null;
    if (id === null) return;
    if (delegation?.target !== undefined && delegation.target !== "client")
      return;
    // One id, one run: a repeat of a known id is ignored.
    if (delegations.has(id) || joined.has(id)) return;
    // Code already handed these words to Q: the voice's delegation joins
    // that run (its answer goes back under this id), never a second run.
    if (joinRouted(id)) return;
    const record: DelegationRecord = {
      id,
      providerId: id,
      request: "",
      status: "WAITING_FOR_WORDS",
      createdAt: deps.now(),
    };
    delegations.set(id, record);
    order.push(id);
    changed();
    // The delegation can arrive before the last words are transcribed:
    // wait until the input transcript has been quiet for `settleMs`.
    // Bounded: someone who keeps talking does not hold the run back.
    let settledAt: number | null = null;
    const waitForWords = () => {
      const at = deps.now();
      const quietFor = at - lastInputAt;
      if (quietFor >= settleMs || at - record.createdAt >= SETTLE_MAX_MS) {
        // Only a marker or filler so far: the transcript may still be
        // completing. Waited for briefly, never longer than UNHEARD_WAIT_MS.
        settledAt ??= at;
        if (!heardRequest(readRequest()) && at - settledAt < UNHEARD_WAIT_MS) {
          timers.setTimeout(waitForWords, 100);
          return;
        }
        run(record);
        return;
      }
      timers.setTimeout(waitForWords, Math.max(50, settleMs - quietFor));
    };
    waitForWords();
  };

  return {
    handle: (event) => {
      switch (event.type) {
        case "session.input_transcript.delta": {
          const delta =
            typeof event["delta"] === "string" ? event["delta"] : "";
          lastInputAt = deps.now();
          append("user", delta);
          if (delta.length > 0 && heardRequest(delta)) {
            heldSinceTheySpoke = false;
            // They spoke over Q's last line: was all of it said? (RC1/P1)
            if (check !== null) {
              if (compareSpoken(check.words, check.heard).cut)
                lastLineCut = true;
              check = null;
            }
          }
          if (deps.routing !== undefined && delta.length > 0) {
            if (routeTimer !== null) timers.clearTimeout(routeTimer);
            routeExtended = false;
            routeTimer = timers.setTimeout(routeHeard, routeAfterMs);
          }
          return;
        }
        case "session.output_transcript.delta": {
          const delta =
            typeof event["delta"] === "string" ? event["delta"] : "";
          append("q", delta);
          if (check !== null) check.heard += delta;
          return;
        }
        case "session.delegation.created":
          onDelegation(event);
          return;
        case "session.started": {
          const opening = deps.opening;
          if (opening === undefined || openingStarted) return;
          openingStarted = true;
          if (opening.content !== undefined && opening.content.length > 0) {
            // Q's own opening, in hand: greeting and lowdown in one go, as
            // commentary (spoken). Recorded live (2026-10-09), an
            // instructions append alone did not reliably make the voice
            // speak first: one take waited 25 s for the person.
            send(
              "session.commentary.append",
              null,
              // Owner 2026-10-16: the opening greets, says how many things
              // wait and asks whether to look at them now; the voice says
              // that much and no more (never the list), then waits.
              `${opening.greeting} Then give them this opening in your own words, naturally and briefly. Say only what it says: if it counts what is waiting, give the count and never the items, names or details; if it asks them something, ask it and stop to hear their answer; never repeat card or screen text. Opening: ${opening.content}`,
            );
            return;
          }
          // Spoken now (commentary), not only instructions: see above.
          send(
            "session.commentary.append",
            null,
            `${opening.greeting} Their briefing is on its way from the backend; do not guess it.`,
          );
          if (opening.request === undefined) return;
          const record: DelegationRecord = {
            id: OPENING_ID,
            providerId: null,
            request: opening.request,
            status: "RUNNING",
            createdAt: deps.now(),
          };
          delegations.set(OPENING_ID, record);
          order.push(OPENING_ID);
          run(record, opening.request);
          return;
        }
        case "session.commentary.appended":
        case "session.thinking.appended":
        case "session.instructions.appended": {
          const id = event["client_event_id"];
          if (typeof id === "string" && pendingEvents.delete(id)) acked += 1;
          return;
        }
        case "error": {
          const error = event["error"] as
            { client_event_id?: unknown; message?: unknown } | undefined;
          const id = error?.client_event_id;
          if (typeof id === "string" && pendingEvents.delete(id)) {
            refused.push({
              eventId: id,
              message:
                typeof error?.message === "string"
                  ? error.message.slice(0, 200)
                  : "refused",
            });
            changed();
          }
          return;
        }
        default:
          return;
      }
    },
    cancel: async (delegationId) => {
      const record = delegations.get(delegationId);
      if (record === undefined || record.status !== "RUNNING") return false;
      const confirmed = (await deps.cancel?.(delegationId)) === true;
      // Never tell the person it stopped before the server confirmed it.
      if (!confirmed) return false;
      record.status = "CANCELLED";
      send(
        "session.thinking.append",
        record.providerId,
        `The backend confirmed it stopped: "${record.request}".`,
      );
      changed();
      return true;
    },
    typed: (text) => {
      const words = text.trim().slice(0, 2_000);
      if (words.length === 0) return;
      typedCount += 1;
      const id = `typed_${String(typedCount)}`;
      transcript.push({ role: "user", text: words });
      askedUpTo = transcript.length;
      boundary = true;
      const record: DelegationRecord = {
        id,
        providerId: null,
        request: words,
        status: "RUNNING",
        createdAt: deps.now(),
      };
      delegations.set(id, record);
      order.push(id);
      run(record, words);
    },
    narrate: (text) => {
      const words = text.trim();
      if (words.length === 0) return;
      send("session.commentary.append", null, narrationContent(words));
    },
    brief: (text) => {
      const words = text.trim();
      if (words.length === 0) return;
      send("session.instructions.append", null, words);
    },
    state: snapshot,
    takeHanded: () => handedLog.splice(0, handedLog.length),
  };
}

/**
 * Q's words after its screen move (RC1, R3): a claim that the page is
 * open, up or coming up is dropped unless the receipt was DONE; a move
 * that FAILED says so in code's words first. Nothing is added otherwise.
 */
export function afterMove(
  outcome: DelegationOutcome,
  said: string,
  receipt: MoveReceipt | null,
): DelegationOutcome {
  if (receipt === null || receipt === "DONE") return outcome;
  const kept = withoutArrival(said);
  const words =
    receipt === "FAILED"
      ? `${MOVE_FAILED_LINE}${kept.length > 0 ? ` ${kept}` : ""}`
      : kept;
  if (words === said) return outcome;
  return {
    ...outcome,
    said: words.length === 0 ? null : words,
    commentary: words.length === 0 ? null : sayExactly(words),
  };
}

/**
 * The commentary for one narrated line. Verbatim and nothing else: the line
 * is pre-approved (its claims are certified), so a paraphrase or an added
 * question would be an uncertified claim spoken in Q's voice.
 */
export function narrationContent(line: string): string {
  return `Say exactly the following words aloud, as yourself, and nothing else: no greeting, no question, no comment before or after it. Words: ${line}`;
}
