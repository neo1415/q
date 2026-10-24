import type { TurnSkimResult } from "@capital-q/q-core";
import type { QCardsIntent } from "@capital-q/contracts";
import type { QResultBlock } from "@capital-q/contracts/q";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import { cardsIntentOf, cardsLineOf, cardsRequestOf } from "./cards-request.js";

/**
 * The fast lane (founder brief K, 2026-10-09): a turn the short first read
 * (TURN_SKIM) names, with HIGH confidence, as companies of a kind or as
 * fit, is answered by the read-only app query at once instead of after the
 * full turn reading (p50 1.2 s hosted). Read-only by construction: the
 * worst a misread can do is show a list nobody asked for, never act. A
 * turn about companies already shown needs the reader's references and
 * waits for it; everything else is null and waits, as before.
 */
export type FastLane = Required<Pick<QAnswerRequest, "questionKind">> &
  Pick<
    QAnswerRequest,
    "discoverCompanies" | "fitQuestion" | "personSearch" | "discoverInvestors"
  >;

export function fastLaneOf(
  skim: TurnSkimResult | null,
  utterance: string,
): FastLane | null {
  if (skim === null || skim.confidence !== "HIGH") return null;
  const text = utterance.trim().slice(0, 1_000);
  if (text.length === 0) return null;
  if (skim.kind === "DISCOVER_COMPANIES") {
    const discover = skim.discover;
    if (discover === null || discover.previous) return null;
    // Companies "of a kind" names a kind; with none it is a fit question.
    if (
      discover.sectors.length === 0 &&
      discover.countries.length === 0 &&
      discover.stages.length === 0
    ) {
      return null;
    }
    return {
      questionKind: "DISCOVER_COMPANIES",
      discoverCompanies: {
        text,
        sectors: discover.sectors,
        countries: discover.countries.map((code) => code.toUpperCase()),
        stages: discover.stages,
        count: skim.count,
        ranking: discover.ranking,
        mandateRelevant: discover.mandateRelevant,
        previous: false,
      },
    };
  }
  if (skim.kind === "PERSON_SEARCH") {
    // Read-only and public-only: the worst a misread can do is show a
    // card for a name nobody asked about, never act.
    const person = skim.person;
    if (person === null) return null;
    return {
      questionKind: "PERSON_SEARCH",
      personSearch: {
        name: person.name,
        entityKind: person.kind,
        city: person.city,
        country: person.country,
        organization: person.organization,
        role: person.role,
        freshSearch: person.freshSearch,
      },
    };
  }
  if (skim.kind === "DISCOVER_INVESTORS") {
    // Read-only and public-only: the worst a misread is a list of public
    // investors nobody asked for. The region words stay as they were said.
    const investors = skim.investors;
    if (investors === null || investors === undefined) return null;
    // F-57 (live 2026-10-23, maji-loop in Nairobi): the skim reads the last
    // two turns, so a region from an earlier rehearsal ("Qatar") came back
    // as if said, and "which investors should I talk to first?" was
    // answered with Gulf funds "matched on place". A search of public
    // investors takes only region words said in this turn; and an ask
    // naming no region, sector or stage is not a search of a kind at all
    // -- it is which investors their own company should approach, which
    // the full reading answers from their own record (INVESTOR_PROSPECTS).
    const said = text.toLowerCase();
    if (
      investors.regions.some((region) => !said.includes(region.toLowerCase()))
    ) {
      return null;
    }
    if (
      investors.regions.length === 0 &&
      investors.sector === null &&
      investors.stage === null
    ) {
      return null;
    }
    // A question about something else, with the investors only in what
    // they told Q, is not a search (any language: the region words are
    // the first read's own, as said).
    if (
      investors.regions.length > 0 &&
      asksSomethingElse(text, (sentence) =>
        investors.regions.some((region) =>
          sentence.toLowerCase().includes(region.toLowerCase()),
        ),
      )
    ) {
      return null;
    }
    return {
      questionKind: "DISCOVER_INVESTORS",
      discoverInvestors: {
        regions: investors.regions,
        sector: investors.sector,
        stage: investors.stage,
        count: skim.count === null ? null : Math.min(skim.count, 5),
        aboutMyCompany: investors.aboutMyCompany,
      },
    };
  }
  if (skim.kind === "FIT") {
    return {
      questionKind: "FIT",
      fitQuestion: { text, count: skim.count, previous: false },
    };
  }
  return null;
}

