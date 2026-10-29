import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

/**
 * S2b (lane S, 2026-10-15): one basic profile fact about a company named
 * outright ("what stage is Maji Loop at?", "where is Baridi based?",
 * "when was Ledgerfold founded?", "what does Ledgerfold do?") is answered
 * by code from the company's own declared profile. Live 2026-10-15 these
 * took 8-13 s: 2-3 classifications, then a model plan, a tool round and a
 * composition call, all to read a single field.
 *
 * The read goes through the same tool port, registry, authorize step and
 * Context Firewall the model would use: `search_companies` finds the name
 * among what the actor may see, then `get_company` returns the profile
 * only when the plan admits it. A name that matches no company exactly,
 * more than one, or a profile the plan denies returns null, and the full
 * path answers as before. Code chooses which field to read; it never
 * judges the company. Profile fields are the company's own declaration
 * (USER_CLAIM), and the answer says so; an empty field stays unknown.
 */

export type CompanyFactAspect = "STAGE" | "HEADQUARTERS" | "FOUNDED" | "WHAT";

export type CompanyFactAsk = {
  readonly aspect: CompanyFactAspect;
  /** The company as named, trimmed. */
  readonly name: string;
};

const NAME = "([\\p{L}\\p{N}][\\p{L}\\p{N}&.' -]{0,48}?[\\p{L}\\p{N}])";
const END = "\\s*\\??\\s*$";

const PATTERNS: readonly (readonly [CompanyFactAspect, RegExp])[] = [
  [
    "STAGE",
    new RegExp(`^what\\s+stage\\s+is\\s+${NAME}(?:\\s+(?:at|in))?${END}`, "iu"),
  ],
  [
    "STAGE",
    new RegExp(
      `^(?:what|which)(?:'s|\\s+is)\\s+the\\s+stage\\s+of\\s+${NAME}${END}`,
      "iu",
    ),
  ],
  [
    "STAGE",
    new RegExp(
      `^(?:what|which)(?:'s|\\s+is)\\s+${NAME}'s\\s+(?:current\\s+)?stage${END}`,
      "iu",
    ),
  ],
  [
    "HEADQUARTERS",
    new RegExp(
      `^where(?:'s|\\s+is)\\s+${NAME}\\s+(?:based|headquartered|located)${END}`,
      "iu",
    ),
  ],
  [
    "FOUNDED",
    new RegExp(
      `^when\\s+was\\s+${NAME}\\s+(?:founded|started|set\\s+up)${END}`,
      "iu",
    ),
  ],
  ["WHAT", new RegExp(`^what\\s+does\\s+${NAME}\\s+do${END}`, "iu")],
];

/** Words that are never a company's name here: a pointer, a person, Q. */
const NOT_A_NAME =
  /^(?:it|this|that|they|them|he|she|q|you|i|we|us|(?:this|that|the|my|our|your|their)\s+(?:company|startup|business|one))$/iu;
/** A second ask joined on ("... and should I invest?"): the readers'. */
const JOINED =
  /\b(?:and|or|but|then|should|would|could|can|vs|versus|with|to|for|if|so|about)\b/iu;
/** "what does my mandate do", "what does their CEO do": not a company. */
const OWNED = /^(?:my|our|your|their|his|her|its)\b/iu;

/** The fact asked about and the company named; null when not exactly that. */
export function companyFactAskOf(text: string): CompanyFactAsk | null {
  const said = text
    .trim()
    .replace(/[’]/gu, "'")
    .replace(/^(?:(?:ok(?:ay)?|so|and|q|hey\s+q)[,\s]+)+/iu, "");
  if (said.length === 0 || said.length > 90) return null;
  for (const [aspect, pattern] of PATTERNS) {
    const name = pattern
      .exec(said)?.[1]
      ?.trim()
      .replace(/^the\s+/iu, "");
    if (name === undefined || name.length < 2) continue;
    if (NOT_A_NAME.test(name) || OWNED.test(name) || JOINED.test(name)) {
      return null;
    }
    if (name.split(/\s+/u).length > 5) return null;
    return { aspect, name };
  }
  return null;
}

const SEARCH_TOOL = "search_companies";
const GET_TOOL = "get_company";
/** Read beside the profile when offered (owner 2026-10-23). */
const FIGURES_TOOL = "read_company_figures";

export const nameKey = (name: string): string =>
  name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

type Found = { readonly companyId: string; readonly canonicalName: string };

