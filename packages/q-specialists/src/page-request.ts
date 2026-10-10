import type {
  QAnswerCardsBlock,
  QNavigateDestination,
  QSettingsSection,
} from "@capital-q/contracts";
import type { QConversationMessage } from "@capital-q/q-runtime";

/**
 * "Take me to the explore page", read by code (voice-cards, Zino live
 * 2026-10-08: the turn reader filed it under Discover, twice).
 *
 * A request to open a page is answered here, before any model, when the
 * page it names is one Capital Q has: the words after the verb are looked
 * up in one table of every page and tab, with the names people use for
 * them. A named page Capital Q does not have is said plainly ("I can't
 * open that yet"), never approximated by a neighbour. Anything else (a
 * record by its name, a question) is not a page request and goes to the
 * normal path, where Q's tools find the record.
 *
 * "The third company on the list" is resolved here too, against the cards
 * Q put on screen last, never against what a model remembers.
 */

export type PageTarget =
  | { readonly kind: "DESTINATION"; readonly destination: QNavigateDestination }
  | { readonly kind: "SETTINGS"; readonly section: QSettingsSection };

export type PageRequest =
  | { readonly kind: "PAGE"; readonly target: PageTarget }
  | { readonly kind: "UNKNOWN"; readonly named: string };

const d = (destination: QNavigateDestination): PageTarget => ({
  kind: "DESTINATION",
  destination,
});
const s = (section: QSettingsSection): PageTarget => ({
  kind: "SETTINGS",
  section,
});

/**
 * Every page and tab, by the names people use (normalised: lower case, no
 * article, no "page"/"tab"/"screen"). One table: tests assert that every
 * navigable destination has at least one name here.
 */