/**
 * A prepared entity as the known-entity index sees it, reduced to what the
 * lane needs. The composition root builds it from the warm index (pure
 * memory, no database); the lane itself knows nothing of research.
 */
export type KnownEntityMatch = {
  readonly displayName: string;
  readonly entityKind: "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY";
  /** Every word of the entity's name and aliases, lower-cased. */
  readonly nameWords: readonly string[];
  /** Words of its place, organisation and role: valid context clues. */
  readonly contextWords: readonly string[];
};

export type KnownEntityMatcher = (candidate: string) => KnownEntityMatch | null;

/** Words that only frame a lookup ask; they carry no name and no intent. */
const LOOKUP_FRAME: ReadonlySet<string> = new Set([
  "who",
  "whos",
  "what",
  "whats",
  "is",
  "are",
  "was",
  "tell",
  "me",
  "us",
  "about",
  "find",
  "search",
  "for",
  "look",
  "up",
  "lookup",
  "show",
  "give",
  "info",
  "information",
  "on",
  "the",
  "a",
  "an",
  "please",
  "can",
  "could",
  "you",
  "do",
  "know",
  "in",
  "at",
  "from",
  "q",
  "hey",
  "i",
  "want",
  "to",
  "need",
  "like",
  "more",
  "details",
  "profile",
  "background",
  "bio",
  "s",
]);

/**
 * Words of action or analysis. Their presence means the turn wants more
 * than the card, so it takes the normal path (these exclude non-lookups;
 * they are not an intent list for lookups).
 */
const BEYOND_LOOKUP: ReadonlySet<string> = new Set([
  "compare",
  "versus",
  "vs",
  "and",
  "or",
  "rehearse",
  "rehearsal",
  "practise",
  "practice",
  "pitch",
  "research",
  "analyse",
  "analyze",
  "analysis",
  "email",
  "message",
  "write",
  "draft",
  "book",
  "schedule",
  "introduce",
  "intro",
  "summarise",
  "summarize",
  "why",
  "how",
  "should",
  "would",
  "fit",
  "match",
  "better",
  "best",
  "worse",
  "than",
  "news",
  "latest",
  "fresh",
  "connect",
  "deck",
  "report",
  "brief",
  "ceo",
  "ask",
  "interview",
  "mandate",
  "portfolio",
  "contact",
  "address",
  "phone",
  "salary",
  "net",
  "worth",
  "age",
  "married",
  "wife",
  "husband",
  "family",
  "not",
]);

const wordsOf = (text: string): string[] =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);