/** A `search_companies` outcome's items; null when not one. */
export function itemsOf(
  outcome: QToolCallOutcome | null,
): readonly Found[] | null {
  if (outcome === null || !outcome.result.ok) return null;
  const data: unknown = outcome.result.data;
  if (typeof data !== "object" || data === null) return null;
  const items: unknown = (data as { readonly items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  return items.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const { companyId, canonicalName } = item as Record<string, unknown>;
    return typeof companyId === "string" && typeof canonicalName === "string"
      ? [{ companyId, canonicalName }]
      : [];
  });
}

export type DeclaredProfile = {
  readonly companyId: string;
  readonly canonicalName: string;
  readonly currentStageCode: string | null;
  readonly headquartersCity: string | null;
  readonly headquartersCountry: string | null;
  readonly foundedDate: string | null;
  readonly shortDescription: string | null;
};

/** A `get_company` outcome as its declared profile; null when not one. */
export function profileOf(
  outcome: QToolCallOutcome | null,
): DeclaredProfile | null {
  if (outcome === null || !outcome.result.ok) return null;
  const data: unknown = outcome.result.data;
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const field = (name: string): string | null => {
    const value = record[name];
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  };
  const companyId = field("companyId");
  const canonicalName = field("canonicalName");
  if (companyId === null || canonicalName === null) return null;
  return {
    companyId,
    canonicalName,
    currentStageCode: field("currentStageCode"),
    headquartersCity: field("headquartersCity"),
    headquartersCountry: field("headquartersCountry"),
    foundedDate: field("foundedDate"),
    shortDescription: field("shortDescription"),
  };
}

const STAGE_WORDS: Readonly<Record<string, string>> = {
  pre_seed: "pre-seed",
  series_a: "Series A",
  series_b: "Series B",
  series_c: "Series C",
};

export function stageWords(code: string): string {
  return STAGE_WORDS[code] ?? code.replace(/_/gu, " ");
}

export function countryWords(code: string): string {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        code.toUpperCase(),
      ) ?? code
    );
  } catch {
    return code;
  }
}

const DECLARED =
  "That is what the company declares on Capital Q; it isn't verified.";

/** The answer line; an empty field stays unknown, never guessed. */
export function companyFactLine(
  aspect: CompanyFactAspect,
  p: DeclaredProfile,
): string {
  const name = p.canonicalName;
  switch (aspect) {
    case "STAGE":
      return p.currentStageCode === null
        ? `${name} hasn't declared its stage on Capital Q, so I don't know it.`
        : `${name} is at the ${stageWords(p.currentStageCode)} stage. ${DECLARED}`;
    case "HEADQUARTERS": {
      const place = [
        p.headquartersCity,
        p.headquartersCountry === null
          ? null
          : countryWords(p.headquartersCountry),
      ].filter((part): part is string => part !== null);
      return place.length === 0
        ? `${name} hasn't declared where it is based on Capital Q, so I don't know.`
        : `${name} is based in ${place.join(", ")}. ${DECLARED}`;
    }
    case "FOUNDED": {
      const year = /^(\d{4})/u.exec(p.foundedDate ?? "")?.[1];
      return year === undefined
        ? `${name} hasn't declared when it was founded on Capital Q, so I don't know.`
        : `${name} was founded in ${year}. ${DECLARED}`;
    }
    case "WHAT":
      return p.shortDescription === null
        ? `${name} hasn't described what it does on Capital Q yet.`
        : `In its own words: ${p.shortDescription.replace(/\s+/gu, " ")} ${DECLARED}`;
  }
}

export type CompanyFactAnswer = {
  readonly text: string;
  readonly companyId: string;
  readonly calls: readonly QToolCallOutcome[];
};

/**
 * Null when either tool is not offered to this run, the name is not
 * exactly one visible company, or its profile is not admitted: the full
 * path then answers (and meets the same authorize step).
 */
