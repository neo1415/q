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

const nameKey = (name: string): string =>
  name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

type Found = { readonly companyId: string; readonly canonicalName: string };

function itemsOf(outcome: QToolCallOutcome | null): readonly Found[] | null {
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

function profileOf(outcome: QToolCallOutcome | null): DeclaredProfile | null {
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

function stageWords(code: string): string {
  return STAGE_WORDS[code] ?? code.replace(/_/gu, " ");
}

function countryWords(code: string): string {
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