export const PAGE_NAMES: Readonly<Record<string, PageTarget>> = {
  // Home / Q
  home: d("HOME"),
  homepage: d("HOME"),
  "home page": d("HOME"),
  q: d("HOME"),
  "q room": d("HOME"),
  "ask q": d("HOME"),
  // Profile
  profile: d("PROFILE"),
  "q card": d("PROFILE"),
  // Capital
  capital: d("CAPITAL"),
  raise: d("CAPITAL"),
  fundraise: d("CAPITAL"),
  fundraising: d("CAPITAL"),
  // Capital's tabs (capital-tabs 2026-10-08). "Plan" alone stays the
  // subscription (Settings); a dated plan is the Blueprint.
  "capital overview": d("CAPITAL"),
  "raise overview": d("CAPITAL"),
  "raise and rounds": d("CAPITAL_RAISE"),
  "raise & rounds": d("CAPITAL_RAISE"),
  rounds: d("CAPITAL_RAISE"),
  "capital rounds": d("CAPITAL_RAISE"),
  "funding rounds": d("CAPITAL_RAISE"),
  "current round": d("CAPITAL_RAISE"),
  commitments: d("CAPITAL_RAISE"),
  "capital commitments": d("CAPITAL_RAISE"),
  "round terms": d("CAPITAL_RAISE"),
  readiness: d("CAPITAL_READINESS"),
  "capital readiness": d("CAPITAL_READINESS"),
  "investor readiness": d("CAPITAL_READINESS"),
  "raise readiness": d("CAPITAL_READINESS"),
  "readiness pillars": d("CAPITAL_READINESS"),
  "what could stop my raise": d("CAPITAL_READINESS"),
  "action plan": d("CAPITAL_ACTION_PLAN"),
  "capital action plan": d("CAPITAL_ACTION_PLAN"),
  "action board": d("CAPITAL_ACTION_PLAN"),
  "plan board": d("CAPITAL_ACTION_PLAN"),
  "action plan board": d("CAPITAL_ACTION_PLAN"),
  "12 month plan": d("CAPITAL_PLAN"),
  "twelve month plan": d("CAPITAL_PLAN"),
  "6 month plan": d("CAPITAL_PLAN"),
  "3 month plan": d("CAPITAL_PLAN"),
  "3 6 12 month plan": d("CAPITAL_PLAN"),
  "capital 12 month plan": d("CAPITAL_PLAN"),
  blueprint: d("CAPITAL_PLAN"),
  "readiness blueprint": d("CAPITAL_PLAN"),
  "fundraising plan": d("CAPITAL_PLAN"),
  "capital investors": d("CAPITAL_INVESTORS"),
  "capital relationships": d("CAPITAL_INVESTORS"),
  // Discover
  discover: d("DISCOVER"),
  discovery: d("DISCOVER"),
  feed: d("DISCOVER"),
  "for you": d("DISCOVER"),
  "deal feed": d("DISCOVER"),
  recommendations: d("DISCOVER"),
  // Explore (never Discover)
  explore: d("EXPLORE"),
  explorer: d("EXPLORE"),
  browse: d("EXPLORE"),
  "pitch grid": d("EXPLORE"),
  "all pitches": d("EXPLORE"),
  pitches: d("EXPLORE"),
  "browse pitches": d("EXPLORE"),
  // Search
  search: d("SEARCH"),
  "people search": d("PEOPLE_SEARCH"),
  "search people": d("PEOPLE_SEARCH"),
  "find people": d("PEOPLE_SEARCH"),
  "find a person": d("PEOPLE_SEARCH"),
  "handle search": d("PEOPLE_SEARCH"),
  // Relationships
  relationships: d("RELATIONSHIPS"),
  relationship: d("RELATIONSHIPS"),
  pipeline: d("RELATIONSHIPS"),
  deals: d("RELATIONSHIPS"),
  // Settings and its sections
  settings: d("SETTINGS"),
  setting: d("SETTINGS"),
  preferences: d("SETTINGS"),
  account: s("account"),
  "account settings": s("account"),
  appearance: s("appearance"),
  theme: s("appearance"),
  "theme settings": s("appearance"),
  notifications: s("notifications"),
  "notification settings": s("notifications"),
  connections: s("connections"),
  "connected accounts": s("connections"),
  integrations: s("connections"),
  billing: s("billing"),
  plan: s("plan"),
  "my plan": s("plan"),
  subscription: s("plan"),
  pricing: s("plan"),
  privacy: s("privacy"),
  "privacy settings": s("privacy"),
  "voice settings": s("speaking"),
  speaking: s("speaking"),
  "q settings": s("q"),
  "team settings": s("team"),
  "settings team": s("team"),
  "my team": s("team"),
  memory: d("MEMORY"),
  memories: d("MEMORY"),
  "q memory": d("MEMORY"),
  "what you remember": d("MEMORY"),
  usage: d("USAGE"),
  "q usage": d("USAGE"),
  // A company's own screens
  verification: d("VERIFICATION"),
  visibility: d("COMPANY_VISIBILITY"),
  "visibility settings": d("COMPANY_VISIBILITY"),
  "company visibility": d("COMPANY_VISIBILITY"),
  pitch: d("PITCH"),
  "pitch and media": d("PITCH"),
  "pitch & media": d("PITCH"),
  media: d("PITCH"),
  "pitch video": d("PITCH"),
  "new pitch": d("NEW_PITCH"),
  "new pitch video": d("NEW_PITCH"),
  "add a pitch": d("NEW_PITCH"),
  "upload a pitch": d("NEW_PITCH"),
  "investor interest": d("COMPANY_INTEREST"),
  "incoming interest": d("COMPANY_INTEREST"),
  "company interest": d("COMPANY_INTEREST"),
  // Discover's lists
  saved: d("SAVED"),
  "saved companies": d("SAVED"),
  saves: d("SAVED"),
  shortlist: d("SAVED"),
  passed: d("PASSED"),
  "passed companies": d("PASSED"),
  passes: d("PASSED"),
  "your companies": d("YOUR_COMPANIES"),
  "my companies": d("YOUR_COMPANIES"),
  portfolio: d("YOUR_COMPANIES"),
  compare: d("SAVED_COMPARE"),
  comparison: d("SAVED_COMPARE"),
  "compare saved": d("SAVED_COMPARE"),
  // Investors
  investors: d("INVESTORS"),
  "company requests": d("INVESTORS"),
  "top investors": d("TOP_INVESTORS"),
  "top three investors": d("TOP_INVESTORS"),
  "top 3 investors": d("TOP_INVESTORS"),
  "best investors": d("TOP_INVESTORS"),
  // GateQ and its tabs
  gateq: d("GATEWAY"),
  "gate q": d("GATEWAY"),
  "gate queue": d("GATEWAY"),
  gate: d("GATEWAY"),
  gateway: d("GATEWAY"),
  "gateq inbox": d("GATEQ_INBOX"),
  "gate inbox": d("GATEQ_INBOX"),
  "gateq find": d("GATEQ_FIND"),
  "gateq claim": d("GATEQ_CLAIM"),
  applications: d("GATEQ_APPLICATIONS"),
  "gateq applications": d("GATEQ_APPLICATIONS"),
  // Documents, rehearsals, the Daily, results, reviews
  documents: d("DOCUMENTS"),
  docs: d("DOCUMENTS"),
  files: d("DOCUMENTS"),
  "brand kit": d("DOCUMENTS"),
  rehearsals: d("REHEARSALS"),
  rehearsal: d("REHEARSALS"),
  rehearse: d("REHEARSALS"),
  daily: d("DAILY"),
  "q daily": d("DAILY"),
  newspaper: d("DAILY"),
  news: d("DAILY"),
  results: d("RESULTS"),
  reports: d("RESULTS"),
  reviews: d("REVIEWS"),
  "human review": d("REVIEWS"),
  "human reviews": d("REVIEWS"),
  // Work and its tabs
  work: d("WORK"),
  "q work": d("WORK"),
  "q's work": d("WORK"),
  tasks: d("WORK"),
  "needs you": d("WORK_NEEDS"),
  "work needs you": d("WORK_NEEDS"),
  approvals: d("WORK_NEEDS"),
  "in progress": d("WORK_PROGRESS"),
  "work in progress": d("WORK_PROGRESS"),
  "work progress": d("WORK_PROGRESS"),
  "work done": d("WORK_DONE"),
  "done work": d("WORK_DONE"),
  "work team": d("WORK_TEAM"),
  "q team": d("WORK_TEAM"),
  "q's team": d("WORK_TEAM"),
  "work cost": d("WORK_COST"),
  "work costs": d("WORK_COST"),
};