export async function runNamedCompanyFact(input: {
  readonly ask: CompanyFactAsk;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
}): Promise<CompanyFactAnswer | null> {
  const { ask, tools, context, available } = input;
  if (!available.has(SEARCH_TOOL) || !available.has(GET_TOOL)) return null;
  const calls: QToolCallOutcome[] = [];
  const execute = async (
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ): Promise<QToolCallOutcome | null> => {
    const outcome = await tools
      .execute({ callId, name, arguments: args }, context)
      .catch(() => null);
    if (outcome !== null) calls.push(outcome);
    return outcome;
  };
  const items = itemsOf(
    await execute(
      SEARCH_TOOL,
      { query: ask.name, limit: 5 },
      "q-named-company-fact-search",
    ),
  );
  if (items === null) return null;
  const wanted = nameKey(ask.name);
  const exact = new Set(
    items
      .filter((item) => nameKey(item.canonicalName) === wanted)
      .map((item) => item.companyId),
  );
  if (exact.size !== 1) return null;
  const [companyId] = [...exact];
  if (companyId === undefined) return null;
  const profile = profileOf(
    await execute(GET_TOOL, { companyId }, "q-named-company-fact-get"),
  );
  if (profile === null || profile.companyId !== companyId) return null;
  return {
    text: companyFactLine(ask.aspect, profile),
    companyId,
    calls,
  };
}

/** Words that start a sentence or name Capital Q itself, never a company. */
const NOT_COMPANY_WORDS = new Set([
  "i",
  "i'm",
  "i'd",
  "q",
  "capital",
  "discover",
  "home",
  "daily",
  "gateq",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "ok",
  "okay",
  "hey",
  "hi",
  "please",
  "tell",
  "what",
  "what's",
  "which",
  "who",
  "who's",
  "where",
  "when",
  "why",
  "how",
  "is",
  "are",
  "can",
  "could",
  "should",
  "would",
  "do",
  "does",
  "show",
  "give",
  "compare",
  "find",
  "open",
  "and",
  "so",
  "the",
]);

/** What follows a verb that opens a request: "Draft a…", "Write me…". */
const REQUEST_OBJECT =
  /^\s+(?:a|an|the|me|my|our|us|them|him|her|this|that|it|these|those|some|up|out)\b/iu;

/**
 * Efficiency pass (coordinator 2026-10-25, run 42b21b5f): "Draft a short
 * update email to Savanna Seed Partners" searched "Draft" as a company.
 * One capitalised word that opens a sentence and is followed by its object
 * is the request's own verb, capitalised by grammar: never a candidate.
 * "Ledgerfold is raising?" still is.
 */
function opensARequest(text: string, at: number, match: string): boolean {
  if (!opensASentence(text, at, match)) return false;
  return REQUEST_OBJECT.test(text.slice(at + match.length));
}

/** One word at the start of a sentence: its capital may be grammar's. */
function opensASentence(text: string, at: number, match: string): boolean {
  if (/\s/u.test(match)) return false;
  return /(?:^|[.!?]\s+|\n\s*)$/u.test(text.slice(0, at));
}

/**
 * S3a: up to `max` capitalised names in the words ("Tell me about Baridi",
 * "risks with Ledgerfold"), as candidates to look up exactly. A candidate
 * is only a search term: nothing is read unless the search, under the
 * plan, returns exactly one visible company of exactly that name.
 */
export function companyNameCandidates(
  text: string,
  max = 2,
  /**
   * XLSX-002 (live 2026-10-28: "My partner wants to go through…" searched
   * "My" as a company): the names the turn's reader heard (namedOther,
   * the names of a comparison). Given, a single word that opens a
   * sentence -- capitalised by grammar as much as by name -- is a
   * candidate only when the reader heard it named; a word list never
   * decides it. Absent: every capitalised word is, as before.
   */
  heard?: readonly string[],
): string[] {
  const found: string[] = [];
  const pattern =
    /\b\p{Lu}[\p{L}\p{N}&'-]*(?:\s+(?:\p{Lu}[\p{L}\p{N}&'-]*|\p{N}+))*/gu;
  const said = text.replace(/[’]/gu, "'");
  const named = new Set((heard ?? []).map((name) => nameKey(name)));
  for (const match of said.matchAll(pattern)) {
    if (opensARequest(said, match.index, match[0])) continue;
    const words = match[0]
      .split(/\s+/u)
      .filter((word) => !NOT_COMPANY_WORDS.has(word.toLowerCase()));
    const name = words.join(" ").replace(/'s$/u, "").trim();
    if (
      heard !== undefined &&
      opensASentence(said, match.index, match[0]) &&
      !named.has(nameKey(name))
    ) {
      continue;
    }
    if (name.length < 2 || words.length > 4) continue;
    if (!found.includes(name)) found.push(name);
    if (found.length >= max) break;
  }
  return found;
}

/** Words after which a lowercase name is looked for ("risks with x"). */
const LOWER_ANCHORS = new Set([
  "about",
  "with",
  "on",
  "of",
  "for",
  "from",
  "at",
  "is",
  "does",
  "did",
  "has",
  "was",
  "compare",
  "versus",
  "vs",
  "between",
  "and",
  "regarding",
]);

