import type { TurnSkimResult } from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

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