export const PAGE_VERB =
  /^(?:(?:hey|ok|okay)\s+q[,\s]+)?(?:(?:can|could|would|will)\s+you\s+|please\s+|q[,\s]+)*(?:take\s+me\s+(?:back\s+)?(?:to|into)|bring\s+me\s+to|go\s+(?:back\s+)?to|navigate\s+to|switch\s+to|jump\s+to|head\s+to|open(?:\s+up)?|pull\s+up|bring\s+up|show\s+me|let'?s\s+go\s+to|i\s+(?:want|need|would\s+like|'d\s+like)\s+to\s+(?:go\s+to|see|open))\s+(.+)$/iu;

/** Words that only frame a page's name. */
const FRAME = /\b(?:page|screen|tab|section|view|area)\b/giu;
const PAGE_WORD = /\b(?:page|screen|tab|section)\s*$/iu;

function normalise(object: string, keepOwner = false): string {
  const framed = object
    .toLowerCase()
    .replace(/[’]/gu, "'")
    .replace(/[^\p{L}\p{N}&' ]+/gu, " ")
    .replace(/\b(?:please|for me|now|again|then|real quick|quickly)\b/gu, " ")
    .replace(FRAME, " ")
    .replace(/\s+/gu, " ")
    .trim();
  // "your companies" is a page's own name; "my settings" is Settings.
  const bare = keepOwner
    ? framed.replace(/^(?:the|a|an)\s+/u, "")
    : framed
        .replace(/^(?:the|my|our|your|a|an)\s+/u, "")
        .replace(/^(?:the|my|our|your)\s+/u, "");
  return bare.replace(/\s+(?:the|a)$/u, "").trim();
}

const HOME =
  /^(?:(?:can|could)\s+you\s+)?(?:take\s+me|go|bring\s+me)\s+(?:back\s+)?home(?:\s+please)?$/iu;

/** "team on work" / "work's team" -> also "work team". */
function candidates(key: string): readonly string[] {
  const out = [key];
  const on = /^(.+?)\s+(?:on|in|of|under|from)\s+(?:the\s+|my\s+)?(.+)$/u.exec(
    key,
  );
  if (on?.[1] !== undefined && on[2] !== undefined) {
    out.push(`${on[2]} ${on[1]}`, on[1]);
  }
  const owned = /^(.+?)'s\s+(.+)$/u.exec(key);
  if (owned?.[1] !== undefined && owned[2] !== undefined) {
    out.push(`${owned[1]} ${owned[2]}`);
  }
  return out;
}

/** Words that take a request back or put it off: never acted on early. */
const TAKEN_BACK =
  /\b(?:no\s+wait|wait|don'?t|do\s+not|not\s+(?:now|yet)|never\s*mind|cancel|stop|actually|hold\s+on|instead|rather)\b/iu;

/**
 * RECOVERY-2026-10 (C7): the sentence takes its own request back ("open
 * discover... no wait"). Here, beside the page reader, so the browser and
 * the Q API read it with the same code.
 */
export function takenBack(text: string): boolean {
  const corrected = selfCorrected(text);
  return corrected.length === 0 || TAKEN_BACK.test(corrected);
}

/**
 * Where a self-correction turns ("..., no, actually ...", "... sorry, ...",
 * "..., I mean ..."): what follows the last one is the request.
 */
const CORRECTION =
  /(?:[\s,.;:!?\u2014\u2026-]+|^)(?:(?:no+|nope)(?:\s*[,.;:!?\u2014\u2026-][\s,.;:!?\u2014\u2026-]*|\s+(?=actually|sorry|i\s+mean))(?:(?:actually|sorry|i\s+mean[t]?)\b)?|actually|sorry|i\s+mean[t]?)\b[\s,.;:!?\u2014\u2026-]*/giu;
/** "Not Discover, Rehearsals" / "open not discover but rehearsals". */
const NOT_THIS =
  /^(?<lead>.*?)\bnot\s+(?:to\s+)?[^,;]+?(?:[,;]\s*|\s+but\s+)(?:but\s+)?(?:to\s+)?(?<rest>\S.*)$/iu;

/**
 * Founder acceptance (2026-10-10): "Open Discover, no, actually
 * Rehearsals" moved nowhere. A sentence that corrects itself asks for the
 * LAST place it names, never the first: the words after the last turn,
 * carrying the request's verb when they have none of their own ("Open
 * Rehearsals"). An empty string when nothing follows the turn (taken
 * back). Unchanged when it does not correct itself.
 */
export function selfCorrected(text: string): string {
  const said = text.trim();
  let last: { end: number; start: number } | null = null;
  for (const match of said.matchAll(CORRECTION)) {
    // A bare "no" turns the sentence only with a pause after it ("No
    // Limits Capital" is a name), and only after something was asked.
    if (match.index === 0 && match[0].trim().length === said.length) continue;
    last = { start: match.index, end: match.index + match[0].length };
  }
  let tail: string;
  if (last !== null && last.start > 0) {
    tail = said.slice(last.end);
  } else {
    const not = NOT_THIS.exec(withoutLeadIn(said));
    const lead = not?.groups?.["lead"]?.trim() ?? "";
    if (not === null || (lead.length > 0 && !PAGE_VERB.test(`${lead} x`))) {
      return said;
    }
    tail = not.groups?.["rest"] ?? "";
  }
  const request = withoutLeadIn(tail.replace(/[.!?\u2026\s]+$/u, "")).trim();
  if (request.length === 0) return "";
  // A take-back after the turn ("no, actually never mind") stays one.
  if (TAKEN_BACK.test(request)) return request;
  return PAGE_VERB.test(request) ? request : `Open ${request}`;
}

/**
 * Spoken lead-ins before the request itself ("Okay, open discover.", "Um,
 * so take me to Halyard"). RECOVERY-2026-10 (C, GPT-Live 2026-10-09): voice
 * transcripts nearly always start with one, and the readers below read the
 * request from its first word, so every such sentence was left unread.
 * Only interjections: "can you" / "please" / "hey Q" are read by PAGE_VERB.
 */
const LEAD_IN =
  /^(?:(?:okay|ok|alright|all\s+right|right|so|um+|uh+|erm*|hmm+|yeah|yes|well|now|and|great|cool|perfect|thanks|thank\s+you)\b[\s,.!?;:\-\u2014\u2026]*)+/iu;

/** The words with spoken lead-ins removed. */
export function withoutLeadIn(text: string): string {
  return text.trim().replace(LEAD_IN, "").trim();
}

/**
 * A request to open a page, or null when the words are not one (a record
 * by name, a question, anything else). UNKNOWN only when they named a
 * page ("... page") in plain lower-case words Capital Q has no page for:
 * a proper name ("the Tensorgate page") is a record, for the tools.
 */
export function pageRequestOf(text: string): PageRequest | null {
  const said = withoutLeadIn(selfCorrected(text)).replace(/[.!?]+$/u, "");
  if (said.length === 0 || said.length > 160) return null;
  if (HOME.test(said)) return { kind: "PAGE", target: d("HOME") };
  const verb = PAGE_VERB.exec(said);
  const object = verb?.[1]?.trim();
  if (object === undefined || object.length === 0) return null;
  const key = normalise(object);
  if (key.length === 0) return null;
  for (const candidate of [
    ...candidates(normalise(object, true)),
    ...candidates(key),
  ]) {
    const target = PAGE_NAMES[candidate];
    if (target !== undefined) return { kind: "PAGE", target };
  }
  const bare = object.replace(PAGE_WORD, "").trim();
  if (
    PAGE_WORD.test(object) &&
    !/'s\b|\b(?:for|of|with|about|between)\b/iu.test(object) &&
    !/\p{Lu}/u.test(bare.replace(/^(?:The|My|Our|Your)\s+/u, "")) &&
    key.split(" ").length <= 3
  ) {
    return { kind: "UNKNOWN", named: key };
  }
  return null;
}

/**
 * Whether any sentence asks to go somewhere ("open ...", "take me to ...").
 * The browser asks the Q API about a record only then (live 2026-10-09:
 * 204 of 216 reads in twelve minutes were transcript pieces asking for
 * nothing).
 */
export function asksToGo(text: string): boolean {
  return text
    .split(/(?<=[.!?])\s+/u)
    .some((sentence) =>
      PAGE_VERB.test(withoutLeadIn(sentence).replace(/[.!?]+$/u, "")),
    );
}

/** A sentence that says no, or says what they already see. */
const NOT_A_MOVE =
  /\b(?:don'?t|do\s+not|not|never|no|can'?t|cannot|won'?t|i'?m\s+(?:on|in|at|looking\s+at)|i\s+am\s+(?:on|in|at|looking\s+at)|i\s+(?:can\s+)?see)\b/iu;

function escaped(words: string): string {
  return words.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * RECOVERY-2026-10 (C, live 2026-10-09 14:35-14:47): whether the person's
 * own words name this page in a sentence that asks for it. The turn
 * reader is a model: it moved "I can't really see anything, so..." and
 * "I'm on Tensorgate's page, but I..." to Discover, and "Is there a
 * Tensorgate rehearsal here I can open" to Relationships. A move it reads
 * is followed only when a sentence names that page (any name in
 * PAGE_NAMES, singular or plural) and neither says no nor says what they
 * already see.
 */
export function wordsNamePage(text: string, target: PageTarget): boolean {
  const names = Object.entries(PAGE_NAMES)
    .filter(([, named]) =>
      target.kind === "SETTINGS"
        ? named.kind === "SETTINGS" ||
          (named.kind === "DESTINATION" && named.destination === "SETTINGS")
        : named.kind === "DESTINATION" &&
          named.destination === target.destination,
    )
    .map(([name]) => name.replace(/s$/u, ""))
    .filter((name) => name.length > 1);
  if (names.length === 0) return false;
  const named = new RegExp(
    `\\b(?:${names.map(escaped).join("|")})(?:s|es|'s)?\\b`,
    "iu",
  );
  // A self-correction names only its last place: the model's move to the
  // one taken back ("Open Discover, no, actually Rehearsals") is not made.
  return selfCorrected(text)
    .split(/(?<=[.!?])\s+|\s*[,;]\s*(?:but|so|and)\s+/u)
    .some((sentence) => named.test(sentence) && !NOT_A_MOVE.test(sentence));
}

/** What Q says for a page Capital Q does not have. */
export function cannotOpenLine(named: string): string {
  const plain = named.replace(/[^\p{L}\p{N}\s'&-]/gu, "").slice(0, 60);
  return plain.length === 0
    ? "I can't open that yet."
    : `I can't open that yet: there's no "${plain}" page in Capital Q.`;
}

const ORDINALS: Readonly<Record<string, number>> = {
  first: 1,
  "1st": 1,
  one: 1,
  "1": 1,
  second: 2,
  "2nd": 2,
  two: 2,
  "2": 2,
  third: 3,
  "3rd": 3,
  three: 3,
  "3": 3,
  fourth: 4,
  "4th": 4,
  four: 4,
  "4": 4,
  fifth: 5,
  "5th": 5,
  five: 5,
  "5": 5,
  sixth: 6,
  "6th": 6,
  six: 6,
  "6": 6,
  seventh: 7,
  "7th": 7,
  seven: 7,
  "7": 7,
  eighth: 8,
  "8th": 8,
  eight: 8,
  "8": 8,
  ninth: 9,
  "9th": 9,
  nine: 9,
  "9": 9,
  tenth: 10,
  "10th": 10,
  ten: 10,
  "10": 10,
  last: -1,
};

const ORDINAL =
  /^(?:(?:can|could|would)\s+you\s+|please\s+)*(?:open(?:\s+up)?|show\s+me|take\s+me\s+to|go\s+to|pull\s+up|bring\s+up|tell\s+me\s+(?:more\s+)?about|what\s+about|more\s+(?:on|about))\s+(?:the\s+)?(?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|1st|2nd|3rd|[4-9]th|10th)\s+(?:one|company|startup|card|business|result|option)|(?:company|card|one)\s+number\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})|number\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2}))(?:\s+(?:on|in|from)\s+(?:the|this|that|your|my)\s+(?:list|screen|cards?|ranking|results))?(?:\s+(?:please|for me))?$/iu;

/** The position a turn points at ("the third company"), 1-based; -1 is last. */
export function ordinalOf(text: string): number | null {
  const said = text
    .trim()
    .replace(/[.!?]+$/u, "")
    .replace(/[’]/gu, "'");
  const match = ORDINAL.exec(said);
  if (match === null) return null;
  const word = (match[1] ?? match[2] ?? match[3] ?? "").toLowerCase();
  return ORDINALS[word] ?? null;
}

/** The answer cards on screen now: the newest answer that carried cards. */
export function cardsOnScreen(
  history: readonly QConversationMessage[],
): QAnswerCardsBlock | null {
  for (const message of [...history].reverse()) {
    if (message.role !== "Q") continue;
    const block = (message.blocks ?? []).find(
      (one): one is QAnswerCardsBlock => one.kind === "ANSWER_CARDS",
    );
    if (block !== undefined) return block;
  }
  return null;
}

/** The card "the third company on the list" means, from the cards on screen. */
export function cardAt(
  block: QAnswerCardsBlock,
  position: number,
): QAnswerCardsBlock["cards"][number] | null {
  const index = position === -1 ? block.cards.length - 1 : position - 1;
  return block.cards[index] ?? null;
}