/** Words that end or are never part of a lowercase name. */
const LOWER_STOPS = new Set([
  ...NOT_COMPANY_WORDS,
  "a",
  "an",
  "my",
  "our",
  "your",
  "their",
  "his",
  "her",
  "its",
  "this",
  "that",
  "these",
  "those",
  "it",
  "them",
  "they",
  "me",
  "us",
  "we",
  "you",
  "now",
  "today",
  "tomorrow",
  "yesterday",
  "next",
  "there",
  "here",
  "more",
  "most",
  "all",
  "any",
  "some",
  "in",
  "to",
  "or",
  "but",
  "then",
  "if",
  "vs",
  "versus",
  "please",
  "again",
  "too",
  "also",
  "doing",
  "going",
  "up",
  "out",
  "one",
  "ones",
  "company",
  "companies",
  "startup",
  "startups",
  "investor",
  "investors",
  "fund",
  "funds",
  "deal",
  "deals",
  "mandate",
  "profile",
  "deck",
  "pitch",
  "round",
  "stage",
  "team",
  "market",
  "news",
  "risks",
  "risk",
  "traction",
  "revenue",
  "growth",
]);

/**
 * Turn latency round 5: a company typed in lowercase ("risks with
 * northwind ledger") as candidates, when no capitalised name was found.
 * The phrase after a word such as "with", "about" or "compare", cut at
 * punctuation and common words, at most four words. Like the capitalised
 * candidates it is only a search term: nothing is read unless the search,
 * under the plan, returns exactly one visible company of exactly that
 * name, so a phrase that names no company costs one search and no more.
 */