/** One-letter slack for a variant spelling ("Shady" for "Shadi"). */
function nearWord(word: string, name: string): boolean {
  if (word === name) return true;
  const slack = word.length >= 4 ? Math.max(1, Math.floor(word.length / 4)) : 0;
  if (slack === 0 || Math.abs(word.length - name.length) > slack) return false;
  let previous = Array.from({ length: name.length + 1 }, (_, i) => i);
  for (let i = 1; i <= word.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= name.length; j += 1) {
      row[j] = Math.min(
        (row[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (word[i - 1] === name[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return (previous[name.length] ?? slack + 1) <= slack;
}

/**
 * Instant lane for "who is / tell me about / find <a prepared entity>":
 * the utterance is a lookup frame plus a name (and at most place clues
 * that belong to that entity), nothing else. Anything with an action or
 * analysis word, a second subject, a word that is not part of the name,
 * or a name the warm index does not hold, is null and takes the normal
 * path. Pure: no model call, no I/O beyond the in-memory matcher.
 */
export function knownEntityLaneOf(
  utterance: string,
  match: KnownEntityMatcher,
): FastLane | null {
  const all = wordsOf(utterance.slice(0, 300));
  if (all.length === 0 || all.some((w) => BEYOND_LOOKUP.has(w))) return null;
  const rest = all.filter((w) => !LOOKUP_FRAME.has(w));
  if (rest.length === 0 || rest.length > 5) return null;
  for (let take = rest.length; take >= 1; take -= 1) {
    const given = rest.slice(0, take);
    const found = match(given.join(" "));
    if (found === null) continue;
    // Every word they said is part of the name (or a near spelling)...
    if (!given.every((w) => found.nameWords.some((n) => nearWord(w, n)))) {
      continue;
    }
    // ...and any word after it is a clue the entity itself bears out.
    if (!rest.slice(take).every((w) => found.contextWords.includes(w))) {
      return null;
    }
    return {
      questionKind: "PERSON_SEARCH",
      personSearch: {
        name: found.displayName,
        entityKind: found.entityKind,
        city: null,
        country: null,
        organization: null,
        role: null,
        freshSearch: false,
      },
    };
  }
  return null;
}

/**
 * Investors of a region, asked for without a name ("top three Arab
 * investors that may be interested in this", "who in the Middle East might
 * back us? give me 3", "any Gulf money for us?"), recognised by code so the
 * ask never waits on, or is lost to, a LOW-confidence first read (live
 * 2026-10-10: one paraphrase fell to the analyst and failed). Needs both an
 * investor word and a region word, and no action word: "draft an email to
 * Gulf investors" is a request to write, not to find. Read-only by
 * construction; the region words travel as said and code maps them.
 */
const INVESTOR_INTENT =
  /\b(?:investors?|vcs?|venture\s+capital(?:ists?)?|funds?|backers?|financiers?|family\s+offices?|angels?|sovereign\s+wealth|(?:gulf|arab|qatari|saudi|emirati)\s+money|money\s+from|capital\s+from|back(?:ing)?\s+(?:us|me|this|our)|fund(?:ing)?\s+(?:us|me|this|our)|invest\s+in\s+(?:us|me|this|our))\b/iu;

const REGION_TERMS: readonly string[] = [
  "arab world",
  "arab",
  "arabs",
  "arabian",
  "middle eastern",
  "middle east",
  "mideast",
  "mena",
  "gcc",
  "gulf",
  "khaleeji",
  "qatari",
  "qatar",
  "doha",
  "saudi",
  "riyadh",
  "uae",
  "emirati",
  "emirates",
  "dubai",
  "abu dhabi",
  "kuwaiti",
  "kuwait",
  "bahraini",
  "bahrain",
  "omani",
  "oman",
  "egyptian",
  "egypt",
  "cairo",
  "jordanian",
  "jordan",
  "lebanese",
  "lebanon",
  "moroccan",
  "morocco",
  "عربي",
  "عرب",
  "الخليج",
  "خليجي",
  "قطر",
];

const ACTION_WORDS =
  /\b(?:draft|write|email|e-mail|send|message|schedule|book|invite|introduce|intro|connect\s+me|compare|analy[sz]e|report|remind)\b/iu;

const COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  couple: 2,
  few: 3,
};

/**
 * The turn's questions: sentences ending in a question mark of any script
 * (? ؟ ？). Split on sentence ends of any script too.
 */
function questionsOf(text: string): readonly string[] {
  return text
    .split(/(?<=[.!?؟？。！])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[?؟？]$/u.test(sentence));
}

/**
 * Live 2026-10-16: "We want to raise USD 1.5m seed from Gulf investors.
 * هل هذا المبلغ منطقي ...؟" was answered with a list of investors. When the
 * turn asks a question and none of its questions is about the investors
 * (they appear only in what the person told Q), what is asked is the
 * question (their amount, their plan), never a search. Structural, so it
 * holds in any language: `mentions` says whether a sentence names the ask.
 */
export function asksSomethingElse(
  utterance: string,
  mentions: (sentence: string) => boolean,
): boolean {
  const questions = questionsOf(utterance);
  return questions.length > 0 && !questions.some(mentions);
}

export function investorDiscoveryLaneOf(utterance: string): FastLane | null {
  const text = utterance.trim().slice(0, 300);
  if (text.length === 0 || ACTION_WORDS.test(text)) return null;
  if (!INVESTOR_INTENT.test(text)) return null;
  if (
    asksSomethingElse(
      text,
      (sentence) =>
        INVESTOR_INTENT.test(sentence) ||
        REGION_TERMS.some((term) => sentence.toLowerCase().includes(term)),
    )
  ) {
    return null;
  }
  const lower = text.toLowerCase();
  const regions: string[] = [];
  for (const term of REGION_TERMS) {
    const at = new RegExp(
      `(?:^|[^\\p{L}])${term.replace(/\s+/gu, "\\s+")}(?:$|[^\\p{L}])`,
      "u",
    );
    if (at.test(lower) && !regions.some((r) => r.includes(term))) {
      regions.push(term);
    }
  }
  if (regions.length === 0) return null;
  const digit = /\b([1-9])\b/u.exec(text);
  const word = /\b(one|two|three|four|five|couple|few)\b/iu.exec(text);
  const said =
    digit !== null
      ? Number(digit[1])
      : word !== null
        ? COUNT_WORDS[(word[1] ?? "").toLowerCase()]
        : undefined;
  return {
    questionKind: "DISCOVER_INVESTORS",
    discoverInvestors: {
      regions,
      sector: null,
      stage: null,
      count: said === undefined ? null : Math.min(said, 5),
      aboutMyCompany:
        /\b(?:this|us|our|me|my\s+(?:company|startup|raise|round|deal))\b/iu.test(
          text,
        ),
    },
  };
}

/**
 * Follow-ups about a prepared entity ("tell me more about him", "what has
 * Muhannad said about founders"): the composition supplies a pure function
 * over the warm prepared records. The lane finds which prepared entity the
 * conversation last showed; everything else is the port's. Null text means
 * the normal path answers.
 */
export type PreparedFollowUpPort = (input: {
  readonly utterance: string;
  readonly lastShownEntityId: string | null;
}) => string | null;

/**
 * The prepared entity whose identity card Q showed last in this
 * conversation, read from the stored card blocks (`external.externalPersonId`).
 * Only a lone identity card counts; a list of candidates names no one, and
 * a later card of something else means the entity is no longer "this".
 */
export function lastShownEntityId(
  history: readonly {
    readonly role: string;
    readonly blocks?: readonly QResultBlock[] | undefined;
  }[],
): string | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message === undefined || message.role !== "Q") continue;
    for (const block of [...(message.blocks ?? [])].reverse()) {
      if (block.kind !== "ANSWER_CARDS") continue;
      if (block.cards.length !== 1) return null;
      return block.cards[0]?.external?.externalPersonId ?? null;
    }
  }
  return null;
}

/**
 * Founder P5, the instant cards lane: "clear all cards", "hide the
 * connection cards", "show me the cards again", "bring back the TensorGate
 * card", read by code from the words alone -- no model, no database, no
 * skim. Presentation only: the answer carries a typed CARDS intent the
 * screen performs on this device; nothing is approved, rejected, deleted
 * or cancelled. Null when the words are not a cards request.
 */
export function cardsLaneOf(
  utterance: string,
): { readonly said: string; readonly intent: QCardsIntent } | null {
  const request = cardsRequestOf(utterance);
  if (request === null) return null;
  return { said: cardsLineOf(request), intent: cardsIntentOf(request) };
}

/**
 * A follow-up that can only mean a Q Daily story ("give me the gist",
 * "what's the full story", "show me that section"), answered by code from
 * the arrival snapshot's prepared stories without the first reads (live
 * 2026-10-11: two classification calls, ~2.5 s, before a code answer).
 * Vague words ("open it", "tell me more") still go through the reader:
 * they can mean a card or a document.
 */
const DAILY_ONLY =
  /\b(?:(?:the\s+)?gist|full\s+story|(?:that|this|the)\s+(?:story|article|section|news)|q\s+daily)\b/iu;

export function dailyLaneOf(
  utterance: string,
  lastAnswerShowedCards = false,
): FastLane | null {
  const text = utterance.trim();
  if (text.length === 0 || text.length > 120) return null;
  // "the other one" / "the first one" after Q talked about stories (not
  // after cards, where it means a card): the Daily lane, no first reads.
  const bareOrdinal =
    !lastAnswerShowedCards &&
    /^(?:and\s+)?(?:the\s+)?(?:first|second|other|last|latter|former)(?:\s+one)?(?:\s+please)?[.!?]*$/iu.test(
      text,
    );
  if (!bareOrdinal && !DAILY_ONLY.test(text)) return null;
  // A request to act on something else is not a Daily follow-up.
  if (
    /\b(?:draft|email|send|schedule|delete|approve|decline|deck|pitch)\b/iu.test(
      text,
    )
  ) {
    return null;
  }
  return { questionKind: "DAILY_FOLLOW_UP" };
}

/**
 * S2 (lane S, 2026-10-15): a plain ranking of the investor's own candidates
 * against their own mandate ("show my top 3 companies against my mandate",
 * "rank my top five companies", "which three companies in my feed fit my
 * mandate best?") is recognised by code, so it no longer waits on TURN_SKIM
 * (live 2026-10-15: 2 FAST_CLASSIFICATION calls, 1.5-2.6 s, before the same
 * computed-fit answer). It hands over exactly what the skim's FIT lane
 * hands over; the fit itself is still computed by the platform's
 * deterministic fit through the tool port, never decided here.
 *
 * Deliberately narrow. Anything that asks for more than the ranking goes
 * to the readers, because the computed-fit answer would drop it:
 * - an action (draft, send, compare ...);
 * - an explanation ("explain why", "pros and cons", risks);
 * - a pointer at a record or a shown set ("this company", "them");
 * - an exclusion ("except", "not");
 * - a proper name other than a place after "in" or "from".
 * The caller also requires their own mandate in the permitted plan.
 */
const FIT_RANK_SET =
  /\b(?:companies|startups|deals|businesses|opportunities)\b/iu;
const FIT_RANK_CUE =
  /\b(?:top|best|strongest|highest[- ]scoring|rank|ranked|ranking)\b/iu;
const FIT_RANK_OWN =
  /\b(?:my|our)\s+(?:mandate|thesis|investment\s+criteria)\b|\brank\s+(?:my|our)\b|\b(?:my|our)\s+(?:top|best|strongest)\b/iu;
const FIT_RANK_NOT =
  /\b(?:why|explain\w*|reasons?|pros|cons|risks?|research\w*|memo|deck|brief|diligence|not|don'?t|except|excluding|other\s+than|besides|without|this|that|these|those|them|it|its|their|they|then|also|after|before|tell\s+me\s+about|what\s+(?:does|do|is|are)\s+\w+\s+do)\b/iu;
const FIT_RANK_PLACE =
  /\b(?:in|from|based\s+in|out\s+of)\s+[A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*){0,2}/gu;

export function fitRankingLaneOf(utterance: string): FastLane | null {
  const text = utterance.trim().replace(/[’]/gu, "'");
  if (text.length === 0 || text.length > 160) return null;
  // One ask: a second sentence or clause is the readers' to read.
  if (/[.!?;].*\S/u.test(text.replace(/[.!?]+$/u, ""))) return null;
  if (ACTION_WORDS.test(text) || FIT_RANK_NOT.test(text)) return null;
  if (!FIT_RANK_SET.test(text) || !FIT_RANK_CUE.test(text)) return null;
  if (!FIT_RANK_OWN.test(text)) return null;
  // A proper name (a company, a person) beyond the first word, "I", "Q"
  // or a place filter means the ask is about someone in particular.
  const rest = text
    .replace(FIT_RANK_PLACE, " ")
    .slice(1)
    .replace(/\b(?:I|Q|I'm|I'd)\b/gu, " ");
  if (/\p{Lu}/u.test(rest)) return null;
  return {
    questionKind: "FIT",
    fitQuestion: { text: text.slice(0, 1_000), count: null, previous: false },
  };
}