export function lowercaseNameCandidates(text: string, max = 2): string[] {
  if (companyNameCandidates(text, max).length > 0) return [];
  const found: string[] = [];
  const words = text
    .replace(/[’]/gu, "'")
    .toLowerCase()
    .split(/(\s+|[,.;:!?()"]+)/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  for (let at = 0; at < words.length && found.length < max; at += 1) {
    if (!LOWER_ANCHORS.has(words[at] ?? "")) continue;
    const name: string[] = [];
    for (let next = at + 1; next < words.length; next += 1) {
      const word = (words[next] ?? "").replace(/'s$/u, "");
      if (!/^[\p{L}\p{N}][\p{L}\p{N}&'-]*$/u.test(word)) break;
      if (LOWER_STOPS.has(word) || LOWER_ANCHORS.has(word)) {
        if (name.length === 0 && LOWER_STOPS.has(word)) continue;
        break;
      }
      name.push(word);
      if (name.length > 4) break;
    }
    if (name.length === 0 || name.length > 4) continue;
    const candidate = name.join(" ");
    if (candidate.length < 3 || found.includes(candidate)) continue;
    found.push(candidate);
  }
  return found;
}

/**
 * The visible company exactly named, by search then profile, through the
 * tool port; null for none, several, excluded ids or a profile not admitted.
 */
export async function readNamedVisibleCompany(input: {
  readonly name: string;
  readonly exclude: ReadonlySet<string>;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
  readonly callIndex: number;
  /** Called once a company matched, as its profile read starts. */
  readonly onFound?: (() => void) | undefined;
}): Promise<{
  readonly companyId: string;
  readonly data: unknown;
  /** read_company_figures' output when it succeeded; null otherwise. */
  readonly figures: unknown;
  readonly calls: readonly {
    readonly providerName: string;
    readonly outcome: QToolCallOutcome;
  }[];
} | null> {
  const { name, tools, context, available } = input;
  if (!available.has(SEARCH_TOOL) || !available.has(GET_TOOL)) return null;
  const calls: { providerName: string; outcome: QToolCallOutcome }[] = [];
  const search = await tools
    .execute(
      {
        callId: `q-named-visible-search-${String(input.callIndex)}`,
        name: SEARCH_TOOL,
        arguments: { query: name, limit: 5 },
      },
      context,
    )
    .catch(() => null);
  if (search !== null)
    calls.push({ providerName: SEARCH_TOOL, outcome: search });
  const wanted = nameKey(name);
  const exact = new Set(
    (itemsOf(search) ?? [])
      .filter((item) => nameKey(item.canonicalName) === wanted)
      .map((item) => item.companyId),
  );
  if (exact.size !== 1) return null;
  const [companyId] = [...exact];
  if (companyId === undefined || input.exclude.has(companyId)) return null;
  input.onFound?.();
  // The profile and its published figures, read in parallel through the
  // same tool port and plan; a figures read denied or failed adds nothing.
  const [got, figures] = await Promise.all([
    tools
      .execute(
        {
          callId: `q-named-visible-get-${String(input.callIndex)}`,
          name: GET_TOOL,
          arguments: { companyId },
        },
        context,
      )
      .catch(() => null),
    available.has(FIGURES_TOOL)
      ? tools
          .execute(
            {
              callId: `q-named-visible-figures-${String(input.callIndex)}`,
              name: FIGURES_TOOL,
              arguments: { companyId },
            },
            context,
          )
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  if (got !== null) calls.push({ providerName: GET_TOOL, outcome: got });
  if (figures !== null) {
    calls.push({ providerName: FIGURES_TOOL, outcome: figures });
  }
  if (got === null || !got.result.ok) return null;
  if (profileOf(got)?.companyId !== companyId) return null;
  return {
    companyId,
    data: got.result.data,
    figures:
      figures !== null && figures.status === "SUCCEEDED" && figures.result.ok
        ? figures.result.data
        : null,
    calls,
  };
}

/**
 * S3 (live 2026-10-15, run 69e50e45): "what are the main risks here?" on a
 * company's page was read as about someone else, and the model searched
 * for and re-read the company already on screen (two tool rounds, ~3.6 s
 * before its first sentence). True when the words name no company but,
 * at most, the selected one (no capitalised name other than its own). The
 * caller still requires a single authorised profile of the selected
 * company and no comparison words; a different named target keeps the
 * search-and-read rule. A name typed in lower case is not seen here.
 */
export function namesOnlyCompany(
  text: string,
  selected: string | null,
): boolean {
  if (selected === null) return false;
  // A set ("these companies", "the others") is not the selected one.
  if (
    /\b(?:companies|startups|businesses|them|those|these|others|another|each|both)\b/iu.test(
      text,
    )
  ) {
    return false;
  }
  const own = nameKey(selected);
  return companyNameCandidates(text, 4).every((name) => {
    const key = nameKey(name);
    return (
      key === own ||
      (key.length >= 4 && (own.startsWith(key) || key.startsWith(own)))
    );
  });
}

/** "Capital Q" (or "CapitalQ", "Capital-Q") named as a word. */
const CAPITAL_Q_NAMED = /\bcapital[\s-]?q\b/iu;
/**
 * Words that ask how to use the platform itself: those keep the platform
 * reading, whoever asks ("how does Capital Q work", "Capital Q's app").
 */
// Stress 2026-10-28 (I03): "find five companies in Capital Q" named the
// platform as the place to look, and Capital Q's own company record was
// read and compared. "in / on / across Capital Q" is the platform.
const PLATFORM_USE =
  /\b(?:how (?:do|does|can|should) (?:i|we|you|it|capital[\s-]?q)\b|(?:in|on|across|within|inside|through) capital[\s-]?q\b|work(?:s|ing)?\b|use|using|platform|app|feature|features|setting|settings|account|sign (?:in|up)|log ?in|subscription|pricing|help|support|onboard\w*)/iu;

/**
 * Owner 2026-10-23 (coordinator-approved disambiguation): Capital Q is also
 * a company on its own platform. An investor asking about "Capital Q" (its
 * revenue, its raise, "tell me about Capital Q") means the company, when
 * that company is discoverable to them; a question about using the
 * platform, a founder, a member of Capital Q's own team, and onboarding
 * keep the platform reading. This decides only whether to look the
 * company up: admission is still get_company's, through the same plan.
 */
export function capitalQAsCompanyAsked(input: {
  readonly text: string;
  readonly investorSide: boolean;
  readonly onboarding: boolean;
}): boolean {
  return (
    input.investorSide &&
    !input.onboarding &&
    CAPITAL_Q_NAMED.test(input.text) &&
    !PLATFORM_USE.test(input.text)
  );
}

/** The company read is Capital Q itself, reached as someone else's company. */
export function isCapitalQCompanyRead(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const read = data as {
    readonly canonicalName?: unknown;
    readonly relationToYou?: unknown;
  };
  return (
    typeof read.canonicalName === "string" &&
    nameKey(read.canonicalName) === nameKey("Capital Q") &&
    read.relationToYou === "SHARED"
  );
}
